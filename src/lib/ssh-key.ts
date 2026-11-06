// OpenSSH key material stays in the browser. Generation uses WebCrypto.
// Import reads an OpenSSH private key, including the bcrypt + AES-CTR form ssh-keygen writes.

import { pbkdf } from "bcrypt-pbkdf";

export type ParsedSshKey = {
  type: string;
  publicKey: string;
  fingerprint: string;
  privateKey: string;
  comment: string;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyError";
  }
}

function asBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function sshBytes(data: Uint8Array): Uint8Array {
  return concat([u32(data.length), data]);
}

function sshText(value: string): Uint8Array {
  return sshBytes(textEncoder.encode(value));
}

function mpint(unsigned: Uint8Array): Uint8Array {
  let start = 0;
  while (start < unsigned.length - 1 && unsigned[start] === 0) start += 1;
  let body = unsigned.subarray(start);
  if (body.length === 0) body = new Uint8Array([0]);
  if (body[0] & 0x80) {
    const padded = new Uint8Array(body.length + 1);
    padded.set(body, 1);
    body = padded;
  }
  return sshBytes(body);
}

class Reader {
  private offset = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  remaining() {
    return this.bytes.length - this.offset;
  }

  u32(): number {
    if (this.offset + 4 > this.bytes.length) throw new KeyError("OpenSSH 개인키 형식이 아닙니다.");
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getUint32(0);
    this.offset += 4;
    return value;
  }

  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) throw new KeyError("OpenSSH 개인키 형식이 아닙니다.");
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  str(): Uint8Array {
    return this.take(this.u32());
  }

  text(): string {
    return textDecoder.decode(this.str());
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ""));
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

function pem(label: string, body: Uint8Array): string {
  const lines = bytesToBase64(body).match(/.{1,70}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

function opensshLabel(): string {
  return ["OPENSSH", "PRIVATE KEY"].join(" ");
}

export function publicKeyLine(type: string, blob: Uint8Array, comment: string): string {
  const line = `${type} ${bytesToBase64(blob)}`;
  return comment ? `${line} ${comment}` : line;
}

export async function fingerprintOf(publicKey: string): Promise<string> {
  const blob = publicBlob(publicKey);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", asBuffer(blob)));
  return `SHA256:${bytesToBase64(digest).replace(/=+$/, "")}`;
}

function publicBlob(publicKey: string): Uint8Array {
  const encoded = publicKey.trim().split(/\s+/)[1];
  if (!encoded) throw new KeyError("공개키 형식이 아닙니다.");
  return base64ToBytes(encoded);
}

export function echoInstallCommand(publicKey: string): string | null {
  if (publicKey.includes("'")) return null;
  return `mkdir -p ~/.ssh && chmod 700 ~/.ssh && (grep -qxF '${publicKey}' ~/.ssh/authorized_keys 2>/dev/null || echo '${publicKey}' >> ~/.ssh/authorized_keys) && chmod 600 ~/.ssh/authorized_keys`;
}

export function replaceComment(publicKey: string, comment: string): string {
  const parts = publicKey.trim().split(/\s+/);
  if (parts.length < 2) throw new KeyError("공개키 형식이 아닙니다.");
  return publicKeyLine(parts[0], base64ToBytes(parts[1]), comment);
}

function padPrivate(section: Uint8Array): Uint8Array {
  const block = 8;
  const extra = block - (section.length % block);
  const padding = new Uint8Array(extra === 0 ? block : extra);
  for (let index = 0; index < padding.length; index += 1) padding[index] = index + 1;
  return concat([section, padding]);
}

function packOpenssh(publicBlobBytes: Uint8Array, secret: Uint8Array): Uint8Array {
  const magic = textEncoder.encode("openssh-key-v1\0");
  return concat([
    magic,
    sshText("none"),
    sshText("none"),
    sshText(""),
    u32(1),
    sshBytes(publicBlobBytes),
    sshBytes(secret),
  ]);
}

function privateSection(check: number, fields: Uint8Array[]): Uint8Array {
  return padPrivate(concat([u32(check), u32(check), ...fields]));
}

async function generateEd25519(comment: string): Promise<ParsedSshKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" } as AlgorithmIdentifier, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  // The seed is the last 32 bytes of the PKCS#8 encoding.
  const seed = pkcs8.subarray(pkcs8.length - 32);
  if (seed.length !== 32 || rawPublic.length !== 32) throw new KeyError("키를 만들지 못했습니다.");
  const secret = concat([seed, rawPublic]);
  const blob = concat([sshText("ssh-ed25519"), sshBytes(rawPublic)]);
  const check = crypto.getRandomValues(new Uint8Array(4));
  const checkValue = new DataView(check.buffer).getUint32(0);
  const section = privateSection(checkValue, [
    sshText("ssh-ed25519"),
    sshBytes(rawPublic),
    sshBytes(secret),
    sshText(comment),
  ]);
  return finish("ssh-ed25519", blob, comment, pem(opensshLabel(), packOpenssh(blob, section)));
}

async function generateP256(comment: string): Promise<ParsedSshKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwk.x || !jwk.y || !jwk.d) throw new KeyError("키를 만들지 못했습니다.");
  const x = base64UrlToBytes(jwk.x);
  const y = base64UrlToBytes(jwk.y);
  const d = base64UrlToBytes(jwk.d);
  const point = concat([new Uint8Array([0x04]), fixed(x, 32), fixed(y, 32)]);
  const type = "ecdsa-sha2-nistp256";
  const blob = concat([sshText(type), sshText("nistp256"), sshBytes(point)]);
  const check = crypto.getRandomValues(new Uint32Array(1))[0];
  const section = privateSection(check, [sshText(type), sshText("nistp256"), sshBytes(point), mpint(d), sshText(comment)]);
  return finish(type, blob, comment, pem(opensshLabel(), packOpenssh(blob, section)));
}

