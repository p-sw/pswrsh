// Unit tests for the server-side vault store (src/server/vault.ts) against a temp SQLite file.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, test } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pswrsh-vault-"));
process.env.PSWRSH_DATA_DIR = dataDir;
const v = await import("../../src/server/vault.ts");
const { db } = await import("../../src/server/db.ts");

after(() => rmSync(dataDir, { recursive: true, force: true }));

const b64 = (n: number) => Buffer.alloc(n, 7).toString("base64");
function sealed(over: Record<string, unknown> = {}, kdfOver: Record<string, unknown> = {}) {
  return {
    version: 2,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600_000, salt: b64(16), ...kdfOver },
    iv: b64(12),
    ciphertext: b64(64),
    ...over,
  };
}

function user(id: number) {
  db().prepare("INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', 0)").run(id, `v${id}@t.test`);
}

describe("parseSealedVault: accepts", () => {
  test("a well-formed sealed vault and returns only known fields", () => {
    const out = v.parseSealedVault({ ...sealed(), extra: "drop me", kdf: { ...sealed().kdf, junk: 1 } });
    assert.deepEqual(out, sealed());
  });
  for (const iterations of [100_000, 10_000_000]) {
    test(`iterations at the bound ${iterations}`, () => {
      assert.ok(v.parseSealedVault(sealed({}, { iterations })));
    });
  }
  test("version 1 (legacy upload)", () => {
    assert.ok(v.parseSealedVault(sealed({ version: 1 })));
  });
  test("salt/iv of exactly 64 base64 chars", () => {
    const s64 = "A".repeat(64);
    assert.ok(v.parseSealedVault(sealed({ iv: s64 }, { salt: s64 })));
  });
});

describe("parseSealedVault: rejects", () => {
  const bad: [string, unknown][] = [
    ["null", null],
    ["a string", "vault"],
    ["an array", []],
    ["version 0", sealed({ version: 0 })],
    ["version 1.5", sealed({ version: 1.5 })],
    ["version as string", sealed({ version: "2" })],
    ["missing kdf", sealed({ kdf: undefined })],
    ["kdf name not PBKDF2", sealed({}, { name: "scrypt" })],
    ["kdf hash not SHA-256", sealed({}, { hash: "SHA-1" })],
    ["iterations 99_999", sealed({}, { iterations: 99_999 })],
    ["iterations 10_000_001", sealed({}, { iterations: 10_000_001 })],
    ["iterations non-integer", sealed({}, { iterations: 100_000.5 })],
    ["empty salt", sealed({}, { salt: "" })],
    ["salt 65 chars", sealed({}, { salt: "A".repeat(65) })],
    ["iv not base64", sealed({ iv: "not base64!" })],
    ["empty ciphertext", sealed({ ciphertext: "" })],
    ["ciphertext over 8 MiB chars", sealed({ ciphertext: "A".repeat(8 * 1024 * 1024 + 1) })],
    ["ciphertext as number", sealed({ ciphertext: 42 })],
  ];
  for (const [label, input] of bad) {
    test(label, () => assert.equal(v.parseSealedVault(input), null));
  }
});

describe("writeVaultRow / readVaultRow (optimistic revisions)", () => {
  let id = 100;
  beforeEach(() => user(++id));

  test("no row yet: read returns null", () => {
    assert.equal(v.readVaultRow(id), null);
  });

  test("first write with expected 0 creates revision 1 and reads back", () => {
    assert.equal(v.writeVaultRow(id, sealed() as never, 0), 1);
    assert.deepEqual(v.readVaultRow(id), { vault: sealed(), revision: 1 });
  });

  test("second create with expected 0 is refused (another browser moved first)", () => {
    v.writeVaultRow(id, sealed() as never, 0);
    assert.equal(v.writeVaultRow(id, sealed({ iv: b64(13) }) as never, 0), null);
    assert.equal(v.readVaultRow(id)!.vault.iv, b64(12));
  });

  test("update with the current revision bumps it", () => {
    v.writeVaultRow(id, sealed() as never, 0);
    assert.equal(v.writeVaultRow(id, sealed({ iv: b64(13) }) as never, 1), 2);
    assert.equal(v.readVaultRow(id)!.revision, 2);
  });

  test("update with a stale revision is refused and leaves data unchanged", () => {
    v.writeVaultRow(id, sealed() as never, 0);
    v.writeVaultRow(id, sealed({ iv: b64(13) }) as never, 1);
    assert.equal(v.writeVaultRow(id, sealed({ iv: b64(14) }) as never, 1), null);
    assert.equal(v.readVaultRow(id)!.vault.iv, b64(13));
  });

  test("update with a future revision is refused", () => {
    v.writeVaultRow(id, sealed() as never, 0);
    assert.equal(v.writeVaultRow(id, sealed() as never, 5), null);
  });

  test("update when no row exists (expected > 0) is refused", () => {
    assert.equal(v.writeVaultRow(id, sealed() as never, 1), null);
    assert.equal(v.readVaultRow(id), null);
  });

  test("accounts are isolated", () => {
    const other = ++id;
    user(other);
    v.writeVaultRow(id - 1, sealed() as never, 0);
    assert.equal(v.readVaultRow(other), null);
  });

  test("delete removes the row; a new create starts again at revision 1", () => {
    v.writeVaultRow(id, sealed() as never, 0);
    v.writeVaultRow(id, sealed() as never, 1);
    v.deleteVaultRow(id);
    assert.equal(v.readVaultRow(id), null);
    assert.equal(v.writeVaultRow(id, sealed() as never, 0), 1);
  });

  test("deleting a user cascades to the vault row", () => {
    v.writeVaultRow(id, sealed() as never, 0);
    db().prepare("DELETE FROM users WHERE id = ?").run(id);
    assert.equal(v.readVaultRow(id), null);
  });
});
