import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCircle2, Clapperboard,
  Clock3, Film, FileText, LoaderCircle, LockKeyhole, LogOut, MessageSquareText,
  MoreHorizontal, Play, Plus, RefreshCw, Scissors, ShieldCheck, Sparkles, Upload,
  Users, WandSparkles, X
} from './icons.jsx';

const API = '/api';
const statusNames = { uploaded: 'Uploaded', analyzing: 'Analyzing video', storyboard_ready: 'Storyboard ready', generating: 'Generating', complete: 'Complete', failed: 'Failed' };
const styles = [
  { value: 'original', label: 'Original look', note: 'Keep the source aesthetic' },
  { value: 'cartoon', label: 'Cartoon', note: 'Playful illustrated motion' },
  { value: 'anime', label: 'Anime', note: 'Expressive, cinematic anime' },
  { value: 'realistic', label: 'Realistic', note: 'Natural, film-like detail' },
  { value: '3d animated', label: '3D animated', note: 'Polished dimensional worlds' }
];
const voices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

function readToken() { return localStorage.getItem('recast-token'); }
async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (readToken()) headers.Authorization = `Bearer ${readToken()}`;
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const data = await request(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
      localStorage.setItem('recast-token', data.token); onAuth(data.user);
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  return <main className="auth-page">
    <div className="auth-brand"><span className="brand-mark"><Clapperboard size={19} /></span><span>recast</span></div>
    <section className="auth-card">
      <div className="eyebrow"><Sparkles size={14} /> YOUR STORY, REIMAGINED</div>
      <h1>{mode === 'register' ? 'Make something new.' : 'Welcome back.'}</h1>
      <p className="muted">{mode === 'register' ? 'Recast the scenes you love with characters of your own.' : 'Pick up right where your story left off.'}</p>
      <form onSubmit={submit} className="form-stack">
        <label>Email address<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <label>Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 10 : 1} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'} /></label>
        {error && <div className="error-box">{error}</div>}
        <button className="button button-primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : null}{mode === 'register' ? 'Create your account' : 'Sign in'}<ArrowRight size={16} /></button>
      </form>
      <p className="auth-toggle">{mode === 'register' ? 'Already have an account?' : 'New to ReCast?'} <button onClick={() => { setError(''); setMode(mode === 'register' ? 'login' : 'register'); }}>{mode === 'register' ? 'Sign in' : 'Create account'}</button></p>
      <div className="secure-note"><LockKeyhole size={13} /> Your projects are private to your account.</div>
    </section>
    <p className="auth-foot">A new point of view on every story.</p>
  </main>;
}

function Header({ user, page, setPage, onLogout }) {
  return <header className="topbar">
    <button className="brand" onClick={() => setPage({ name: 'home' })}><span className="brand-mark"><Clapperboard size={18} /></span><span>recast</span></button>
    <div className="topbar-right">
      <button className={`nav-link ${page.name === 'home' ? 'active' : ''}`} onClick={() => setPage({ name: 'home' })}>My projects</button>
      <div className="user-chip"><span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span><span className="user-email">{user.email}</span></div>
      <button className="icon-button" title="Sign out" onClick={onLogout}><LogOut size={17} /></button>
    </div>
  </header>;
}

