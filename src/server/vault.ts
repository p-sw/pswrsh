// The account's vault, stored as the ciphertext the browser sealed. The server checks
// only its shape; it cannot read hosts, passwords or keys without the vault passphrase.
import { db, now } from "./db.ts";

/** Upper bound for one sealed vault. Keys and hosts are small; this leaves plenty of room. */
const MAX_VAULT_CHARS = 8 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type SealedVault = {
  version: number;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  iv: string;
  ciphertext: string;
};

function isBase64(value: unknown, maxChars: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxChars && BASE64.test(value);
}

/** The sealed vault from a request body, or null when it is not one. */
export function parseSealedVault(input: unknown): SealedVault | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const kdf = value.kdf as Record<string, unknown> | undefined;
  if (!Number.isInteger(value.version) || (value.version as number) < 1) return null;
  if (!kdf || kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256") return null;
  if (!Number.isInteger(kdf.iterations) || (kdf.iterations as number) < 100_000 || (kdf.iterations as number) > 10_000_000) return null;
  if (!isBase64(kdf.salt, 64) || !isBase64(value.iv, 64) || !isBase64(value.ciphertext, MAX_VAULT_CHARS)) return null;
  return {
    version: value.version as number,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations as number, salt: kdf.salt as string },
    iv: value.iv as string,
    ciphertext: value.ciphertext as string,
  };
}

export function readVaultRow(userId: number): { vault: SealedVault; revision: number } | null {
  const row = db().prepare("SELECT data, revision FROM vaults WHERE user_id = ?").get(userId) as
    | { data: string; revision: number }
    | undefined;
  if (!row) return null;
  return { vault: JSON.parse(row.data) as SealedVault, revision: row.revision };
}

/**
 * Writes the vault when the caller saw the current revision (0: no vault yet).
 * Returns the new revision, or null when another browser wrote first.
 */
export function writeVaultRow(userId: number, vault: SealedVault, expected: number): number | null {
  const data = JSON.stringify(vault);
  const at = now();
  if (expected === 0) {
    const result = db()
      .prepare("INSERT OR IGNORE INTO vaults (user_id, data, revision, updated_at) VALUES (?, ?, 1, ?)")
      .run(userId, data, at);
    return result.changes === 1 ? 1 : null;
  }
  const result = db()
    .prepare("UPDATE vaults SET data = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?")
    .run(data, at, userId, expected);
  return result.changes === 1 ? expected + 1 : null;
}

export function deleteVaultRow(userId: number) {
  db().prepare("DELETE FROM vaults WHERE user_id = ?").run(userId);
}
