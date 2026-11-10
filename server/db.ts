import { DatabaseSync } from 'node:sqlite';

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      username   TEXT PRIMARY KEY,
      role       TEXT NOT NULL CHECK (role IN ('cashier','manager','admin')),
      salt       TEXT NOT NULL,
      hash       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      disabled   INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    -- Append-only change log. Every device pushes its changes here and pulls everyone else's.
    CREATE TABLE IF NOT EXISTS changes (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id   TEXT NOT NULL,
      client_id   INTEGER NOT NULL,
      entity      TEXT NOT NULL,
      op          TEXT NOT NULL,
      payload     TEXT NOT NULL,
      at          INTEGER NOT NULL,
      user        TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      UNIQUE (device_id, client_id)  -- makes pushes idempotent: retries never duplicate
    );
  `);
  // older databases: add the column that lets a password change end old sessions
  const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'token_version')) db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  return db;
}
