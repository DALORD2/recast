import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.on('error', error => reject(new Error(`${command} could not start: ${error.message}`)));
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-1200)}`)));
  });
}

export async function probeVideo(filePath) {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', filePath]);
  const details = JSON.parse(stdout);
  const duration = Number(details.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The uploaded file does not contain a readable video stream.');
  if (!details.streams?.some(stream => stream.codec_type === 'video')) throw new Error('The uploaded file has no video stream.');
  if (duration > 180) throw new Error('Videos must be 3 minutes or shorter.');
  return duration;
}

export async function normalizeSceneVideo(inputPath, voicePath, outputPath, duration) {
  const args = ['-hide_banner', '-loglevel', 'error', '-i', inputPath];
  if (voicePath) args.push('-i', voicePath);
  else args.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  const voiceInput = voicePath ? '1:a:0' : '1:a:0';
  const filters = [
    '[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,tpad=stop_mode=clone:stop_duration=20,setsar=1[v]'
  ];
  if (voicePath) {
    const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', voicePath]);
    const voiceDuration = Number(stdout.trim());
    if (Number.isFinite(voiceDuration) && voiceDuration > 0) {
      let speed = voiceDuration / duration;
      const tempo = [];
      while (speed > 2) { tempo.push('atempo=2'); speed /= 2; }
      while (speed < 0.5) { tempo.push('atempo=0.5'); speed /= 0.5; }
      tempo.push(`atempo=${speed.toFixed(5)}`);
      filters.push(`[${voiceInput}]${tempo.join(',')}[a]`);
      args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]');
    } else {
      args.push('-filter_complex', filters[0], '-map', '[v]', '-map', voiceInput);
    }
  } else {
    args.push('-filter_complex', filters[0], '-map', '[v]', '-map', voiceInput);
  }
  args.push('-t', String(duration), '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', outputPath);
  await run(ffmpeg, args);
}

export async function extractStoryboardFrames(filePath, outputDir) {
  await fs.promises.mkdir(outputDir, { recursive: true });
  const detection = await run(ffmpeg, ['-hide_banner', '-i', filePath, '-vf', "select='gt(scene,0.28)',showinfo", '-vsync', 'vfr', '-f', 'null', '-']);
  const cutTimes = [...detection.stderr.matchAll(/pts_time:([0-9.]+)/g)]
    .map(match => Number(match[1])).filter(Number.isFinite);
  let times = cutTimes.length >= 2 ? [0, ...cutTimes] : null;
  const duration = await probeVideo(filePath);
  if (!times) {
    times = [];
    for (let time = 0; time < duration; time += 3) times.push(time);
  }
  times = [...new Set(times.filter(time => time < duration))].sort((a, b) => a - b).slice(0, 60);
  const ranges = [];
  for (let index = 0; index < times.length; index += 1) {
    const boundaryStart = times[index];
    const boundaryEnd = times[index + 1] ?? duration;
    for (let start = boundaryStart; start < boundaryEnd; start += 20) {
      ranges.push({ start, end: Math.min(start + 20, boundaryEnd) });
    }
  }
  const scenes = [];
  for (let index = 0; index < ranges.length; index += 1) {
    const { start, end } = ranges[index];
    const keyframePath = path.join(outputDir, `scene-${index + 1}.jpg`);
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-i', filePath, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', keyframePath]);
    scenes.push({ start, end, keyframePath });
  }
  const audioPath = path.join(outputDir, 'audio.wav');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-y', audioPath]).catch(error => {
    if (!/does not contain any stream|Output file is empty/i.test(error.message)) throw error;
  });
  return { scenes, audioPath, duration };
}

export function tempDirectory(prefix = 'recast-') {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function createFinalVideo(scenePaths, outputPath, sourcePath, mixOriginalAudio) {
  if (!scenePaths.length) throw new Error('No generated scene clips are available to combine.');
  const dir = path.dirname(outputPath);
  const listPath = path.join(dir, 'clips.txt');
  const lines = scenePaths.map(file => `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
  await fs.promises.writeFile(listPath, lines.join('\n'), 'utf8');
  const intermediate = path.join(dir, 'joined.mp4');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', intermediate]);
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', sourcePath]);
  const hasSourceAudio = JSON.parse(stdout).streams?.some(stream => stream.codec_type === 'audio');
  if (mixOriginalAudio && hasSourceAudio) {
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', intermediate, '-i', sourcePath, '-filter_complex', '[1:a]volume=0.12[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-y', outputPath]);
    await fs.promises.rm(intermediate, { force: true });
  } else {
    await fs.promises.rename(intermediate, outputPath);
  }
  await fs.promises.rm(listPath, { force: true });
}
