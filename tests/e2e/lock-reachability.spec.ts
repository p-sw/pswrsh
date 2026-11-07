// 볼트를 닫은 뒤(잠금 버튼은 없다: 같은 브라우저의 다른 탭에서 로그아웃, 또는 설정에서 볼트 지우기)
// 이 문서에서 키와 복호화된 비밀번호·개인키에 강한 참조로 도달하지 않는다.
// 이 탭에서의 로그아웃과 새로고침은 문서가 바뀌므로 여기서 재지 않는다.
// GC를 기다리는 끊긴 객체는 실패가 아니다. 도달 가능한 참조는 실패다.
import { expect, type Page, test } from "./support/fixtures";
import {
  acceptFirstKey,
  addHost,
  createHeading,
  createVault,
  goTo,
  hostMenu,
  logOut,
  openHost,
  unlock,
  unlockHeading,
  workspaceHeading,
} from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { baselineKeyIds, heapSnapshot, present, reachable } from "./support/heap";
import { KEY_PASSPHRASE, LOCKED_PRIVATE_KEY, SSH_PASSWORD, VAULT_PASSPHRASE } from "./support/secrets";

const keyLines = LOCKED_PRIVATE_KEY.split(/\r?\n/).filter((l) => l && !l.startsWith("-----"));
const DECRYPTED = [SSH_PASSWORD, KEY_PASSPHRASE, ...keyLines];

let dummy: DummySsh;
test.beforeEach(async () => {
  dummy = await new DummySsh().start();
});
test.afterEach(async () => {
  await dummy.stop();
});

/**
 * Opens the vault with every secret kind, decrypts it, uses it in a session and a form.
 * Returns the CryptoKey-named objects of this document that are not keys (taken while locked).
 */
async function useSecrets(page: Page) {
  await createVault(page);
  await addHost(page, { name: "heap-pw", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await addHost(page, {
    name: "heap-key",
    hostname: "127.0.0.1",
    port: dummy.port,
    username: "bob",
    key: { privateKey: LOCKED_PRIVATE_KEY, passphrase: KEY_PASSPHRASE },
  });
  // 잠긴 상태의 기준선: 새로고침하면 패스프레이즈를 묻는다.
  await page.reload();
  await expect(unlockHeading(page)).toBeVisible();
  const notKeys = baselineKeyIds(await heapSnapshot(page));
  await unlock(page);
  await openHost(page, "heap-pw");
  await acceptFirstKey(page);
  await expect.poll(() => dummy.shells).toBe(1);
  await openHost(page, "heap-key");
  await expect.poll(() => dummy.shells).toBe(2);
  await hostMenu(page, "heap-key", "수정");
  await page.getByRole("dialog", { name: "호스트 수정" }).getByRole("button", { name: "취소" }).click();
  return notKeys;
}

function report(hits: ReturnType<typeof reachable>) {
  // 경로에는 값이 아니라 무엇이 찾혔는지만 남긴다.
  return hits.map((h) => `${h.needle === "CryptoKey" ? "CryptoKey" : "secret string"}${h.viaReact ? " [React]" : ""}: ${h.path.replaceAll(/fake-[\w-]+/g, "<fake>")}`);
}

/** Logs out in a second tab of the same browser. This tab gets "locked" and drops its key. */
async function logOutInOtherTab(page: Page) {
  const other = await page.context().newPage();
  await other.goto("/");
  await unlock(other);
  await logOut(other);
  await expect(workspaceHeading(page)).toBeHidden();
  await other.close();
}

const FLOWS: { label: string; run: (page: Page) => Promise<void> }[] = [
  { label: "다른 탭에서 로그아웃", run: logOutInOtherTab },
  {
    label: "설정에서 볼트 지우기",
    run: async (page) => {
      await goTo(page, "설정");
      await page.getByRole("button", { name: "볼트 지우기" }).click();
      await page.getByRole("dialog", { name: "볼트 지우기" }).getByRole("button", { name: "볼트 지우기" }).click();
      await expect(createHeading(page)).toBeVisible();
    },
  },
];

for (const { label, run } of FLOWS) {
  test(`${label} 뒤 CryptoKey와 복호화된 비밀에 도달하지 않는다`, async ({ page }) => {
    test.setTimeout(120_000);
    const notKeys = await useSecrets(page);

    // 대조: 열린 동안에는 같은 검사가 키와 비밀을 찾아낸다.
    const before = reachable(await heapSnapshot(page), DECRYPTED, notKeys);
    expect(before.some((h) => h.needle === "CryptoKey"), "control: key reachable while open").toBe(true);
    expect(before.some((h) => h.needle !== "CryptoKey"), "control: secrets reachable while open").toBe(true);

    await run(page);
    await expect.poll(() => dummy.open).toBe(0);
    await page.waitForTimeout(1000);

    const after = reachable(await heapSnapshot(page), DECRYPTED, notKeys);
    expect(report(after)).toEqual([]);
  });
}

test("다른 탭에서 로그아웃한 뒤 볼트 패스프레이즈 문자열에도 도달하지 않는다", async ({ page }) => {
  test.setTimeout(120_000);
  const notKeys = await useSecrets(page);
  await logOutInOtherTab(page);
  await page.waitForTimeout(1000);
  const snapshot = await heapSnapshot(page);
  const hits = reachable(snapshot, [VAULT_PASSPHRASE], notKeys);
  if (present(snapshot, VAULT_PASSPHRASE) && hits.length === 0) {
    test.info().annotations.push({ type: "note", description: "passphrase string present but unreachable (awaiting GC)" });
  }
  expect(report(hits)).toEqual([]);
});
