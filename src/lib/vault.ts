// Encrypted vault in IndexedDB. Everything the user saves, including host
// names and SSH keys, lives in one AES-GCM blob. The key is non-extractable and memory-only.

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

const DB_NAME = "pswrsh";
const STORE = "vault";
const RECORD = "main";
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStored(): Promise<StoredVault | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(RECORD);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeStored(stored: StoredVault): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(stored, RECORD);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
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
  return { key, data: await loadVault(key) };
}

export async function readVault(key: CryptoKey) {
  return loadVault(key);
}

/** Read-modify-write under a cross-tab lock, so tabs do not overwrite each other. */
export async function updateVault(key: CryptoKey, change: (data: VaultData) => VaultData | Promise<VaultData>): Promise<VaultData> {
  const next = await navigator.locks.request(LOCK, async () => {
    const stored = await readStored();
    if (!stored) throw new Error("vault missing");
    const normalized = await normalize(await decrypt(key, stored));
    const updated = await change(normalized.data);
    await writeStored(await seal(key, stored.kdf, updated));
    return updated;
  });
  if (!next) throw new Error("vault missing");
  announce("changed");
  return next;
}

/** Deletes the whole vault from this browser. Cannot be undone. */
export async function wipeVault() {
  await navigator.locks.request(LOCK, () => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
  announce("wiped");
}

/** Asks every tab of this browser to drop its key. */
export function lockVault() {
  announce("locked");
}

export type VaultEvent = "changed" | "locked" | "wiped";

function announce(event: VaultEvent) {
  const channel = new BroadcastChannel(EVENT_CHANNEL);
  channel.postMessage(event);
  channel.close();
}

/** Also fires in the announcing tab. */
export function onVaultEvent(listener: (event: VaultEvent) => void) {
  const channel = new BroadcastChannel(EVENT_CHANNEL);
  channel.onmessage = (message: MessageEvent<VaultEvent>) => listener(message.data);
  return () => channel.close();
}
