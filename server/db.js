import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'ktv.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL,
      search TEXT NOT NULL DEFAULT '', duration REAL DEFAULT 0, audio TEXT DEFAULT '[]', mode TEXT DEFAULT 'original',
      backing INTEGER DEFAULT 0, vocal INTEGER DEFAULT 0, status TEXT DEFAULT 'new', error TEXT DEFAULT '',
      source TEXT DEFAULT 'local', created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id), name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, error TEXT DEFAULT '', created INTEGER NOT NULL);
  `);
  const columns=db.prepare('PRAGMA table_info(songs)').all().map(c=>c.name);
  if(!columns.includes('needs_video'))db.exec("ALTER TABLE songs ADD COLUMN needs_video INTEGER DEFAULT 0");
  if(!columns.includes('lyrics'))db.exec("ALTER TABLE songs ADD COLUMN lyrics TEXT DEFAULT ''");
  const get = (key, fallback) => { const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; };
  const set = (key, value) => db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, JSON.stringify(value));
  if (!get('roomToken')) set('roomToken', randomBytes(24).toString('hex'));
  if (!get('playback')) set('playback', { paused: false, vocal: false, revision: 0 });
  db.prepare("UPDATE jobs SET status='queued',error='' WHERE status='running'").run();
  return { db, get, set };
}
