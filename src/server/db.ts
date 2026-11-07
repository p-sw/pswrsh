// Account database. One node:sqlite file in PSWRSH_DATA_DIR, outside the repository.
// The directory is 0700 and its files 0600. Shared by the Next server and the gateway,
// so it uses relative .ts imports and no TypeScript-only runtime syntax.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATA_DIR = process.env.PSWRSH_DATA_DIR || "/var/lib/openbot/pswrsh-data";
const DB_FILE = join(DATA_DIR, "accounts.sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS setup_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  completed_at INTEGER,
  -- Off on a new install until the owner decides to open signup. Only used when the table is created.
  signup_enabled INTEGER NOT NULL DEFAULT 0,
  smtp_checked_hash TEXT,
  smtp_checked_at INTEGER
);
INSERT OR IGNORE INTO setup_state (id) VALUES (1);
CREATE TABLE IF NOT EXISTS smtp_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  security TEXT NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  from_address TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS one_time_codes (
  id INTEGER PRIMARY KEY,
  purpose TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS one_time_codes_lookup ON one_time_codes(purpose, email);
CREATE TABLE IF NOT EXISTS login_failures (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_email ON login_failures(email, at);
CREATE INDEX IF NOT EXISTS login_failures_ip ON login_failures(ip, at);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);
-- The vault the browser encrypts (hosts, keys, known hosts). The server never sees the passphrase.
CREATE TABLE IF NOT EXISTS vaults (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/** Columns added to users after the first release. Existing databases get them on open. */
const USER_COLUMNS: [string, string][] = [
  ["keep_alive_minutes", "INTEGER NOT NULL DEFAULT 30"],
  ["email_otp", "INTEGER NOT NULL DEFAULT 0"],
  ["totp_secret", "TEXT"],
  ["totp_pending", "TEXT"],
  ["totp_last_step", "INTEGER"],
  ["terminal_style", "TEXT"],
];

function migrate(database: DatabaseSync) {
  const existing = new Set(
    (database.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((column) => column.name),
  );
  for (const [name, type] of USER_COLUMNS) {
    if (!existing.has(name)) database.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  }
}

const globalForDb = globalThis as typeof globalThis & { __pswrshDb?: DatabaseSync };

/** Opens the database once per process, creating the directory and tables. */
export function db(): DatabaseSync {
  if (globalForDb.__pswrshDb) return globalForDb.__pswrshDb;
  ensureDataDir();
  const created = !existsSync(DB_FILE);
  const database = new DatabaseSync(DB_FILE);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  database.exec(SCHEMA);
  migrate(database);
  if (created) chmodSync(DB_FILE, 0o600);
  // SQLite creates the WAL side files with the process umask.
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(DB_FILE + suffix)) chmodSync(DB_FILE + suffix, 0o600);
  }
  globalForDb.__pswrshDb = database;
  return database;
}

export function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  chmodSync(DATA_DIR, 0o700);
}

export function now() {
  return Date.now();
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
