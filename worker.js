import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, getProjectDetails } from './db.js';
import { downloadFile, putBuffer, putFile } from './storage.js';
import { createFinalVideo, extractStoryboardFrames, normalizeSceneVideo, probeVideo, tempDirectory } from './media.js';
import { generateSpeech, generateVideo, prepareAnalysis, reviewManualPrompts, transcribe, writeScenePrompts } from './providers.js';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const active = new Set();
const concurrency = 3;

function updateProject(projectId, status, error = null) {
  db.prepare('UPDATE projects SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, error, projectId);
}

function sceneTranscript(segments, start, end) {
  return segments.filter(item => Number(item.end) > start && Number(item.start) < end).map(item => item.text).join(' ').trim();
}

async function runAnalysis(job) {
  updateProject(job.project_id, 'analyzing');
  db.prepare('DELETE FROM scenes WHERE project_id = ?').run(job.project_id);
  const tmp = await tempDirectory();
  try {
    const sourcePath = path.join(tmp, 'source-video');
    await downloadFile(db.prepare('SELECT source_key FROM projects WHERE id = ?').get(job.project_id).source_key, sourcePath);
    const { scenes, audioPath, duration } = await extractStoryboardFrames(sourcePath, path.join(tmp, 'frames'));
    const segments = await transcribe(audioPath);
    const sceneRecords = [];
    for (let index = 0; index < scenes.length; index += 1) {
      const item = scenes[index];
      const transcript = sceneTranscript(segments, item.start, item.end);
      const analysis = await prepareAnalysis(item.keyframePath, transcript);
      if (['sexual', 'violent'].includes(analysis.safety)) {
        throw new Error(`This video cannot be processed: ${analysis.safety_reason || analysis.safety}.`);
      }
      const id = crypto.randomUUID();
      const keyframeKey = `${job.project_id}/keyframes/scene-${index + 1}.jpg`;
      await putBuffer(keyframeKey, await fs.promises.readFile(item.keyframePath), 'image/jpeg');
      sceneRecords.push({ id, scene_number: index + 1, start_time: item.start, end_time: item.end, keyframe_key: keyframeKey, transcript, description: analysis.description || '', camera: analysis.camera || '', setting: analysis.setting || '', characters_json: JSON.stringify(analysis.characters || []), tone: analysis.tone || '', safety: analysis.safety || 'allowed', safety_reason: analysis.safety_reason || '' });
    }
    const tx = db.prepare(`INSERT INTO scenes (id, project_id, scene_number, start_time, end_time, keyframe_key, transcript, description, camera, setting, characters_json, tone, safety, safety_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const scene of sceneRecords) {
        tx.run(scene.id, job.project_id, scene.scene_number, scene.start_time, scene.end_time, scene.keyframe_key, scene.transcript, scene.description, scene.camera, scene.setting, scene.characters_json, scene.tone, scene.safety, scene.safety_reason);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    db.prepare('UPDATE projects SET duration = ?, status = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(duration, 'storyboard_ready', job.project_id);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
}

function parseManualPrompts(text, scenes) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Paste a prompt for every scene to continue in Manual Hand-off mode.');
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.scenes)) return parsed.scenes;
  } catch { /* Accept the numbered text format exported by the app below. */ }
  return scenes.map(scene => {
    const marker = new RegExp(`(?:^|\\n)(?:---\\s*)?scene\\s*${scene.scene_number}\\s*:?\\s*`, 'i');
    const start = trimmed.search(marker);
    if (start < 0) throw new Error(`Missing prompt for scene ${scene.scene_number}.`);
    const after = trimmed.slice(start).replace(marker, '');
    const next = after.search(/\n(?:---\s*)?scene\s*\d+\s*:?\s*/i);
    return { scene_number: scene.scene_number, prompt: (next < 0 ? after : after.slice(0, next)).trim() };
  });
}

async function startGeneration(job) {
  const project = getProjectDetails(job.project_id);
  if (!project || !project.scenes.length) throw new Error('Storyboard scenes are not ready yet.');
  const options = project.options || {};
  const promptResults = options.manualHandoff
    ? { scenes: parseManualPrompts(options.manualPrompts, project.scenes) }
    : await writeScenePrompts(project.scenes, project.characters, options.style || 'original', options.scriptMode === 'custom' ? options.customScript : '', options.characterMappings || {});
  if (promptResults.blocked) throw new Error(`Generation blocked: ${promptResults.reason || 'the requested content is not allowed.'}`);
  if (options.manualHandoff) {
    const review = await reviewManualPrompts(promptResults.scenes.map(scene => scene.prompt), project.characters, options.permissionConfirmed);
    if (!review.allowed) throw new Error(`Generation blocked: ${review.reason || 'the supplied prompt contains prohibited content.'}`);
  }
  const promptByNumber = new Map((promptResults.scenes || []).map(item => [Number(item.scene_number), item]));
  const updateScene = db.prepare('UPDATE scenes SET prompt = ?, transcript = ?, status = ?, error = NULL WHERE id = ?');
  const queueScene = db.prepare('INSERT INTO jobs (id, project_id, scene_id, type) VALUES (?, ?, ?, ?)');
  const prompts = project.scenes.map(scene => {
    const result = promptByNumber.get(scene.scene_number);
    if (!result?.prompt) throw new Error(`No video prompt was returned for scene ${scene.scene_number}.`);
    return { scene, result };
  });
  for (const { scene, result } of prompts) {
    updateScene.run(result.prompt, result.dialogue ?? scene.transcript, 'queued', scene.id);
    queueScene.run(crypto.randomUUID(), project.id, scene.id, 'scene');
  }
  updateProject(project.id, 'generating');
}

async function renderScene(job) {
  const scene = db.prepare('SELECT * FROM scenes WHERE id = ?').get(job.scene_id);
  const project = getProjectDetails(job.project_id);
  const tmp = await tempDirectory();
  try {
    const keyframePath = path.join(tmp, 'keyframe.jpg');
    await downloadFile(scene.keyframe_key, keyframePath);
      const originalNames = JSON.parse(scene.characters_json || '[]').map(character => character.name);
      const mappedName = originalNames.map(name => project.options.characterMappings?.[name]).find(Boolean);
    const character = project.characters.find(item => item.name === mappedName) || project.characters[0];
    let referencePath;
    if (character?.reference_key) {
      referencePath = path.join(tmp, 'reference');
      await downloadFile(character.reference_key, referencePath);
    }
    const outputPath = path.join(tmp, 'scene.mp4');
    const duration = scene.end_time - scene.start_time;
    await generateVideo(scene.prompt, duration, keyframePath, referencePath, outputPath);
    const dialogue = scene.transcript;
    let voicePath = null;
    if (dialogue) {
      voicePath = path.join(tmp, 'voice.mp3');
      if (!await generateSpeech(dialogue, character?.voice, voicePath)) voicePath = null;
    }
    const normalizedPath = path.join(tmp, 'normalized.mp4');
    await normalizeSceneVideo(outputPath, voicePath, normalizedPath, duration);
    const outputKey = `${project.id}/scenes/${scene.scene_number}.mp4`;
    await putFile(outputKey, normalizedPath, 'video/mp4');
    db.prepare('UPDATE scenes SET output_key = ?, status = ?, error = NULL WHERE id = ?').run(outputKey, 'complete', scene.id);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
}

async function finalizeProject(job) {
  const project = getProjectDetails(job.project_id);
  if (project.scenes.some(scene => scene.status !== 'complete')) throw new Error('Some scenes are not finished yet.');
  const tmp = await tempDirectory();
  try {
    const paths = [];
    for (const scene of project.scenes) {
      const clipPath = path.join(tmp, `scene-${scene.scene_number}.mp4`);
      await downloadFile(scene.output_key, clipPath);
      paths.push(clipPath);
    }
    const sourcePath = path.join(tmp, 'source.mp4');
    await downloadFile(project.source_key, sourcePath);
    const outputPath = path.join(tmp, 'final.mp4');
    await createFinalVideo(paths, outputPath, sourcePath, Boolean(project.options.mixOriginalAudio));
    const outputKey = `${project.id}/final.mp4`;
    await putFile(outputKey, outputPath, 'video/mp4');
    db.prepare('UPDATE projects SET output_key = ?, status = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(outputKey, 'complete', project.id);
    await sendCompletion(project.id, 'Your ReCast video is ready');
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
}

async function sendCompletion(projectId, message) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !process.env.EMAIL_FROM) return;
  const project = db.prepare('SELECT p.name, u.email FROM projects p JOIN users u ON u.id = p.user_id WHERE p.id = ?').get(projectId);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [project.email], subject: `${message}: ${project.name}`, text: `${message}. Open ReCast to view your project.` })
    });
    if (!response.ok) console.error(`Completion email failed for project ${projectId}: ${response.status} ${await response.text()}`);
  } catch (error) {
    console.error(`Completion email failed for project ${projectId}: ${error.message}`);
  }
}

async function processJob(job) {
  try {
    db.prepare('UPDATE jobs SET status = ?, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('running', job.id);
    if (job.type === 'scene') db.prepare('UPDATE scenes SET status = ?, error = NULL WHERE id = ?').run('generating', job.scene_id);
    if (job.type === 'analysis') await runAnalysis(job);
    else if (job.type === 'generation') await startGeneration(job);
    else if (job.type === 'scene') await renderScene(job);
    else if (job.type === 'finalize') await finalizeProject(job);
    db.prepare('UPDATE jobs SET status = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('complete', job.id);
    if (job.type === 'scene') {
      const activeScenes = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE project_id = ? AND type = 'scene' AND status IN ('pending','running')").get(job.project_id).count;
      if (activeScenes === 0) {
        const failedScenes = db.prepare("SELECT COUNT(*) AS count FROM scenes WHERE project_id = ? AND status = 'failed'").get(job.project_id).count;
        if (failedScenes) updateProject(job.project_id, 'failed', `${failedScenes} scene${failedScenes === 1 ? '' : 's'} could not be generated. Retry them individually.`);
        else if (!db.prepare("SELECT 1 FROM jobs WHERE project_id = ? AND type = 'finalize' AND status IN ('pending','running')").get(job.project_id)) {
          db.prepare('INSERT INTO jobs (id, project_id, type) VALUES (?, ?, ?)').run(crypto.randomUUID(), job.project_id, 'finalize');
        }
      }
    }
  } catch (error) {
    const message = error?.message || 'An unexpected processing error occurred.';
    const nextAttempt = Number(job.attempts) + 1;
    const retryable = ['scene'].includes(job.type) && nextAttempt < 3;
    db.prepare('UPDATE jobs SET status = ?, attempts = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(retryable ? 'pending' : 'failed', nextAttempt, message, job.id);
    if (job.type === 'scene') {
      db.prepare('UPDATE scenes SET status = ?, error = ? WHERE id = ?').run(retryable ? 'queued' : 'failed', message, job.scene_id);
      if (!retryable) {
        const remainingJobs = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE project_id = ? AND type = 'scene' AND status IN ('pending','running')").get(job.project_id).count;
        if (remainingJobs === 0) {
          const failedScenes = db.prepare("SELECT COUNT(*) AS count FROM scenes WHERE project_id = ? AND status = 'failed'").get(job.project_id).count;
          updateProject(job.project_id, 'failed', `${failedScenes} scene${failedScenes === 1 ? '' : 's'} could not be generated. Retry them individually.`);
        }
      }
    }
    else updateProject(job.project_id, 'failed', message);
  } finally {
    active.delete(job.id);
  }
}

export function enqueue(projectId, type, sceneId = null) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO jobs (id, project_id, scene_id, type) VALUES (?, ?, ?, ?)').run(id, projectId, sceneId, type);
  return id;
}

export function retryScene(projectId, sceneId) {
  const scene = db.prepare('SELECT * FROM scenes WHERE id = ? AND project_id = ?').get(sceneId, projectId);
  if (!scene) throw new Error('Scene not found.');
  db.prepare('UPDATE scenes SET status = ?, error = NULL WHERE id = ?').run('queued', sceneId);
  enqueue(projectId, 'scene', sceneId);
  updateProject(projectId, 'generating');
}

export function startWorker() {
  db.prepare("UPDATE jobs SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE status = 'running'").run();
  db.prepare("UPDATE scenes SET status = 'queued' WHERE status = 'generating'").run();
  setInterval(() => {
    while (active.size < concurrency) {
      const job = db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1").all()
        .find(candidate => !active.has(candidate.id));
      if (!job) break;
      active.add(job.id);
      processJob(job);
    }
  }, 1000).unref();
}