function UploadPanel({ onUploaded }) {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  function choose(candidate) {
    if (!candidate) return;
    setError('');
    if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(candidate.type)) { setError('Choose an MP4, MOV, or WebM video.'); return; }
    if (candidate.size > 200 * 1024 * 1024) { setError('Your video must be under 200 MB.'); return; }
    setFile(candidate);
  }
  async function upload() {
    if (!file || !confirmed) return;
    setBusy(true); setProgress(0); setError('');
    try {
      const form = new FormData(); form.append('video', file); form.append('rightsConfirmed', 'true');
      const token = readToken();
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API}/projects`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
        xhr.onload = () => { const body = JSON.parse(xhr.responseText || '{}'); xhr.status >= 200 && xhr.status < 300 ? resolve(body) : reject(new Error(body.error || 'Upload failed.')); };
        xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
        xhr.send(form);
      });
      onUploaded(data);
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  return <section className="upload-panel">
    <div className="upload-copy">
      <div className="eyebrow"><Sparkles size={14} /> FROM VIDEO TO VISION</div>
      <h1>Same story.<br /><span>New cast.</span></h1>
      <p>Reimagine your video one scene at a time. Start with a clip you love, finish with a story that feels entirely yours.</p>
      <div className="feature-row"><span><Scissors size={15} /> Scene by scene</span><span><Users size={15} /> Your characters</span><span><ShieldCheck size={15} /> Yours to create</span></div>
    </div>
    <div className={`dropzone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0]); }}>
      {!file ? <>
        <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={event => choose(event.target.files[0])} />
        <div className="upload-icon"><Upload size={23} /></div>
        <h3>Drop your video here</h3><p>or <button className="text-button" onClick={() => inputRef.current?.click()}>browse files</button> to get started</p>
        <div className="upload-formats"><span>MP4, MOV, WebM</span><i /> <span>Up to 3 min</span><i /> <span>200 MB max</span></div>
      </> : <>
        <div className="upload-icon success"><Film size={22} /></div>
        <h3 className="file-name">{file.name}</h3><p>{(file.size / 1024 / 1024).toFixed(1)} MB · Ready to upload</p>
        {busy && <div className="progress-wrap"><div className="progress-label"><span>Uploading video</span><span>{progress}%</span></div><div className="progress-track"><div style={{ width: `${progress}%` }} /></div></div>}
        <button className="text-button change-file" onClick={() => { setFile(null); setProgress(0); }}>Choose a different video</button>
      </>}
    </div>
    <div className="upload-submit">
      <label className="rights-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I own or have the rights to use this video.</span></label>
      <button className="button button-primary" disabled={!file || !confirmed || busy} onClick={upload}>{busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={16} />}{busy ? 'Uploading…' : 'Start recasting'}<ArrowRight size={16} /></button>
    </div>
    {error && <div className="error-box">{error}</div>}
  </section>;
}

function ProjectCard({ project, onOpen }) {
  return <button className="project-card" onClick={onOpen}>
    <div className={`project-thumb thumb-${project.status}`}>
      {project.status === 'complete' ? <Play size={22} fill="currentColor" /> : <Clapperboard size={23} />}
      <span className={`status-pill status-${project.status}`}>{project.status === 'analyzing' || project.status === 'generating' ? <LoaderCircle size={12} className="spin" /> : null}{statusNames[project.status] || project.status}</span>
    </div>
    <div className="project-card-info"><strong>{project.name}</strong><span>{project.duration ? formatTime(project.duration) : 'Video project'} · {new Date(project.created_at + (project.created_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString()}</span></div>
    <ArrowRight className="project-arrow" size={17} />
  </button>;
}

function HomePage({ user, projects, refreshProjects, setPage }) {
  return <main className="page-shell">
    <UploadPanel onUploaded={project => { refreshProjects(); setPage({ name: 'project', id: project.id }); }} />
    <section className="projects-section">
      <div className="section-heading"><div><div className="eyebrow">YOUR STUDIO</div><h2>My projects <span className="count-badge">{projects.length}</span></h2></div><button className="button button-secondary small" onClick={refreshProjects}><RefreshCw size={14} /> Refresh</button></div>
      {projects.length ? <div className="projects-grid">{projects.map(project => <ProjectCard key={project.id} project={project} onOpen={() => setPage({ name: 'project', id: project.id })} />)}</div> : <div className="empty-projects"><div className="empty-icon"><Film size={20} /></div><div><strong>{user.email ? 'Your next story starts here.' : 'No projects yet.'}</strong><p>Upload a video above and your projects will appear here.</p></div></div>}
    </section>
  </main>;
}

function Editable({ value, onSave, multiline = false, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  useEffect(() => setDraft(value || ''), [value]);
  const Element = multiline ? 'textarea' : 'input';
  if (!editing) return <button className={`editable ${value ? '' : 'placeholder'}`} onClick={() => setEditing(true)}>{value || placeholder}<span className="edit-hint">Edit</span></button>;
  return <div className="editable-edit"><Element autoFocus value={draft} placeholder={placeholder} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !multiline) { event.preventDefault(); onSave(draft); setEditing(false); } if (event.key === 'Escape') setEditing(false); }} /><button className="save-edit" onClick={() => { onSave(draft); setEditing(false); }}><Check size={14} /></button></div>;
}

