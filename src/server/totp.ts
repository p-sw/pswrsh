// TOTP (RFC 6238): SHA-1, 30-second steps, 6 digits, one step of clock drift either way.
// A code is accepted once; the last used step is stored.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, now } from "./db.ts";
import { seal, unseal } from "./secret-box.ts";

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/[\s=]/g, "").toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("bad base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpAt(secret: Buffer, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(number).padStart(DIGITS, "0");
}

/** The matching step, or null. Steps at or before `lastStep` are refused (no replay). */
export function matchTotp(secretBase32: string, code: unknown, lastStep: number | null) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return null;
  const secret = base32Decode(secretBase32);
  const current = Math.floor(now() / 1000 / STEP_SECONDS);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code.trim()))) return step;
  }
  return null;
}

export function newTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(email: string, secret: string) {
  const label = encodeURIComponent(`pswrsh:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=pswrsh&algorithm=SHA1&digits=6&period=30`;
}

/** Starts enrollment: a new secret waits in totp_pending until a code confirms it. */
export function beginTotp(userId: number) {
  const secret = newTotpSecret();
  db().prepare("UPDATE users SET totp_pending = ? WHERE id = ?").run(seal(secret), userId);
  return secret;
}

export function confirmTotp(userId: number, code: unknown) {
  const row = db().prepare("SELECT totp_pending FROM users WHERE id = ?").get(userId) as { totp_pending: string | null };
  if (!row.totp_pending) return false;
  const step = matchTotp(unseal(row.totp_pending), code, null);
  if (step === null) return false;
  db()
    .prepare("UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = ? WHERE id = ?")
    .run(step, userId);
  return true;
}

export function verifyTotpForUser(userId: number, code: unknown) {
  const row = db().prepare("SELECT totp_secret, totp_last_step FROM users WHERE id = ?").get(userId) as
    | { totp_secret: string | null; totp_last_step: number | null }
    | undefined;
  if (!row?.totp_secret) return false;
  const step = matchTotp(unseal(row.totp_secret), code, row.totp_last_step);
  if (step === null) return false;
  db().prepare("UPDATE users SET totp_last_step = ? WHERE id = ?").run(step, userId);
  return true;
}

export function disableTotp(userId: number) {
  db().prepare("UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_last_step = NULL WHERE id = ?").run(userId);
}