function fixed(bytes: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  out.set(bytes.subarray(Math.max(0, bytes.length - length)), length - Math.min(length, bytes.length));
  return out;
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return base64ToBytes(padded);
}

async function finish(type: string, blob: Uint8Array, comment: string, privateKey: string): Promise<ParsedSshKey> {
  const publicKey = publicKeyLine(type, blob, comment);
  return { type, publicKey, fingerprint: await fingerprintOf(publicKey), privateKey, comment };
}

async function ed25519Works() {
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" } as AlgorithmIdentifier, false, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}

/** Ed25519 when the browser has it, otherwise ECDSA P-256. */
export async function generateSshKey(comment: string): Promise<ParsedSshKey> {
  if (await ed25519Works()) return generateEd25519(comment);
  return generateP256(comment);
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

function readComment(section: Uint8Array, expectedBlob: Uint8Array): string {
  const reader = new Reader(section);
  const check = reader.u32();
  if (reader.u32() !== check) throw new KeyError("키 암호가 맞지 않습니다.");
  const type = reader.text();
  if (type === "ssh-ed25519") {
    const pub = reader.str();
    reader.str();
    const comment = reader.text();
    const blob = concat([sshText(type), sshBytes(pub)]);
    if (!sameBytes(blob, expectedBlob)) throw new KeyError("OpenSSH 개인키 형식이 아닙니다.");
    return comment;
  }
  if (type.startsWith("ecdsa-sha2-")) {
    const curve = reader.text();
    const pub = reader.str();
    reader.str();
    const comment = reader.text();
    const blob = concat([sshText(type), sshText(curve), sshBytes(pub)]);
    if (!sameBytes(blob, expectedBlob)) throw new KeyError("OpenSSH 개인키 형식이 아닙니다.");
    return comment;
  }
  if (type === "ssh-rsa") {
    reader.str();
    reader.str();
    reader.str();
    reader.str();
    reader.str();
    reader.str();
    return reader.text();
  }
  return "";
}

function assertPadding(section: Uint8Array) {
  const reader = new Reader(section);
  reader.u32();
  reader.u32();
  const type = reader.text();
  if (type === "ssh-ed25519") {
    reader.str();
    reader.str();
    reader.text();
  } else if (type.startsWith("ecdsa-sha2-")) {
    reader.text();
    reader.str();
    reader.str();
    reader.text();
  } else if (type === "ssh-rsa") {
    for (let index = 0; index < 6; index += 1) reader.str();
    reader.text();
  } else {
    return;
  }
  let expect = 1;
  while (reader.remaining() > 0) {
    const byte = reader.take(1)[0];
    if (byte !== expect) throw new KeyError("키 암호가 맞지 않습니다.");
    expect += 1;
  }
}

async function decryptSecret(secret: Uint8Array, cipher: string, kdf: string, options: Uint8Array, passphrase: string) {
  if (cipher === "none") return secret;
  if (!passphrase) throw new KeyError("이 키에는 암호가 필요합니다.");
  if (kdf !== "bcrypt" || (cipher !== "aes256-ctr" && cipher !== "aes128-ctr")) {
    throw new KeyError("지원하지 않는 키 암호 방식입니다.");
  }
  const opt = new Reader(options);
  const salt = opt.str();
  const rounds = opt.u32();
  const length = cipher === "aes128-ctr" ? 16 + 16 : 32 + 16;
  const derived = new Uint8Array(length);
  const pass = textEncoder.encode(passphrase);
  if (pbkdf(pass, pass.length, salt, salt.length, derived, derived.length, rounds) !== 0) {
    throw new KeyError("키 암호가 맞지 않습니다.");
  }
  const keyLength = cipher === "aes128-ctr" ? 16 : 32;
  const key = await crypto.subtle.importKey("raw", asBuffer(derived.subarray(0, keyLength)), { name: "AES-CTR" }, false, ["decrypt"]);
  const counter = asBuffer(derived.subarray(keyLength));
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-CTR", counter, length: 128 }, key, asBuffer(secret));
    return new Uint8Array(plain);
  } catch {
    throw new KeyError("키 암호가 맞지 않습니다.");
  }
}

function decodePem(text: string): { label: string; body: Uint8Array } {
  const match = text.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]+?)-----END \1-----/);
  if (!match) throw new KeyError("OpenSSH 개인키 형식이 아닙니다.");
  try {
    return { label: match[1], body: base64ToBytes(match[2]) };
  } catch {
    throw new KeyError("OpenSSH 개인키 형식이 아닙니다.");
  }
}

