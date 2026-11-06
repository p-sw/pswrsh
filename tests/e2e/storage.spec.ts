// 저장은 IndexedDB의 암호문이다. 브라우저 저장소와 네트워크에 평문이 없다.
import { expect, type Page, test } from "@playwright/test";
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

test("볼트 레코드는 하나이고 암호문, IV, 솔트, PBKDF2 설정만 있다", async ({ page }) => {
  await createVault(page);
  await saveEverySecretKind(page);
  const { records } = await dumpBrowserStorage(page);
  expect(records).toHaveLength(1);
  const value = records[0].value as {
    kdf: { name: string; hash: string; iterations: number; salt: { $bytes: string } };
    iv: { $bytes: string };
    ciphertext: { $bytes: string };
  };
  expect(value.kdf.name).toBe("PBKDF2");
  expect(value.kdf.hash).toBe("SHA-256");
  expect(value.kdf.iterations).toBe(600_000);
  expect(value.kdf.salt.$bytes.length / 2).toBe(16);
  expect(value.iv.$bytes.length / 2).toBe(12);
  expect(value.ciphertext.$bytes.length).toBeGreaterThan(0);
});

test("IndexedDB, localStorage, sessionStorage, 쿠키, 캐시에 비밀과 호스트 정보의 평문이 없다", async ({ page }) => {
  await createVault(page);
  await saveEverySecretKind(page);
  const dump = await dumpBrowserStorage(page);
  const bytes = allBytes(dump);

  // 대조: 스캐너가 저장소를 실제로 읽었고, 암호문이 비밀을 담을 만큼 크다.
  expect(dump.records.length).toBeGreaterThan(0);
  const ciphertext = (dump.records[0].value as { ciphertext: { $bytes: string } }).ciphertext.$bytes;
  expect(ciphertext.length / 2).toBeGreaterThan(LOCKED_PRIVATE_KEY.length);

  expect(leaks(bytes)).toEqual([]);
  for (const value of [HOST_NAME, HOST_ADDRESS, HOST_USER]) {
    expect(bytes.includes(value), "host metadata in plaintext").toBe(false);
  }
  expect(dump.cookies).toBe("");
  expect(Object.keys(dump.localStorage)).toEqual([]);
  expect(Object.keys(dump.sessionStorage)).toEqual([]);
  expect(dump.caches).toEqual([]);

  // 그런데도 패스프레이즈를 넣으면 전부 돌아온다. 데이터는 저 암호문 안에 있다.
  await page.reload();
  await unlock(page);
  await expect(hostRow(page, `${HOST_NAME}-key`)).toContainText("개인키");
});

test("저장할 때마다 IV와 암호문이 바뀌고 솔트는 유지된다", async ({ page }) => {
  await createVault(page);
  const first = await dumpBrowserStorage(page);
  await addHost(page, { name: "iv-1", hostname: "iv.example", username: "ann" });
  const second = await dumpBrowserStorage(page);
  type Stored = { kdf: { salt: { $bytes: string } }; iv: { $bytes: string }; ciphertext: { $bytes: string } };
  const a = first.records[0].value as Stored;
  const b = second.records[0].value as Stored;
  expect(b.iv.$bytes).not.toBe(a.iv.$bytes);
  expect(b.ciphertext.$bytes).not.toBe(a.ciphertext.$bytes);
  expect(b.kdf.salt.$bytes).toBe(a.kdf.salt.$bytes);
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
