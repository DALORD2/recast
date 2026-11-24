import fs from 'node:fs';
import path from 'node:path';
import { putBuffer } from './storage.js';

const anthropicKey = process.env.ANTHROPIC_API_KEY;
const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

async function anthropic(prompt, imagePath) {
  if (!anthropicKey) throw new Error('Storyboard and prompt generation require ANTHROPIC_API_KEY. Add it to .env and restart the server.');
  const content = [];
  if (imagePath) {
    const image = await fs.promises.readFile(imagePath);
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } });
  }
  content.push({ type: 'text', text: prompt });
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: anthropicModel, max_tokens: 1800, messages: [{ role: 'user', content }] })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Anthropic request failed (${response.status}).`);
  return data.content?.map(item => item.text || '').join('\n') || '';
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const begin = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (begin < 0 || end < begin) throw new Error('AI response did not contain valid JSON.');
  return JSON.parse(cleaned.slice(begin, end + 1));
}

export async function transcribe(audioPath) {
  if (!process.env.OPENAI_API_KEY) return [];
  if (!fs.existsSync(audioPath)) return [];
  const form = new FormData();
  form.append('file', new Blob([await fs.promises.readFile(audioPath)]), 'audio.wav');
  form.append('model', process.env.OPENAI_STT_MODEL || 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Speech transcription failed (${response.status}).`);
  return data.segments || [];
}

export async function analyzeScene(framePath, transcript) {
  const text = await anthropic(
    `Analyze this video frame and transcript. Return only JSON with keys description (one sentence), camera, setting, characters (array of {name, action}), tone, safety (one of "allowed", "identifiable_person", "sexual", "violent"), and safety_reason. Do not identify real people. Set identifiable_person if a person appears identifiable; this is a permission check, not an automatic rejection. Flag sexual or graphic/violent content for rejection. Transcript for this scene: ${JSON.stringify(transcript)}`
    , framePath);
  return parseJson(text);
}

export async function writeScenePrompts(scenes, characters, style, customScript, characterMappings = {}) {
  const bible = characters.map(character => `${character.name}: ${character.description}`).join('\n');
  const text = await anthropic(
    `You write consistent, production-ready prompts for an image-to-video model. Return JSON: {"scenes":[{"scene_number":1,"dialogue":"...","prompt":"..."}]}. Character bible (include full character descriptions in every prompt):\n${bible}\nOriginal-to-replacement character mappings: ${JSON.stringify(characterMappings)}\nStyle: ${style}. ${customScript ? `Adapt this user-provided script across scene durations without changing its meaning: ${customScript}` : 'Keep the original scene dialogue unchanged.'}\nFor each scene, include setting, action, camera, tone, style, character appearance and action, and duration-aware motion. Replace source people with the original replacement-character designs and do not reproduce identifiable real people's likenesses. Reject sexual or graphic/violent requests by returning {"blocked":true,"reason":"..."}. Scenes:\n${JSON.stringify(scenes.map(scene => ({ scene_number: scene.scene_number, duration: scene.end_time - scene.start_time, description: scene.description, camera: scene.camera, setting: scene.setting, transcript: scene.transcript })))}`
  );
  return parseJson(text);
}

export async function reviewManualPrompts(prompts, characters, permissionConfirmed) {
  const text = await anthropic(
    `Review user-supplied video prompts and character descriptions against these rules: reject sexual content, graphic violence, and depictions of identifiable real people without permission. Permission confirmation: ${permissionConfirmed ? 'the user confirms they have permission to use identifiable people in the source video; require replacement-character designs and do not reproduce their likenesses' : 'not confirmed'}. Return only JSON {"allowed":true} or {"allowed":false,"reason":"..."}. Character descriptions: ${JSON.stringify(characters.map(character => character.description))}. Prompts: ${JSON.stringify(prompts)}`
  );
  return parseJson(text);
}

export async function prepareAnalysis(framePath, transcript) {
  return analyzeScene(framePath, transcript);
}

export async function generateSpeech(text, voice, outputPath) {
  if (!text?.trim() || !process.env.OPENAI_API_KEY) return false;
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'tts-1', voice: voice || 'alloy', input: text })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Voice generation failed (${response.status}).`);
  }
  await fs.promises.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return true;
}

export async function generateVideo(prompt, duration, keyframePath, referencePath, outputPath) {
  const endpoint = process.env.VIDEO_PROVIDER_URL;
  if (!endpoint) throw new Error('No video provider is configured. Set VIDEO_PROVIDER_URL and VIDEO_PROVIDER_API_KEY, or use Manual Hand-off to prepare prompts.');
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('duration', String(Math.max(1, Math.min(20, Math.round(duration)))));
  form.append('keyframe', new Blob([await fs.promises.readFile(keyframePath)]), path.basename(keyframePath));
  if (referencePath && fs.existsSync(referencePath)) form.append('reference', new Blob([await fs.promises.readFile(referencePath)]), path.basename(referencePath));
  const headers = process.env.VIDEO_PROVIDER_API_KEY ? { authorization: `Bearer ${process.env.VIDEO_PROVIDER_API_KEY}` } : {};
  const response = await fetch(endpoint, { method: 'POST', headers, body: form });
  let data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Video provider request failed (${response.status}).`);
  if (data.job_id) {
    const statusUrl = process.env.VIDEO_PROVIDER_STATUS_URL;
    if (!statusUrl) throw new Error('Video provider returned a job_id but VIDEO_PROVIDER_STATUS_URL is not configured.');
    const url = statusUrl.replace('{job_id}', encodeURIComponent(data.job_id));
    let complete = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const poll = await fetch(url, { headers });
      data = await poll.json().catch(() => ({}));
      if (!poll.ok) throw new Error(data.error || `Video provider status check failed (${poll.status}).`);
      if (data.status === 'failed') throw new Error(data.error || 'Video provider could not generate this scene.');
      if (data.status === 'completed' && data.video_url) { complete = true; break; }
    }
    if (!complete) throw new Error('Video provider timed out while generating a scene.');
  }
  if (!data.video_url) throw new Error('Video provider response needs a video_url or job_id.');
  const videoResponse = await fetch(data.video_url);
  if (!videoResponse.ok) throw new Error(`Could not download generated scene (${videoResponse.status}).`);
  const buffer = Buffer.from(await videoResponse.arrayBuffer());
  await fs.promises.writeFile(outputPath, buffer);
  return buffer;
}

export async function persistProviderOutput(key, outputPath) {
  await putBuffer(key, await fs.promises.readFile(outputPath), 'video/mp4');
}