function StoryboardPage({ project, refresh, setPage }) {
  const [savingId, setSavingId] = useState('');
  async function save(scene, field, value) {
    setSavingId(scene.id);
    try { await request(`/projects/${project.id}/scenes/${scene.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) }); await refresh(); }
    catch (error) { window.alert(error.message); } finally { setSavingId(''); }
  }
  return <main className="page-shell">
    <button className="back-link" onClick={() => setPage({ name: 'project', id: project.id })}><ArrowLeft size={15} /> Project overview</button>
    <div className="page-title-row"><div><div className="eyebrow"><Clapperboard size={13} /> YOUR STORYBOARD</div><h1>{project.name}</h1><p className="muted">Every scene, mapped out. Tap any detail to make it yours.</p></div><button className="button button-primary" onClick={() => setPage({ name: 'recast', id: project.id })}>Recast this story <ArrowRight size={16} /></button></div>
    <div className="storyboard-grid">{project.scenes.map(scene => <article className="scene-card" key={scene.id}>
      <div className="scene-image-wrap"><img src={scene.keyframe_url} alt={`Scene ${scene.scene_number} keyframe`} /><div className="scene-number">SCENE {String(scene.scene_number).padStart(2, '0')}</div><span className="scene-timing"><Clock3 size={12} /> {formatTime(scene.start_time)} — {formatTime(scene.end_time)}</span></div>
      <div className="scene-card-body">
        <div className="scene-section-label"><span>SCENE DESCRIPTION</span>{savingId === scene.id && <LoaderCircle size={13} className="spin" />}</div>
        <Editable value={scene.description} placeholder="Add a description…" multiline onSave={value => save(scene, 'description', value)} />
        <div className="scene-detail-grid"><div><span className="detail-label">SETTING</span><Editable value={scene.setting} placeholder="Add setting" onSave={value => save(scene, 'setting', value)} /></div><div><span className="detail-label">CAMERA</span><Editable value={scene.camera} placeholder="Add camera angle" onSave={value => save(scene, 'camera', value)} /></div></div>
        <div className="dialogue-box"><div className="scene-section-label"><span><MessageSquareText size={13} /> DIALOGUE / NARRATION</span></div><Editable value={scene.transcript} placeholder="No dialogue detected — add narration" multiline onSave={value => save(scene, 'transcript', value)} /></div>
      </div>
    </article>)}</div>
  </main>;
}

function RecastPage({ project, refresh, setPage, meta }) {
  const [characters, setCharacters] = useState(project.characters.length ? project.characters.map(character => ({ ...character })) : [{ name: '', description: '', voice: 'alloy' }]);
  const [scriptMode, setScriptMode] = useState(project.options?.scriptMode || 'original');
  const [customScript, setCustomScript] = useState(project.options?.customScript || '');
  const [style, setStyle] = useState(project.options?.style || 'original');
  const [mixOriginalAudio, setMixOriginalAudio] = useState(Boolean(project.options?.mixOriginalAudio));
  const [characterMappings, setCharacterMappings] = useState(project.options?.characterMappings || {});
  const [permissionConfirmed, setPermissionConfirmed] = useState(Boolean(project.options?.permissionConfirmed));
  const [manualHandoff, setManualHandoff] = useState(Boolean(project.options?.manualHandoff));
  const [manualPrompts, setManualPrompts] = useState(project.options?.manualPrompts || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function saveCharacters() {
    setBusy(true); setError('');
    try {
      const payload = await Promise.all(characters.map(async character => {
        const result = { name: character.name, description: character.description, voice: character.voice };
        if (character.referenceFile) {
          result.referenceData = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(character.referenceFile);
          });
        } else if (character.reference_key) result.referenceKey = character.reference_key;
        return result;
      }));
      await request(`/projects/${project.id}/characters`, { method: 'PUT', body: JSON.stringify({ characters: payload }) });
      return true;
    } catch (reason) { setError(reason.message); return false; } finally { setBusy(false); }
  }
  async function generate() {
    setError('');
    if (!meta?.videoConfigured) { setError('Configure VIDEO_PROVIDER_URL in .env to render your scenes. You can still copy a Manual Hand-off.'); return; }
    if (project.scenes.some(scene => scene.safety === 'identifiable_person') && !permissionConfirmed) { setError('Confirm permission to use the identifiable people in this video before generating.'); return; }
    if (characters.some(character => !character.name.trim() || !character.description.trim())) { setError('Give every character a name and a description.'); return; }
    if (!await saveCharacters()) return;
    setBusy(true);
    try {
      await request(`/projects/${project.id}/generate`, { method: 'POST', body: JSON.stringify({ style, scriptMode, customScript, manualHandoff, manualPrompts, mixOriginalAudio, characterMappings, permissionConfirmed }) });
      await refresh(); setPage({ name: 'project', id: project.id });
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  async function handoff() {
    setError('');
    if (characters.some(character => !character.name.trim() || !character.description.trim())) { setError('Give every character a name and a description before copying the hand-off.'); return; }
    if (!await saveCharacters()) return;
    try {
      const result = await request(`/projects/${project.id}/handoff`, { method: 'POST', body: JSON.stringify({ style, scriptMode, customScript, characterMappings }) });
      await navigator.clipboard.writeText(result.text);
      setCopied(true); window.setTimeout(() => setCopied(false), 2500);
    } catch (reason) { setError(reason.message); }
  }
  function updateCharacter(index, field, value) { setCharacters(current => current.map((character, i) => i === index ? { ...character, [field]: value } : character)); }

  return <main className="page-shell">
    <button className="back-link" onClick={() => setPage({ name: 'storyboard', id: project.id })}><ArrowLeft size={15} /> Back to storyboard</button>
    <div className="page-title-row"><div><div className="eyebrow"><WandSparkles size={13} /> THE RECAST</div><h1>Make it your story.</h1><p className="muted">Bring a new cast, a new style, or a new point of view.</p></div><span className="steps-pill"><span className="step-done"><Check size={11} /></span> Storyboard <ArrowRight size={12} /> <span className="step-current">2</span> Recast</span></div>
    <div className="recast-layout">
      <div className="recast-main">
        <section className="settings-card"><div className="settings-heading"><div className="settings-icon"><Users size={17} /></div><div><h2>Meet your new cast</h2><p>Describe each character so they stay consistent across scenes.</p></div></div>
          <div className="character-list">{characters.map((character, index) => <div className="character-editor" key={index}>
            <div className="character-editor-top"><span className="character-index">0{index + 1}</span><strong>Character {index + 1}</strong>{characters.length > 1 && <button className="icon-button remove-character" onClick={() => setCharacters(current => current.filter((_, i) => i !== index))}><X size={15} /></button>}</div>
            <div className="character-fields"><label>Character name<input value={character.name} onChange={event => updateCharacter(index, 'name', event.target.value)} placeholder="e.g. Maya" /></label><label>Appearance & personality<textarea rows="2" value={character.description} onChange={event => updateCharacter(index, 'description', event.target.value)} placeholder="Describe their look, personality, and distinctive details…" /></label><div className="character-bottom"><label className="voice-label">Voice<select value={character.voice || 'alloy'} onChange={event => updateCharacter(index, 'voice', event.target.value)}>{voices.map(voice => <option key={voice} value={voice}>{voice[0].toUpperCase() + voice.slice(1)}</option>)}</select></label><label className="reference-upload">{character.referenceFile?.name || (character.reference_key ? 'Reference image saved' : '＋ Add reference image')}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => updateCharacter(index, 'referenceFile', event.target.files[0])} /></label></div></div>
          </div>)}</div>
          {characters.length < 4 && <button className="add-character" onClick={() => setCharacters(current => [...current, { name: '', description: '', voice: 'alloy' }])}><Plus size={15} /> Add another character <span>Up to 4</span></button>}
          {Array.from(new Set(project.scenes.flatMap(scene => (scene.characters || []).map(character => character.name).filter(Boolean)))).length > 0 && <div className="mapping-list"><div className="detail-label">ORIGINAL-TO-REPLACEMENT MAPPING</div>{Array.from(new Set(project.scenes.flatMap(scene => (scene.characters || []).map(character => character.name).filter(Boolean)))).map(original => <label key={original}><span>{original}</span><ArrowRight size={13} /><select value={characterMappings[original] || characters[0]?.name || ''} onChange={event => setCharacterMappings(current => ({ ...current, [original]: event.target.value }))}>{characters.filter(character => character.name.trim()).map((character, i) => <option key={`${character.name}-${i}`} value={character.name}>{character.name}</option>)}</select></label>)}</div>}
          <div className="mapping-note"><ShieldCheck size={15} /><span>Character mapping is included in every scene prompt to help keep your cast consistent.</span></div>
        </section>
        <section className="settings-card"><div className="settings-heading"><div className="settings-icon peach"><FileText size={17} /></div><div><h2>Choose your script</h2><p>Keep the original words, or give the story a new voice.</p></div></div>
          <div className="script-options"><button className={`script-option ${scriptMode === 'original' ? 'selected' : ''}`} onClick={() => setScriptMode('original')}><span className="radio-dot" /><span><strong>Keep original script</strong><small>Preserve the dialogue and narration from your video.</small></span><span className="default-tag">DEFAULT</span></button><button className={`script-option ${scriptMode === 'custom' ? 'selected' : ''}`} onClick={() => setScriptMode('custom')}><span className="radio-dot" /><span><strong>Use my own script</strong><small>Claude adapts your words to fit each scene.</small></span></button></div>
          {scriptMode === 'custom' && <textarea className="script-input" rows="5" value={customScript} onChange={event => setCustomScript(event.target.value)} placeholder="Paste your script here. It will be thoughtfully split across your scenes…" />}
        </section>
        <section className="settings-card"><div className="settings-heading"><div className="settings-icon lavender"><Sparkles size={17} /></div><div><h2>Set the scene</h2><p>Pick a visual style for your reimagined story.</p></div></div>
          <div className="style-options">{styles.map(item => <button key={item.value} className={`style-option ${style === item.value ? 'selected' : ''}`} onClick={() => setStyle(item.value)}><span className={`style-swatch swatch-${item.value.replace(' ', '-')}`}><Clapperboard size={17} /></span><strong>{item.label}</strong><small>{item.note}</small>{style === item.value && <CheckCircle2 className="style-check" size={16} />}</button>)}</div>
          <label className="audio-toggle"><input type="checkbox" checked={mixOriginalAudio} onChange={event => setMixOriginalAudio(event.target.checked)} /><span className="toggle-ui" /><span><strong>Keep a touch of the original audio</strong><small>Blend the source ambience under new dialogue.</small></span></label>
        </section>
      </div>
      <aside className="recast-aside">
        <div className="generate-card"><div className="generate-card-heading"><Sparkles size={16} /><span>READY WHEN YOU ARE</span></div><h3>Lights, camera,<br /><span>recast.</span></h3><p>Your scenes, reimagined with your cast. Review the details, then bring your new story to life.</p>
          <div className="summary-list"><div><CheckCircle2 size={15} /><span>Storyboard</span><strong>{project.scenes.length} scenes</strong></div><div><Users size={15} /><span>New cast</span><strong>{characters.length} character{characters.length === 1 ? '' : 's'}</strong></div><div><Clock3 size={15} /><span>Final runtime</span><strong>~{formatTime(project.duration)}</strong></div></div>
          <div className="estimate-box"><div><span>Estimated generation cost</span><strong>${(project.duration * (meta?.estimatedCostPerSecond || 0.1)).toFixed(2)}</strong></div><small>Estimate based on configured rate (${(meta?.estimatedCostPerSecond || 0.1).toFixed(2)}/second). Your provider may charge differently.</small></div>
          {project.scenes.some(scene => scene.safety === 'identifiable_person') && <label className="consent-check"><input type="checkbox" checked={permissionConfirmed} onChange={event => setPermissionConfirmed(event.target.checked)} /><span>I have permission to use the identifiable people in this source video. The generated scenes will use my replacement characters, not their likenesses.</span></label>}
          <button className="button button-primary full generate-button" disabled={busy} onClick={generate}>{busy ? <LoaderCircle size={17} className="spin" /> : <WandSparkles size={17} />}{busy ? 'Preparing your scenes…' : 'Generate video'}<ArrowRight size={16} /></button>
          {!meta?.videoConfigured && <div className="provider-warning"><ShieldCheck size={14} /> Set VIDEO_PROVIDER_URL to render clips. You can prepare a Manual Hand-off without it.</div>}
          {error && <div className="error-box">{error}</div>}
          <div className="privacy-note"><LockKeyhole size={13} /> Your video and characters stay private.</div>
        </div>
        <div className="handoff-card"><div><div className="handoff-icon"><MoreHorizontal size={19} /></div><div><strong>Prefer to prompt Claude yourself?</strong><p>Copy a scene-by-scene hand-off, then paste your prompts back here.</p></div></div><button className="button button-secondary full" onClick={() => { setManualHandoff(value => !value); if (!manualHandoff) handoff(); }}>{copied ? <Check size={15} /> : <FileText size={15} />}{copied ? 'Copied to clipboard' : 'Copy hand-off & enable'}<ArrowRight size={15} /></button>
          {manualHandoff && <div className="manual-prompt-area"><label>Paste returned prompts <small>(JSON or “Scene 1: …” format)</small><textarea rows="7" value={manualPrompts} onChange={event => setManualPrompts(event.target.value)} placeholder={'Scene 1: Detailed prompt for scene one…\\n\\nScene 2: Detailed prompt for scene two…'} /></label></div>}
        </div>
      </aside>
    </div>
  </main>;
}

function ProjectPage({ project, refresh, setPage }) {
  const [retrying, setRetrying] = useState('');
  const isBusy = ['uploaded', 'analyzing', 'generating'].includes(project.status);
  const stages = [
    { label: 'Video uploaded', done: true },
    { label: 'Storyboard ready', done: project.scenes.length > 0, current: project.status === 'uploaded' || project.status === 'analyzing' },
    { label: 'Recast in progress', done: project.status === 'complete', current: project.status === 'generating' },
    { label: 'Final video ready', done: project.status === 'complete', current: false }
  ];
  async function retryScene(scene) {
    setRetrying(scene.id);
    try { await request(`/projects/${project.id}/scenes/${scene.id}/retry`, { method: 'POST' }); await refresh(); }
    catch (error) { window.alert(error.message); } finally { setRetrying(''); }
  }
  async function retryAnalysis() {
    try { await request(`/projects/${project.id}/retry`, { method: 'POST' }); await refresh(); }
    catch (error) { window.alert(error.message); }
  }
  return <main className="page-shell">
    <button className="back-link" onClick={() => setPage({ name: 'home' })}><ArrowLeft size={15} /> All projects</button>
    <div className="page-title-row"><div><div className="eyebrow"><Film size={13} /> PROJECT OVERVIEW</div><h1>{project.name}</h1><p className="muted">Created {new Date(project.created_at + (project.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}</p></div><span className={`status-pill large status-${project.status}`}>{isBusy && <LoaderCircle size={14} className="spin" />}{project.status === 'failed' ? 'Needs attention' : statusNames[project.status]}</span></div>
    <div className="project-layout">
      <div className="project-main">
        {project.status === 'complete' && project.output_key ?         <section className="final-video-card"><div className="final-video-heading"><div><div className="eyebrow"><Sparkles size={13} /> THE FINAL CUT</div><h2>Your story, recast.</h2></div><a className="button button-primary" href={project.output_url} download={`${project.name}-recast.mp4`}><ArrowDownToLine size={16} /> Download video</a></div><video controls src={project.output_url} /><div className="video-meta"><span><CheckCircle2 size={14} /> Ready to watch</span><span><Clock3 size={14} /> {formatTime(project.duration)}</span><span><Film size={14} /> {project.scenes.length} scenes</span></div></section> :
          <section className={`progress-card ${project.status === 'failed' ? 'progress-error' : ''}`}><div className="progress-card-icon">{project.status === 'failed' ? <X size={21} /> : isBusy ? <LoaderCircle size={21} className="spin" /> : <Clapperboard size={21} />}</div><div><h2>{project.status === 'failed' ? 'We hit a snag.' : project.status === 'analyzing' ? 'Finding the story in every scene.' : project.status === 'generating' ? 'Your new story is taking shape.' : 'Your project is ready to begin.'}</h2><p>{project.error || (project.status === 'analyzing' ? 'We’re finding scene changes, keyframes, and dialogue. This page updates as the work progresses.' : project.status === 'generating' ? 'Scenes are being created in parallel. You can safely leave and come back.' : 'Your video is uploaded. Storyboard analysis is queued.')}</p>
            {project.status === 'failed' && !project.scenes.some(scene => scene.status === 'failed') && <button className="button button-secondary small" onClick={retryAnalysis}><RefreshCw size={14} /> Retry {project.jobs.some(job => job.type === 'finalize' && job.status === 'failed') ? 'video assembly' : project.jobs.some(job => job.type === 'generation' && job.status === 'failed') ? 'prompt writing' : 'analysis'}</button>}
          </div></section>}
        {project.scenes.length > 0 && <section className="scene-progress-section"><div className="section-heading compact"><div><div className="eyebrow">SCENE BREAKDOWN</div><h2>Your scenes <span className="count-badge">{project.scenes.length}</span></h2></div>{['storyboard_ready', 'generating', 'complete'].includes(project.status) && <button className="text-button" onClick={() => setPage({ name: 'storyboard', id: project.id })}>Edit storyboard <ArrowRight size={14} /></button>}</div><div className="scene-progress-list">{project.scenes.map(scene => <div className="scene-progress-row" key={scene.id}><div className="tiny-thumb"><img src={scene.keyframe_url} alt="" /></div><div className="scene-progress-copy"><strong>Scene {String(scene.scene_number).padStart(2, '0')}</strong><span>{scene.description || 'Scene details ready'}</span></div><span className={`scene-state state-${scene.status}`}>{scene.status === 'complete' ? <CheckCircle2 size={14} /> : scene.status === 'failed' ? <X size={14} /> : scene.status === 'queued' || scene.status === 'generating' ? <LoaderCircle className="spin" size={14} /> : <Clock3 size={14} />}{scene.status === 'complete' ? 'Complete' : scene.status === 'failed' ? 'Failed' : scene.status === 'queued' || scene.status === 'generating' ? 'In progress' : 'Waiting'}</span>{['failed', 'complete'].includes(scene.status) && <button className="retry-scene" disabled={retrying === scene.id} onClick={() => retryScene(scene)}>{retrying === scene.id ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}{scene.status === 'complete' ? 'Regenerate' : 'Retry'}</button>}</div>)}</div></section>}
      </div>
      <aside className="project-aside"><section className="stage-card"><div className="eyebrow">PROJECT STATUS</div><div className="stage-list">{stages.map((stage, index) => <div className={`stage-item ${stage.done ? 'done' : ''} ${stage.current ? 'current' : ''}`} key={stage.label}><span className="stage-mark">{stage.done ? <Check size={13} /> : stage.current ? <LoaderCircle size={13} className="spin" /> : index + 1}</span><div><strong>{stage.label}</strong>{stage.current && <small>Working on it now…</small>}</div></div>)}</div></section><section className="project-help"><div className="help-icon"><ShieldCheck size={17} /></div><strong>Your project stays yours.</strong><p>Only you can see your project and its generated video. You can safely close this page while we work.</p></section>{project.scenes.length > 0 && project.status === 'storyboard_ready' && <button className="button button-primary full" onClick={() => setPage({ name: 'recast', id: project.id })}><WandSparkles size={16} /> Start recasting <ArrowRight size={15} /></button>}</aside>
    </div>
  </main>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState({ name: 'home' });
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refreshProjects() {
    const data = await request('/projects'); setProjects(data);
  }
  async function refreshProject(id = page.id) {
    if (!id) return;
    const data = await request(`/projects/${id}`); setProject(data);
  }
  useEffect(() => {
    if (!readToken()) { setLoading(false); return; }
    Promise.all([request('/auth/me'), request('/projects')]).then(([auth, data]) => { setProjects(data); setUser(auth.user); }).catch(() => localStorage.removeItem('recast-token')).finally(() => setLoading(false));
    request('/meta').then(setMeta).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user || !page.id) { setProject(null); return; }
    refreshProject(page.id).catch(() => setPage({ name: 'home' }));
  }, [page.id, user]);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      refreshProjects().catch(() => {});
      if (page.id) refreshProject(page.id).catch(() => {});
    }, 3500);
    return () => window.clearInterval(timer);
  }, [user, page.id]);

  if (loading) return <div className="loading-screen"><span className="brand-mark"><Clapperboard size={18} /></span><LoaderCircle className="spin" size={18} /></div>;
  if (!user) return <AuthScreen onAuth={userData => { setUser(userData); request('/meta').then(setMeta).catch(() => {}); refreshProjects().catch(() => {}); }} />;
  function logout() { localStorage.removeItem('recast-token'); setUser(null); setProject(null); setPage({ name: 'home' }); }

  return <div className="app-shell"><Header user={user} page={page} setPage={setPage} onLogout={logout} />
    {page.name === 'home' && <HomePage user={user} projects={projects} refreshProjects={() => refreshProjects().catch(() => {})} setPage={setPage} />}
    {page.name === 'project' && (project ? <ProjectPage project={project} refresh={() => refreshProject()} setPage={setPage} /> : <div className="loading-screen"><LoaderCircle className="spin" /></div>)}
    {page.name === 'storyboard' && (project ? <StoryboardPage project={project} refresh={() => refreshProject()} setPage={setPage} /> : <div className="loading-screen"><LoaderCircle className="spin" /></div>)}
    {page.name === 'recast' && (project ? <RecastPage project={project} refresh={() => refreshProject()} setPage={setPage} meta={meta} /> : <div className="loading-screen"><LoaderCircle className="spin" /></div>)}
    <footer className="app-footer"><span>RECAST · A NEW POINT OF VIEW ON EVERY STORY</span><span><ShieldCheck size={12} /> Private by design</span></footer>
  </div>;
}
