// 볼트는 계정의 서버(/api/vault)에 암호문으로만 있다. 브라우저 저장소, 서버 응답, 네트워크에 평문이 없다.
import { expect, type Page, test } from "./support/fixtures";
import { addHost, createVault, hostRow, unlock } from "./support/app";
import { KEY_PASSPHRASE, leaks, LOCKED_PRIVATE_KEY, RUN, SSH_PASSWORD } from "./support/secrets";

const HOST_NAME = `stored-name-${RUN}`;
const HOST_ADDRESS = `stored-address-${RUN}.example`;
const HOST_USER = `stored-user-${RUN}`;

type Dump = {
  records: { database: string; store: string; key: string; value: unknown }[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookies: string;
  caches: string[];
};

/** Everything same-origin script can read. Bytes come back as hex. */
const dumpBrowserStorage = (page: Page): Promise<Dump> =>
  page.evaluate(async () => {
    const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const plain = (value: unknown): unknown => {
      if (value instanceof ArrayBuffer) return { $bytes: hex(new Uint8Array(value)) };
      if (ArrayBuffer.isView(value)) {
        return { $bytes: hex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
      }
      if (Array.isArray(value)) return value.map(plain);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
      }
      return value;
    };
    const records: Dump["records"] = [];
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const objectStore = db.transaction(store).objectStore(store);
        const [keys, values] = await Promise.all(
          [objectStore.getAllKeys(), objectStore.getAll()].map(
            (request) =>
              new Promise<unknown[]>((resolve, reject) => {
                request.onsuccess = () => resolve(request.result as unknown[]);
                request.onerror = () => reject(request.error);
              }),
          ),
        );
        keys.forEach((key, i) => records.push({ database: name!, store, key: String(key), value: plain(values[i]) }));
      }
      db.close();
    }
    return {
      records,
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      cookies: document.cookie,
      caches: await caches.keys(),
    };
  });

type Sealed = {
  version: number;
  kdf: { name: string; hash: string; iterations: number; salt: string };
  iv: string;
  ciphertext: string;
};

/** The account's vault as the server keeps it, read with this browser's login. */
async function serverVault(page: Page) {
  const response = await page.context().request.get("/api/vault");
  expect(response.status()).toBe(200);
  return (await response.json()) as { vault: Sealed | null; revision: number };
}

const b64 = (text: string) => Buffer.from(text, "base64");

/** The JSON plus every hex field decoded back to raw bytes, so a plaintext blob cannot hide. */
function allBytes(dump: Dump) {
  const parts: Buffer[] = [Buffer.from(JSON.stringify(dump))];
  JSON.stringify(dump).replace(/"\$bytes":"([0-9a-f]*)"/g, (_, hex: string) => {
    parts.push(Buffer.from(hex, "hex"));
    return "";
  });
  return Buffer.concat(parts);
}

async function saveEverySecretKind(page: Page) {
  await addHost(page, { name: HOST_NAME, hostname: HOST_ADDRESS, username: HOST_USER, password: SSH_PASSWORD });
  await addHost(page, {
    name: `${HOST_NAME}-key`,
    hostname: HOST_ADDRESS,
    username: HOST_USER,
    key: { privateKey: LOCKED_PRIVATE_KEY, passphrase: KEY_PASSPHRASE },
  });
}

test("서버의 볼트는 버전, PBKDF2 설정, 솔트, IV, 암호문만 있다", async ({ page }) => {
  await createVault(page);
  await saveEverySecretKind(page);
  const { vault } = await serverVault(page);
  expect(vault).not.toBeNull();
  expect(Object.keys(vault!).sort()).toEqual(["ciphertext", "iv", "kdf", "version"]);
  expect(Object.keys(vault!.kdf).sort()).toEqual(["hash", "iterations", "name", "salt"]);
  expect(vault!.kdf.name).toBe("PBKDF2");
  expect(vault!.kdf.hash).toBe("SHA-256");
  expect(vault!.kdf.iterations).toBe(600_000);
  expect(b64(vault!.kdf.salt).length).toBe(16);
  expect(b64(vault!.iv).length).toBe(12);
  expect(b64(vault!.ciphertext).length).toBeGreaterThan(0);
});

test("브라우저 저장소(IndexedDB, localStorage, sessionStorage, 스크립트 쿠키, 캐시)와 서버 볼트에 비밀과 호스트 정보의 평문이 없다", async ({ page }) => {
  await createVault(page);
  await saveEverySecretKind(page);
  const dump = await dumpBrowserStorage(page);
  const { vault } = await serverVault(page);
  const bytes = Buffer.concat([allBytes(dump), Buffer.from(JSON.stringify(vault)), b64(vault!.ciphertext)]);

  // 대조: 서버 암호문이 비밀을 담을 만큼 크다.
  expect(b64(vault!.ciphertext).length).toBeGreaterThan(LOCKED_PRIVATE_KEY.length);

  expect(leaks(bytes)).toEqual([]);
  for (const value of [HOST_NAME, HOST_ADDRESS, HOST_USER]) {
    expect(bytes.includes(value), "host metadata in plaintext").toBe(false);
  }
  // 로그인 쿠키는 HttpOnly라 스크립트에 보이지 않는다.
  expect(dump.cookies).toBe("");
  expect(Object.keys(dump.localStorage)).toEqual([]);
  expect(Object.keys(dump.sessionStorage)).toEqual([]);
  expect(dump.caches).toEqual([]);

  // 그런데도 패스프레이즈를 넣으면 전부 돌아온다. 데이터는 저 암호문 안에 있다.
  await page.reload();
  await unlock(page);
  await expect(hostRow(page, `${HOST_NAME}-key`)).toContainText("개인키");
});

test("저장할 때마다 IV와 암호문이 바뀌고 솔트는 유지되며 리비전이 오른다", async ({ page }) => {
  await createVault(page);
  const first = await serverVault(page);
  await addHost(page, { name: "iv-1", hostname: "iv.example", username: "ann" });
  await expect.poll(async () => (await serverVault(page)).revision).toBeGreaterThan(first.revision);
  const second = await serverVault(page);
  expect(second.vault!.iv).not.toBe(first.vault!.iv);
  expect(second.vault!.ciphertext).not.toBe(first.vault!.ciphertext);
  expect(second.vault!.kdf.salt).toBe(first.vault!.kdf.salt);
});

test("볼트 작업 중 HTTP 요청과 콘솔에 비밀이 나타나지 않는다", async ({ page }) => {
  const outgoing: string[] = [];
  const consoleLines: string[] = [];
  page.on("request", (request) => outgoing.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`));
  page.on("console", (message) => consoleLines.push(message.text()));

  await createVault(page);
  await saveEverySecretKind(page);
  await page.reload();
  await unlock(page);

  expect(outgoing.length).toBeGreaterThan(0);
  expect(leaks(outgoing.join("\n"))).toEqual([]);
  expect(leaks(consoleLines.join("\n"))).toEqual([]);
});
