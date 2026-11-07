// Encrypted vault, stored sealed on the server. Everything the user saves, including host
// names and SSH keys, lives in one AES-GCM blob. The key is non-extractable: this browser
// keeps the CryptoKey object in IndexedDB so a reload opens the vault without the
// passphrase, but the key bytes can never be read back out (see "Saved key").

import { parsePrivateKey } from "@/lib/ssh-key";

export type HostAuth =
  | { type: "password"; password: string }
  | { type: "key"; keyId: string }
  | { type: "interactive" };

export type Host = {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  auth: HostAuth;
};

/** Private key material. It never leaves the vault except when an SSH login sends it after host-key acceptance. */
export type SshKey = {
  id: string;
  name: string;
  comment: string;
  type: string;
  publicKey: string;
  fingerprint: string;
  privateKey: string;
  passphrase: string;
  createdAt: string;
};

export type KnownHost = {
  algorithm: string;
  fingerprint: string;
};

export type VaultData = {
  hosts: Host[];
  knownHosts: Record<string, KnownHost>;
  keys: SshKey[];
};

type StoredVault = {
  version: number;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: Uint8Array<ArrayBuffer> };
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
};

const LOCK = "pswrsh-vault";
const EVENT_CHANNEL = "pswrsh-vault-events";
const PBKDF2_ITERATIONS = 600_000;
const AAD = new TextEncoder().encode("pswrsh-vault-v1");

export function knownHostKey(hostname: string, port: number) {
  return `${hostname.toLowerCase()}:${port}`;
}

export function isCryptoAvailable() {
  return typeof crypto !== "undefined" && Boolean(crypto.subtle);
}

// --- Storage -----------------------------------------------------------------------
// The sealed vault lives on the server (/api/vault), so every browser this account logs
// in to sees the same hosts and keys. It is still encrypted here before upload: the server
// stores ciphertext and never sees the passphrase. A vault left in this browser's
// IndexedDB by an older version is uploaded once and then deleted locally.

type WireVault = { version: number; kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string }; iv: string; ciphertext: string };

/** Revision of the server copy this browser last read or wrote (0: none). */
let revision = 0;
/** Account the last server read belonged to (null before the first read). */
let account: number | null = null;

class StaleRevision extends Error {}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toWire(stored: StoredVault): WireVault {
  return {
    version: stored.version,
    kdf: { ...stored.kdf, salt: toBase64(stored.kdf.salt) },
    iv: toBase64(stored.iv),
    ciphertext: toBase64(new Uint8Array(stored.ciphertext)),
  };
}

function fromWire(wire: WireVault): StoredVault {
  return {
    version: wire.version,
    kdf: { ...wire.kdf, salt: fromBase64(wire.kdf.salt) },
    iv: fromBase64(wire.iv),
    ciphertext: fromBase64(wire.ciphertext).buffer,
  };
}

async function fetchRemote(): Promise<{ stored: StoredVault | undefined; revision: number }> {
  const response = await fetch("/api/vault", { cache: "no-store" });
  if (!response.ok) throw new Error("vault fetch failed: " + response.status);
  const body = (await response.json()) as { vault: WireVault | null; revision: number; account: number };
  account = body.account;
  return { stored: body.vault ? fromWire(body.vault) : undefined, revision: body.revision };
}

async function putRemote(stored: StoredVault, expected: number): Promise<number> {
  const response = await fetch("/api/vault", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vault: toWire(stored), revision: expected }),
  });
  if (response.status === 409) throw new StaleRevision();
  if (!response.ok) throw new Error("vault save failed: " + response.status);
  return ((await response.json()) as { revision: number }).revision;
}

// The vault an older version kept in this browser.
const LEGACY_DB = "pswrsh";
const LEGACY_STORE = "vault";
const LEGACY_RECORD = "main";

async function hasLegacyDb() {
  if (typeof indexedDB === "undefined") return false;
  if (!indexedDB.databases) return true;
  return (await indexedDB.databases()).some((db) => db.name === LEGACY_DB);
}

