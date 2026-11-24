import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getProjectDetails, projectForUser } from './db.js';
import { authenticate, createAccount, tokenFor, verifyAccount } from './auth.js';
import { getStream, putBuffer, putFile } from './storage.js';
import { probeVideo } from './media.js';
import { enqueue, retryScene, startWorker } from './worker.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadTmp = path.resolve(process.env.DATA_DIR || './data', 'temp');
fs.mkdirSync(uploadTmp, { recursive: true });
const uploader = multer({
  dest: uploadTmp,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/webm'];
    callback(allowed.includes(file.mimetype) ? null : new Error('Upload an MP4, MOV, or WebM video.'), allowed.includes(file.mimetype));
  }
});
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/meta', (_req, res) => res.json({
  videoConfigured: Boolean(process.env.VIDEO_PROVIDER_URL),
  transcriptionConfigured: Boolean(process.env.OPENAI_API_KEY),
  estimatedCostPerSecond: Number(process.env.VIDEO_COST_PER_SECOND_USD || 0.1)
}));

function presentProject(id) {
  const project = getProjectDetails(id);
  if (!project || !process.env.JWT_SECRET) return project;
  const mediaUrl = key => {
    if (!key) return null;
    const bucket = 2 * 60 * 60;
    const exp = (Math.floor(Date.now() / (bucket * 1000)) + 2) * bucket;
    return `/media/${jwt.sign({ key, exp }, process.env.JWT_SECRET, { noTimestamp: true })}`;
  };
  project.output_url = mediaUrl(project.output_key);
  for (const scene of project.scenes) {
    scene.keyframe_url = mediaUrl(scene.keyframe_key);
    scene.output_url = mediaUrl(scene.output_key);
  }
  return project;
}

app.get('/media/:ticket', async (req, res) => {
  try {
    const { key } = jwt.verify(req.params.ticket, process.env.JWT_SECRET || '');
    if (typeof key !== 'string') return res.status(401).end();
    res.type(key.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4');
    res.setHeader('Cache-Control', 'private, max-age=300');
    const stream = await getStream(key);
    stream.on('error', () => { if (!res.headersSent) res.status(404).end(); });
    stream.pipe(res);
  } catch { res.status(401).end(); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await createAccount(req.body.email, req.body.password);
    res.status(201).json({ token: tokenFor(user), user });
  } catch (error) {
    res.status(400).json({ error: error.message.includes('UNIQUE') ? 'An account already exists for that email.' : error.message });
  }
});
app.post('/api/auth/login', async (req, res) => {
  try {
    const user = await verifyAccount(req.body.email, req.body.password);
    res.json({ token: tokenFor(user), user });
  } catch (error) { res.status(401).json({ error: error.message }); }
});

app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));
app.use('/api', authenticate);

app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT id, name, status, duration, output_key, error, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(projects);
});

app.post('/api/projects', uploader.single('video'), async (req, res) => {
  const uploaded = req.file;
  try {
    if (!uploaded) return res.status(400).json({ error: 'Choose a video to upload.' });
    if (req.body.rightsConfirmed !== 'true') return res.status(400).json({ error: 'Confirm that you own or have rights to use this video.' });
    const count = db.prepare("SELECT COUNT(*) AS count FROM projects WHERE user_id = ? AND created_at >= datetime('now', '-1 day')").get(req.user.id).count;
    if (count >= 5) return res.status(429).json({ error: 'Upload limit reached. You can create up to 5 projects per day.' });
    const duration = await probeVideo(uploaded.path);
    const id = crypto.randomUUID();
    const sourceKey = `${id}/source${path.extname(uploaded.originalname).toLowerCase() || '.mp4'}`;
    await putFile(sourceKey, uploaded.path, uploaded.mimetype);
    db.prepare('INSERT INTO projects (id, user_id, name, source_key, duration, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, req.user.id, path.parse(uploaded.originalname).name.slice(0, 100) || 'Untitled video', sourceKey, duration, 'uploaded');
    enqueue(id, 'analysis');
    res.status(201).json(presentProject(id));
  } catch (error) {
    const clientError = error.message.includes('3 minutes') || error.message.startsWith('The uploaded file');
    res.status(clientError ? 400 : 500).json({ error: error.message });
  } finally {
    if (uploaded) await fs.promises.rm(uploaded.path, { force: true });
  }
});

app.get('/api/projects/:id', (req, res) => {
  if (!projectForUser(req.params.id, req.user.id)) return res.status(404).json({ error: 'Project not found.' });
  res.json(presentProject(req.params.id));
});

app.patch('/api/projects/:id/scenes/:sceneId', (req, res) => {
  if (!projectForUser(req.params.id, req.user.id)) return res.status(404).json({ error: 'Project not found.' });
  const scene = db.prepare('SELECT id FROM scenes WHERE id = ? AND project_id = ?').get(req.params.sceneId, req.params.id);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });
  const fields = ['transcript', 'description', 'camera', 'setting', 'tone'];
  const updates = fields.filter(field => typeof req.body[field] === 'string');
  if (!updates.length) return res.status(400).json({ error: 'No editable scene fields were provided.' });
  db.prepare(`UPDATE scenes SET ${updates.map(field => `${field} = ?`).join(', ')} WHERE id = ?`).run(...updates.map(field => req.body[field].slice(0, 5000)), scene.id);
  res.json(presentProject(req.params.id));
});

