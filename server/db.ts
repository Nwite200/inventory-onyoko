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
    -- One server can run several separate businesses. Each has its own people and its own data.
    CREATE TABLE IF NOT EXISTS businesses (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  // older databases: add columns step by step
  const has = (table: string, col: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  if (!has('users', 'token_version')) db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  if (!has('users', 'business_id')) db.exec("ALTER TABLE users ADD COLUMN business_id TEXT NOT NULL DEFAULT 'main'");
  if (!has('users', 'is_super')) db.exec('ALTER TABLE users ADD COLUMN is_super INTEGER NOT NULL DEFAULT 0');
  if (!has('changes', 'business_id')) db.exec("ALTER TABLE changes ADD COLUMN business_id TEXT NOT NULL DEFAULT 'main'");
  db.exec('CREATE INDEX IF NOT EXISTS changes_business_seq ON changes (business_id, seq)');
  // a server that was running before businesses existed: everything belongs to business "main",
  // and its first admin becomes the platform owner (the one who may add more businesses)
  const users = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (users > 0) {
    db.prepare("INSERT OR IGNORE INTO businesses (id, name, created_at) VALUES ('main', 'My business', ?)").run(Date.now());
    const supers = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_super = 1').get() as { n: number }).n;
    if (supers === 0) db.exec("UPDATE users SET is_super = 1 WHERE username = (SELECT username FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)");
  }
  return db;
}
