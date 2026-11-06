// Login sessions. The cookie holds a random 32-byte token; the database only its SHA-256.
// Also used by the gateway, so it keeps to relative .ts imports.
import { createHash, randomBytes } from "node:crypto";
import { db, now } from "./db.ts";

export const SESSION_COOKIE = "pswrsh_session";
const IDLE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most this often. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export type SessionUser = { id: number; email: string; isAdmin: boolean };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const at = now();
  db()
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)")
    .run(hashToken(token), userId, at, at);
  return { token, maxAgeSeconds: Math.floor(MAX_AGE_MS / 1000) };
}

/** The user for a session token, or null when it is unknown or expired. Refreshes idle time. */
export function findSession(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db()
    .prepare(
      `SELECT s.created_at, s.last_seen_at, u.id, u.email, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as
    | { created_at: number; last_seen_at: number; id: number; email: string; is_admin: number }
    | undefined;
  if (!row) return null;
  const at = now();
  if (at - row.last_seen_at > IDLE_MS || at - row.created_at > MAX_AGE_MS) {
    db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  if (at - row.last_seen_at > TOUCH_INTERVAL_MS) {
    db().prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(at, tokenHash);
  }
  return { id: row.id, email: row.email, isAdmin: row.is_admin === 1 };
}

export function deleteSession(token: string | undefined | null) {
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function deleteUserSessions(userId: number) {
  db().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/** Ends every session of the user except the one making the request. */
export function deleteOtherSessions(userId: number, keepToken: string | undefined | null) {
  db()
    .prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
    .run(userId, keepToken ? hashToken(keepToken) : "");
}

/** Reads one cookie from a raw Cookie header. */
export function readCookie(header: string | undefined | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}