app.put('/api/projects/:id/characters', async (req, res) => {
  if (!projectForUser(req.params.id, req.user.id)) return res.status(404).json({ error: 'Project not found.' });
  const characters = req.body.characters;
  if (!Array.isArray(characters) || characters.length < 1 || characters.length > 4) return res.status(400).json({ error: 'Add between 1 and 4 replacement characters.' });
  try {
    const insert = db.prepare('INSERT INTO characters (id, project_id, name, description, voice, reference_key) VALUES (?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM characters WHERE project_id = ?').run(req.params.id);
      characters.forEach(character => {
        if (!character.name?.trim() || !character.description?.trim()) throw new Error('Every character needs a name and a description.');
        insert.run(crypto.randomUUID(), req.params.id, character.name.slice(0, 80), character.description.slice(0, 1000), character.voice || 'alloy', character.referenceKey || null);
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    for (const character of characters) {
      if (character.referenceData) {
        const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(character.referenceData);
        if (!match) throw new Error('Reference images must be PNG, JPEG, or WebP.');
        const bytes = Buffer.from(match[2], 'base64');
        if (bytes.length > 2 * 1024 * 1024) throw new Error('Character reference images must be under 2 MB.');
        character.referenceKey = `${req.params.id}/references/${crypto.randomUUID()}.${match[1]}`;
        await putBuffer(character.referenceKey, bytes, `image/${match[1]}`);
      }
    }
    res.json(presentProject(req.params.id));
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/projects/:id/generate', (req, res) => {
  const project = projectForUser(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const detail = getProjectDetails(req.params.id);
  if (!process.env.VIDEO_PROVIDER_URL) return res.status(503).json({ error: 'Set VIDEO_PROVIDER_URL to a video-generation provider before starting generation. You can still prepare and copy a Manual Hand-off.' });
  if (!detail.scenes.length) return res.status(409).json({ error: 'Wait for storyboard analysis to finish before generating.' });
  if (detail.scenes.some(scene => scene.safety === 'identifiable_person') && req.body.permissionConfirmed !== true) {
    return res.status(403).json({ error: 'This video includes identifiable people. Confirm you have their permission before generating replacement-character scenes.' });
  }
  if (!detail.characters.length) return res.status(400).json({ error: 'Save at least one replacement character first.' });
  const count = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?) AND type = 'generation' AND created_at >= datetime('now', '-1 day')").get(req.user.id).count;
  if (count >= 10) return res.status(429).json({ error: 'Generation limit reached. You can start up to 10 generations per day.' });
  const options = {
    style: req.body.style || 'original',
    scriptMode: req.body.scriptMode || 'original',
    customScript: String(req.body.customScript || '').slice(0, 12000),
    manualHandoff: Boolean(req.body.manualHandoff),
    manualPrompts: String(req.body.manualPrompts || '').slice(0, 30000),
    mixOriginalAudio: Boolean(req.body.mixOriginalAudio),
    characterMappings: req.body.characterMappings || {},
    permissionConfirmed: req.body.permissionConfirmed === true
  };
  if (options.scriptMode === 'custom' && !options.customScript.trim()) return res.status(400).json({ error: 'Enter the script you want to use.' });
  db.prepare('UPDATE projects SET options_json = ?, status = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(options), 'generating', project.id);
  enqueue(project.id, 'generation');
  res.status(202).json(presentProject(project.id));
});

app.post('/api/projects/:id/scenes/:sceneId/retry', (req, res) => {
  if (!projectForUser(req.params.id, req.user.id)) return res.status(404).json({ error: 'Project not found.' });
  if (!process.env.VIDEO_PROVIDER_URL) return res.status(503).json({ error: 'Configure VIDEO_PROVIDER_URL before retrying or regenerating a scene.' });
  try {
    retryScene(req.params.id, req.params.sceneId);
    res.status(202).json(presentProject(req.params.id));
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/projects/:id/retry', (req, res) => {
  const project = projectForUser(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const failedScenes = db.prepare("SELECT COUNT(*) AS count FROM scenes WHERE project_id = ? AND status = 'failed'").get(project.id).count;
  if (failedScenes) return res.status(409).json({ error: 'Retry failed scenes individually from the scene list.' });
  const failedJob = db.prepare("SELECT type FROM jobs WHERE project_id = ? AND status = 'failed' ORDER BY updated_at DESC LIMIT 1").get(project.id);
  if (failedJob?.type === 'generation') {
    db.prepare('UPDATE projects SET status = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('generating', project.id);
    enqueue(project.id, 'generation');
  } else if (failedJob?.type === 'finalize') {
    db.prepare('UPDATE projects SET status = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('generating', project.id);
    enqueue(project.id, 'finalize');
  } else {
    db.prepare('UPDATE projects SET status = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('uploaded', project.id);
    enqueue(project.id, 'analysis');
  }
  res.status(202).json(presentProject(req.params.id));
});

app.get('/api/projects/:id/media/:kind', async (req, res) => {
  const project = projectForUser(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const detail = getProjectDetails(project.id);
  let key;
  if (req.params.kind === 'final') key = detail.output_key;
  else if (req.params.kind === 'source') key = detail.source_key;
  else {
    const scene = detail.scenes.find(item => item.id === req.params.kind);
    key = scene?.keyframe_key;
  }
  if (!key) return res.status(404).json({ error: 'Media is not available yet.' });
  try {
    res.type(key.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4');
    const stream = await getStream(key);
    stream.on('error', () => { if (!res.headersSent) res.status(404).end(); });
    stream.pipe(res);
  } catch (error) { res.status(404).json({ error: error.message }); }
});

app.post('/api/projects/:id/handoff', (req, res) => {
  const project = projectForUser(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const detail = getProjectDetails(project.id);
  const text = [
    `ReCast storyboard: ${project.name}`,
    `Visual style: ${String(req.body.style || 'original')}`,
    req.body.scriptMode === 'custom' ? `Custom script to adapt across scenes:\n${String(req.body.customScript || '').slice(0, 12000)}` : 'Keep the original scene dialogue.',
    `Original-to-replacement character mappings: ${JSON.stringify(req.body.characterMappings || {})}`,
    'Create one new video prompt per scene. Keep the replacement characters visually consistent. Do not depict identifiable real people without consent, or sexual/violent content.',
    ...detail.characters.map(character => `Character — ${character.name}: ${character.description}`),
    ...detail.scenes.map(scene => `\n--- Scene ${scene.scene_number} ---\nTime: ${scene.start_time.toFixed(1)}–${scene.end_time.toFixed(1)}s\nDescription: ${scene.description}\nCamera: ${scene.camera}\nSetting: ${scene.setting}\nDialogue: ${scene.transcript}\nReturn a detailed video prompt for this scene.`)
  ].join('\n');
  res.json({ text });
});

app.use((error, _req, res, _next) => {
  const status = error instanceof multer.MulterError ? 400 : 400;
  res.status(status).json({ error: error.message || 'Request failed.' });
});

const frontend = path.resolve(__dirname, '../dist');
if (fs.existsSync(frontend)) {
  app.use(express.static(frontend));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(frontend, 'index.html'));
  });
}

startWorker();
app.listen(port, () => console.log(`ReCast API listening on http://localhost:${port}`));