async function parseOpenssh(body: Uint8Array, passphrase: string | undefined, privateKey: string): Promise<ParsedSshKey> {
  const magic = textEncoder.encode("openssh-key-v1\0");
  if (!sameBytes(body.subarray(0, magic.length), magic)) throw new KeyError("OpenSSH 개인키 형식이 아닙니다.");
  const reader = new Reader(body.subarray(magic.length));
  const cipher = reader.text();
  const kdf = reader.text();
  const options = reader.str();
  const count = reader.u32();
  if (count < 1) throw new KeyError("OpenSSH 개인키 형식이 아닙니다.");
  const blob = reader.str();
  for (let index = 1; index < count; index += 1) reader.str();
  const secret = reader.str();
  const type = textDecoder.decode(new Reader(blob).str());
  const plain = await decryptSecret(secret, cipher, kdf, options, passphrase ?? "");
  const comment = readComment(plain, blob);
  assertPadding(plain);
  const publicKey = publicKeyLine(type, blob, comment);
  return { type, publicKey, fingerprint: await fingerprintOf(publicKey), privateKey, comment };
}

async function importPkcs8(der: Uint8Array, privateKey: string): Promise<ParsedSshKey> {
  const attempts = [
    { name: "Ed25519" },
    { name: "ECDSA", namedCurve: "P-256" },
    { name: "ECDSA", namedCurve: "P-384" },
    { name: "ECDSA", namedCurve: "P-521" },
  ];
  for (const algorithm of attempts) {
    try {
      const key = await crypto.subtle.importKey("pkcs8", asBuffer(der), algorithm, true, ["sign"]);
      if (algorithm.name === "Ed25519") {
        const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
        const blob = concat([sshText("ssh-ed25519"), sshBytes(raw)]);
        return finish("ssh-ed25519", blob, "", privateKey);
      }
      const jwk = await crypto.subtle.exportKey("jwk", key);
      if (!jwk.x || !jwk.y || !jwk.crv) continue;
      const size = jwk.crv === "P-521" ? 66 : jwk.crv === "P-384" ? 48 : 32;
      const curve = jwk.crv === "P-521" ? "nistp521" : jwk.crv === "P-384" ? "nistp384" : "nistp256";
      const point = concat([new Uint8Array([0x04]), fixed(base64UrlToBytes(jwk.x), size), fixed(base64UrlToBytes(jwk.y), size)]);
      const type = `ecdsa-sha2-${curve}`;
      const blob = concat([sshText(type), sshText(curve), sshBytes(point)]);
      return finish(type, blob, "", privateKey);
    } catch {
      // Try the next algorithm.
    }
  }
  throw new KeyError("OpenSSH 개인키 형식이 아닙니다.");
}

/** Reads an OpenSSH private key. Passphrase is required when the key is encrypted. */
export async function parsePrivateKey(source: string, passphrase?: string): Promise<ParsedSshKey> {
  const trimmed = source.replace(/\r\n/g, "\n").trim();
  if (!trimmed) throw new KeyError("개인키를 붙여넣거나 파일을 고르세요.");
  const { label, body } = decodePem(trimmed);
  try {
    if (label === opensshLabel()) return await parseOpenssh(body, passphrase, trimmed);
    if (label === "PRIVATE KEY") return await importPkcs8(body, trimmed);
  } catch (error) {
    if (error instanceof KeyError) throw error;
    throw new KeyError("개인키를 읽을 수 없습니다.");
  }
  throw new KeyError("OpenSSH 개인키 형식이 아닙니다.");
}

export function keyErrorMessage(error: unknown) {
  return error instanceof KeyError ? error.message : "개인키를 읽을 수 없습니다.";
}
