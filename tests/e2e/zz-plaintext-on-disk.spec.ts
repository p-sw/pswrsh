// 디스크와 로그에 비밀번호, 개인키, 패스프레이즈 평문이 없다.
// 이름이 zz인 이유: 다른 스펙이 비밀을 쓴 뒤에 돌아 그 흔적까지 함께 본다.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { acceptFirstKey, addHost, createVault, lock, openHost, unlock } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { APP_ORIGIN } from "./support/ports";
import { KEY_PASSPHRASE, leaks, LOCKED_PRIVATE_KEY, RUN, secretNeedles, SSH_PASSWORD } from "./support/secrets";

const ARTIFACTS = process.env.PSWRSH_TEST_ARTIFACTS!;
const ROOT = process.env.PSWRSH_TEST_ROOT!;
const LOG = process.env.PSWRSH_TEST_LOG!;
const MARKER = process.env.PSWRSH_TEST_MARKER!;
const CONTROL = `pswrsh-scan-control-${RUN}`;

function grepFiles(patternFile: string, paths: string[], sudo = false) {
  const command = sudo ? "sudo" : "grep";
  const grepArgs = ["-rlaF", "-f", patternFile, "--", ...paths];
  const result = spawnSync(command, sudo ? ["-n", "grep", ...grepArgs] : grepArgs, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, files: result.stdout.split("\n").filter(Boolean) };
}

test("실제 브라우저 프로필, 앱 로그, 이번 실행에서 바뀐 파일에 평문이 없다", async () => {
  test.setTimeout(300_000);

  const patterns = join(ARTIFACTS, "scan-patterns.txt");
  const controlPatterns = join(ARTIFACTS, "scan-control.txt");
  writeFileSync(patterns, secretNeedles().map((n) => n.value).join("\n") + "\n");
  writeFileSync(controlPatterns, `${CONTROL}\n`);

  const profile = mkdtempSync(join(tmpdir(), "pswrsh-profile-"));
  const dummy = await new DummySsh().start();
  try {
    // 모든 종류의 비밀을 실제 프로필에 저장하고, 게이트웨이로 보낸다.
    const context = await chromium.launchPersistentContext(profile, {
      baseURL: APP_ORIGIN,
      viewport: { width: 1280, height: 800 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await createVault(page);
    await addHost(page, { name: "disk-pw", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
    await addHost(page, {
      name: "disk-key",
      hostname: "127.0.0.1",
      port: dummy.port,
      username: "bob",
      key: { privateKey: LOCKED_PRIVATE_KEY, passphrase: KEY_PASSPHRASE },
    });
    await openHost(page, "disk-pw");
    await acceptFirstKey(page);
    await expect.poll(() => dummy.shells).toBe(1);
    await openHost(page, "disk-key");
    await expect.poll(() => dummy.shells).toBe(2);
    await lock(page);
    await unlock(page);

    // 대조: 평문을 IndexedDB와 localStorage에 넣으면 이 스캔이 프로필에서 찾아낸다.
    await page.evaluate(async (value) => {
      localStorage.setItem("scan-control", value);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("scan-control", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("s");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction("s", "readwrite");
          tx.objectStore("s").put(value, "k");
          tx.oncomplete = () => {
            request.result.close();
            resolve();
          };
        };
      });
    }, CONTROL);
    await context.close();

    expect(grepFiles(controlPatterns, [profile]).files.length, "scanner cannot see the profile").toBeGreaterThan(0);
    expect(grepFiles(patterns, [profile]).files, "plaintext in browser profile").toEqual([]);

    // 앱 프로세스 출력. 대조: 로그가 실제로 잡히고 있다.
    const log = readFileSync(LOG);
    expect(log.includes("[gateway] listening")).toBe(true);
    expect(leaks(log), "plaintext in app log").toEqual([]);

    // 이번 실행에서 바뀐 파일 전부. 테스트 자신의 산출물은 뺀다.
    const find = spawnSync(
      "find",
      [ROOT, tmpdir(), homedir(), "-xdev", "-type", "f", "-newer", MARKER, "-size", "-64M", "-not", "-path", `${ARTIFACTS}*`, "-print0"],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    const changed = [...new Set(find.stdout.split("\0").filter(Boolean))].filter(
      (path) => !path.includes("/node_modules/") && !path.startsWith(profile),
    );
    expect(changed.length, "nothing to scan").toBeGreaterThan(0);
    const hits: string[] = [];
    for (let i = 0; i < changed.length; i += 500) {
      hits.push(...grepFiles(patterns, changed.slice(i, i + 500)).files);
    }
    expect(hits, "plaintext in files changed during this run").toEqual([]);

    // 시스템 로그는 읽기만 한다. 권한이 없으면 안 본 것으로 적는다.
    const system = grepFiles(patterns, ["/var/log"], true);
    if (system.status === 0 || system.status === 1) {
      expect(system.files, "plaintext in /var/log").toEqual([]);
    } else {
      test.info().annotations.push({ type: "not-checked", description: "/var/log unreadable" });
    }
  } finally {
    await dummy.stop();
    rmSync(profile, { recursive: true, force: true });
    rmSync(patterns, { force: true });
    rmSync(controlPatterns, { force: true });
  }
});
