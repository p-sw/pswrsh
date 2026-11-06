// First-run setup. Until an admin exists, every page leads to /setup, and the setup API
// needs the token from PSWRSH_DATA_DIR/setup-token. Setup closes once it completes.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, db, ensureDataDir, now } from "./db.ts";

const TOKEN_FILE = join(DATA_DIR, "setup-token");
/** A tested SMTP configuration stays valid for completing setup this long. */
const SMTP_CHECK_TTL_MS = 30 * 60 * 1000;

export function isSetupComplete() {
  const row = db().prepare("SELECT completed_at FROM setup_state WHERE id = 1").get() as
    | { completed_at: number | null }
    | undefined;
  return Boolean(row?.completed_at);
}

/** Creates the setup token on first run and prints it once. Does nothing after setup. */
export function ensureSetupToken() {
  if (isSetupComplete()) return;
  ensureDataDir();
  if (existsSync(TOKEN_FILE)) return;
  const token = randomBytes(24).toString("base64url");
  writeFileSync(TOKEN_FILE, token + "\n", { mode: 0o600, flag: "wx" });
  console.log(`[pswrsh] setup token: ${token} (also in ${TOKEN_FILE})`);
}

export function checkSetupToken(value: unknown) {
  if (typeof value !== "string" || !existsSync(TOKEN_FILE)) return false;
  const expected = Buffer.from(readFileSync(TOKEN_FILE, "utf8").trim());
  const given = Buffer.from(value.trim());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function recordSmtpCheck(fingerprint: string) {
  db().prepare("UPDATE setup_state SET smtp_checked_hash = ?, smtp_checked_at = ? WHERE id = 1").run(fingerprint, now());
}

export function smtpWasChecked(fingerprint: string) {
  const row = db().prepare("SELECT smtp_checked_hash, smtp_checked_at FROM setup_state WHERE id = 1").get() as {
    smtp_checked_hash: string | null;
    smtp_checked_at: number | null;
  };
  return row.smtp_checked_hash === fingerprint && now() - (row.smtp_checked_at ?? 0) < SMTP_CHECK_TTL_MS;
}

export function markSetupComplete() {
  db()
    .prepare("UPDATE setup_state SET completed_at = ?, smtp_checked_hash = NULL, smtp_checked_at = NULL WHERE id = 1")
    .run(now());
  rmSync(TOKEN_FILE, { force: true });
}

export function isSignupEnabled() {
  const row = db().prepare("SELECT signup_enabled FROM setup_state WHERE id = 1").get() as { signup_enabled: number };
  return row.signup_enabled === 1;
}

export function setSignupEnabled(enabled: boolean) {
  db().prepare("UPDATE setup_state SET signup_enabled = ? WHERE id = 1").run(enabled ? 1 : 0);
}