async function readLegacy(): Promise<StoredVault | undefined> {
  if (!(await hasLegacyDb())) return undefined;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(LEGACY_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    if (!db.objectStoreNames.contains(LEGACY_STORE)) return undefined;
    return await new Promise((resolve, reject) => {
      const request = db.transaction(LEGACY_STORE).objectStore(LEGACY_STORE).get(LEGACY_RECORD);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

function deleteLegacy(): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(LEGACY_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/**
 * The server copy. On the first read after the upgrade, a vault still in this browser
 * moves to the server (only when the account has none yet) and is removed locally.
 */
async function readStored(): Promise<StoredVault | undefined> {
  const remote = await fetchRemote();
  revision = remote.revision;
  const legacy = await readLegacy().catch(() => undefined);
  if (!legacy) return remote.stored;
  // The account already has a vault (another browser moved first). The local one is
  // merged into it at unlock, when the passphrase is known (mergeLegacy).
  if (remote.stored) return remote.stored;
  try {
    revision = await putRemote(legacy, 0);
  } catch (error) {
    if (!(error instanceof StaleRevision)) throw error;
    const again = await fetchRemote();
    revision = again.revision;
    return again.stored;
  }
  await deleteLegacy();
  return legacy;
}

async function writeStored(stored: StoredVault): Promise<void> {
  revision = await putRemote(stored, revision);
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(key: CryptoKey, kdf: StoredVault["kdf"], data: VaultData): Promise<StoredVault> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return { version: 2, kdf, iv, ciphertext };
}

async function decrypt(key: CryptoKey, stored: StoredVault): Promise<unknown> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: stored.iv, additionalData: AAD },
    key,
    stored.ciphertext,
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

type LegacyHost = {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  auth:
    | { type: "password"; password: string }
    | { type: "interactive" }
    | { type: "key"; keyId?: string; privateKey?: string; passphrase?: string };
};

/** Version 1 kept the private key on the host. Version 2 keeps it in `keys` and the host stores only the id. */
async function normalize(raw: unknown): Promise<{ data: VaultData; changed: boolean }> {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const keys: SshKey[] = Array.isArray(record.keys) ? (record.keys as SshKey[]) : [];
  let changed = !Array.isArray(record.keys);
  const hosts: Host[] = [];
  const source = Array.isArray(record.hosts) ? (record.hosts as LegacyHost[]) : [];
  for (const host of source) {
    const auth = host.auth;
    if (auth?.type === "key" && typeof auth.privateKey === "string") {
      changed = true;
      const passphrase = typeof auth.passphrase === "string" ? auth.passphrase : "";
      let match = keys.find((key) => key.privateKey === auth.privateKey && key.passphrase === passphrase);
      if (!match) {
        match = await legacyKey(host.name, auth.privateKey, passphrase);
        keys.push(match);
      }
      hosts.push({ ...host, auth: { type: "key", keyId: match.id } });
      continue;
    }
    if (auth?.type === "key") {
      if (typeof auth.keyId !== "string") changed = true;
      hosts.push({ ...host, auth: { type: "key", keyId: auth.keyId ?? "" } });
      continue;
    }
    if (auth?.type === "password" || auth?.type === "interactive") {
      hosts.push(host as Host);
      continue;
    }
    changed = true;
  }
  const knownHosts =
    record.knownHosts && typeof record.knownHosts === "object"
      ? (record.knownHosts as Record<string, KnownHost>)
      : {};
  if (!record.knownHosts || typeof record.knownHosts !== "object") changed = true;
  return { data: { hosts, knownHosts, keys }, changed };
}

async function legacyKey(hostName: string, privateKey: string, passphrase: string): Promise<SshKey> {
  const createdAt = new Date().toISOString();
  try {
    const parsed = await parsePrivateKey(privateKey, passphrase || undefined);
    return {
      id: crypto.randomUUID(),
      name: `${hostName} 키`,
      comment: parsed.comment,
      type: parsed.type,
      publicKey: parsed.publicKey,
      fingerprint: parsed.fingerprint,
      privateKey,
      passphrase,
      createdAt,
    };
  } catch {
    return {
      id: crypto.randomUUID(),
      name: `${hostName} 키`,
      comment: "",
      type: "unknown",
      publicKey: "",
      fingerprint: "",
      privateKey,
      passphrase,
      createdAt,
    };
  }
}

export async function vaultExists() {
  return (await readStored()) !== undefined;
}

export async function createVault(passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kdf: StoredVault["kdf"] = { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt };
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const data: VaultData = { hosts: [], knownHosts: {}, keys: [] };
  const stored = await seal(key, kdf, data);
  await navigator.locks.request(LOCK, async () => {
    if (await readStored()) throw new Error("vault already exists");
    await writeStored(stored);
  });
  await rememberKey(key);
  return { key, data };
}

async function loadVault(key: CryptoKey): Promise<VaultData> {
  const data = await navigator.locks.request(LOCK, async () => {
    const stored = await readStored();
    if (!stored) throw new Error("vault missing");
    const normalized = await normalize(await decrypt(key, stored));
    if (normalized.changed || stored.version !== 2) await writeStored(await seal(key, stored.kdf, normalized.data));
    return normalized.data;
  });
  if (!data) throw new Error("vault missing");
  return data;
}

/** Throws when the passphrase is wrong: AES-GCM authentication fails. */
export async function unlockVault(passphrase: string) {
  const stored = await readStored();
  if (!stored) throw new Error("vault missing");
  const key = await deriveKey(passphrase, stored.kdf.salt, stored.kdf.iterations);
  const data = await loadVault(key);
  const opened = { key, data: (await mergeLegacy(passphrase, key)) ?? data };
  await rememberKey(key);
  return opened;
}

/**
 * Opens the vault with the key this browser saved when it last opened it. Null when there
 * is none or it can no longer open the vault; a key that belongs to another account, a
 * wiped vault, or a vault it cannot decrypt (a new vault made elsewhere) is deleted. A
 * network failure or a logged-out request keeps the key for the next try.
 */
export async function restoreVault(): Promise<{ key: CryptoKey; data: VaultData } | null> {
  const saved = await readSavedKey().catch(() => undefined);
  if (!saved) return null;
  let stored: StoredVault | undefined;
  try {
    stored = await readStored();
  } catch {
    return null;
  }
  if (account !== saved.account || !stored) {
    await forgetSavedKey();
    return null;
  }
  try {
    await decrypt(saved.key, stored);
  } catch {
    await forgetSavedKey();
    return null;
  }
  try {
    return { key: saved.key, data: await loadVault(saved.key) };
  } catch {
    return null;
  }
}

/**
 * A vault this browser kept before the server copy existed, when the server already had
 * one from another browser: merged in by id (the server copy wins on conflicts) and removed
 * locally. If it was sealed with a different passphrase it stays in this browser untouched.
 */
async function mergeLegacy(passphrase: string, key: CryptoKey): Promise<VaultData | null> {
  const legacy = await readLegacy().catch(() => undefined);
  if (!legacy) return null;
  let local: VaultData;
  try {
    const legacyKey = await deriveKey(passphrase, legacy.kdf.salt, legacy.kdf.iterations);
    local = (await normalize(await decrypt(legacyKey, legacy))).data;
  } catch {
    return null;
  }
  const merged = await updateVault(key, (remote) => {
    const hostIds = new Set(remote.hosts.map((h) => h.id));
    const keyIds = new Set(remote.keys.map((k) => k.id));
    return {
      hosts: [...remote.hosts, ...local.hosts.filter((h) => !hostIds.has(h.id))],
      keys: [...remote.keys, ...local.keys.filter((k) => !keyIds.has(k.id))],
      knownHosts: { ...local.knownHosts, ...remote.knownHosts },
    };
  });
  await deleteLegacy();
  return merged;
}

export async function readVault(key: CryptoKey) {
  return loadVault(key);
}

/**
 * Read-modify-write under a cross-tab lock, so tabs do not overwrite each other. Another
 * device can still save in between; the server then refuses the stale revision and the
 * change is applied again on top of its copy.
 */
export async function updateVault(key: CryptoKey, change: (data: VaultData) => VaultData | Promise<VaultData>): Promise<VaultData> {
  const next = await navigator.locks.request(LOCK, async () => {
    for (let attempt = 0; ; attempt++) {
      const stored = await readStored();
      if (!stored) throw new Error("vault missing");
      const normalized = await normalize(await decrypt(key, stored));
      const updated = await change(normalized.data);
      try {
        await writeStored(await seal(key, stored.kdf, updated));
        return updated;
      } catch (error) {
        if (!(error instanceof StaleRevision) || attempt >= 4) throw error;
      }
    }
  });
  if (!next) throw new Error("vault missing");
  announce("changed");
  return next;
}

/** Deletes the account's vault on the server and in this browser. Cannot be undone. */
export async function wipeVault() {
  await navigator.locks.request(LOCK, async () => {
    const response = await fetch("/api/vault", { method: "DELETE" });
    if (!response.ok) throw new Error("vault delete failed: " + response.status);
    revision = 0;
    await deleteLegacy();
    await forgetSavedKey();
  });
  announce("wiped");
}

/**
 * Logging out: deletes this browser's saved key and asks every tab of this browser to
 * drop the key it holds ("locked"). The vault itself stays on the server.
 */
export async function forgetVault() {
  await forgetSavedKey();
  announce("locked");
}

export type VaultEvent = "changed" | "locked" | "wiped";

function announce(event: VaultEvent) {
  const channel = new BroadcastChannel(EVENT_CHANNEL);
  channel.postMessage(event);
  channel.close();
}

/**
 * Also fires in the announcing tab. Saves made on other devices arrive as "changed" (or
 * "wiped") when this tab comes back to the foreground and every 30 seconds while visible.
 */
export function onVaultEvent(listener: (event: VaultEvent) => void) {
  const channel = new BroadcastChannel(EVENT_CHANNEL);
  channel.onmessage = (message: MessageEvent<VaultEvent>) => listener(message.data);
  const stopWatching = watchRemote();
  return () => {
    channel.close();
    stopWatching();
  };
}

let watchers = 0;
let stopRemoteWatch: (() => void) | null = null;

/** One poller per tab, however many components listen. */
function watchRemote() {
  if (watchers++ === 0) {
    const check = () => {
      if (document.visibilityState !== "visible" || revision === 0) return;
      fetch("/api/vault?revision=1", { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<{ revision: number }>) : null))
        .then((body) => {
          if (!body || body.revision === revision) return;
          if (body.revision === 0) {
            revision = 0;
            // Wiped on another device: the saved key opens nothing now.
            void forgetSavedKey().then(() => announce("wiped"));
          } else {
            announce("changed");
          }
        })
        .catch(() => undefined);
    };
    const timer = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    stopRemoteWatch = () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }
  return () => {
    if (--watchers === 0) {
      stopRemoteWatch?.();
      stopRemoteWatch = null;
    }
  };
}

// --- Saved key ---------------------------------------------------------------------
// The CryptoKey of the open vault, with the account it opened for, in its own IndexedDB
// database (not LEGACY_DB, which deleteLegacy removes). IndexedDB stores the key object
// itself; it is non-extractable, so script can use it but never read its bytes. Neither
// the passphrase nor the key bytes are written anywhere.

const KEY_DB = "pswrsh-vault-key";
const KEY_STORE = "keys";
const KEY_RECORD = "current";

type SavedKey = { account: number; key: CryptoKey };

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withKeyStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openKeyDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(KEY_STORE, mode);
      const request = run(transaction.objectStore(KEY_STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function readSavedKey(): Promise<SavedKey | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const saved = (await withKeyStore("readonly", (store) => store.get(KEY_RECORD))) as SavedKey | undefined;
  return saved && typeof saved.account === "number" && saved.key instanceof CryptoKey ? saved : undefined;
}

/** Best effort: without it the vault still opens, only the next reload asks again. */
async function rememberKey(key: CryptoKey) {
  if (typeof indexedDB === "undefined" || account === null) return;
  const saved: SavedKey = { account, key };
  await withKeyStore("readwrite", (store) => store.put(saved, KEY_RECORD)).catch(() => undefined);
}

async function forgetSavedKey() {
  if (typeof indexedDB === "undefined") return;
  await withKeyStore("readwrite", (store) => store.delete(KEY_RECORD)).catch(() => undefined);
}
