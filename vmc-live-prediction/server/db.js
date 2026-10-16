import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'vmc.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  recovery_pin_hash TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(room_id, nickname)
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  options_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  correct_option TEXT,
  base_points INTEGER NOT NULL DEFAULT 100,
  underdog_enabled INTEGER NOT NULL DEFAULT 1,
  underdog_threshold REAL NOT NULL DEFAULT 15,
  underdog_multiplier REAL NOT NULL DEFAULT 2,
  min_votes INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL,
  opened_at TEXT,
  locked_at TEXT,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  UNIQUE(question_id, player_id)
);
CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  multiplier REAL NOT NULL DEFAULT 1,
  is_correct INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(question_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_questions_room ON questions(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_predictions_question ON predictions(question_id);
CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
`);

// Safe in-place migration for databases created by earlier versions.
const playerColumns = db.prepare('PRAGMA table_info(players)').all().map(column => column.name);
if (!playerColumns.includes('recovery_pin_hash')) {
  db.exec('ALTER TABLE players ADD COLUMN recovery_pin_hash TEXT');
}

export default db;