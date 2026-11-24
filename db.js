import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'recast.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'uploaded',
    source_key TEXT NOT NULL, output_key TEXT, duration REAL NOT NULL DEFAULT 0,
    error TEXT, options_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scene_number INTEGER NOT NULL, start_time REAL NOT NULL, end_time REAL NOT NULL,
    keyframe_key TEXT, transcript TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    camera TEXT NOT NULL DEFAULT '', setting TEXT NOT NULL DEFAULT '',
    characters_json TEXT NOT NULL DEFAULT '[]', tone TEXT NOT NULL DEFAULT '',
    safety TEXT NOT NULL DEFAULT 'allowed', safety_reason TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '', output_key TEXT, status TEXT NOT NULL DEFAULT 'pending',
    error TEXT
  );
  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, description TEXT NOT NULL, voice TEXT NOT NULL DEFAULT 'alloy',
    reference_key TEXT
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
    type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS jobs_pending_idx ON jobs(status, created_at);
  CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id, created_at);
`);

const sceneColumns = new Set(db.prepare('PRAGMA table_info(scenes)').all().map(column => column.name));
if (!sceneColumns.has('safety')) db.exec("ALTER TABLE scenes ADD COLUMN safety TEXT NOT NULL DEFAULT 'allowed'");
if (!sceneColumns.has('safety_reason')) db.exec("ALTER TABLE scenes ADD COLUMN safety_reason TEXT NOT NULL DEFAULT ''");

export function projectForUser(projectId, userId) {
  return db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
}

export function getProjectDetails(projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  return {
    ...project,
    options: JSON.parse(project.options_json || '{}'),
    scenes: db.prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_number').all(projectId)
      .map(scene => ({ ...scene, characters: JSON.parse(scene.characters_json || '[]') })),
    characters: db.prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY rowid').all(projectId),
    jobs: db.prepare('SELECT id, type, scene_id, status, attempts, error, created_at FROM jobs WHERE project_id = ? ORDER BY created_at').all(projectId)
  };
}
