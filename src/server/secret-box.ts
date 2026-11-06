// Encrypts small server-side secrets (TOTP keys) with AES-256-GCM. The key is
// PSWRSH_DATA_DIR/secret.key, 32 random bytes, 0600, created on first use. It never
// goes into the repository, the database, or the logs.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, ensureDataDir } from "./db.ts";

const KEY_FILE = join(DATA_DIR, "secret.key");
const VERSION = "v1";

let cached: Buffer | undefined;

function key() {
  if (cached) return cached;
  ensureDataDir();
  if (!existsSync(KEY_FILE)) {
    try {
      writeFileSync(KEY_FILE, randomBytes(32), { mode: 0o600, flag: "wx" });
    } catch (error) {
      // Another process created it first.
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
  }
  chmodSync(KEY_FILE, 0o600);
  const value = readFileSync(KEY_FILE);
  if (value.length !== 32) throw new Error("secret.key must hold 32 bytes");
  cached = value;
  return value;
}

export function seal(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function unseal(sealed: string) {
  const [version, data] = sealed.split(":");
  if (version !== VERSION || !data) throw new Error("unknown sealed format");
  const raw = Buffer.from(data, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
