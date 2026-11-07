// 잠금: 메모리의 키를 지우고 세션을 끊으며 잠금 화면으로 간다.
import { expect, type Page, test } from "./support/fixtures";
import {
  acceptFirstKey,
  addHost,
  createVault,
  hostRow,
  lock,
  openHost,
  passphraseField,
  unlock,
  unlockHeading,
} from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD, VAULT_PASSPHRASE } from "./support/secrets";

/** Live CryptoKey objects in the page's JS heap after a forced GC. Reads no app internals. */
async function liveCryptoKeys(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("HeapProfiler.collectGarbage");
    const { result: proto } = await cdp.send("Runtime.evaluate", { expression: "CryptoKey.prototype" });
    const { objects } = await cdp.send("Runtime.queryObjects", { prototypeObjectId: proto.objectId! });
    const { result } = await cdp.send("Runtime.callFunctionOn", {
      objectId: objects.objectId!,
      functionDeclaration: "function () { return this.length; }",
      returnByValue: true,
    });
    // queryObjects의 배열 자체가 키를 붙잡으므로, 다음 측정 전에 놓아 준다.
    await cdp.send("Runtime.releaseObject", { objectId: objects.objectId! });
    await cdp.send("Runtime.releaseObject", { objectId: proto.objectId! });
    return result.value as number;
  } finally {
    await cdp.detach();
  }
}

test.describe("열린 세션이 있을 때", () => {
  let dummy: DummySsh;
  test.beforeEach(async () => {
    dummy = await new DummySsh().start();
  });
  test.afterEach(async () => {
    await dummy.stop();
  });

  test("서버 연결이 끊기고, 잠금 화면으로 가며, 호스트와 터미널이 화면에서 사라진다", async ({ page }) => {
    await createVault(page);
    await addHost(page, {
      name: "lock-host",
      hostname: "127.0.0.1",
      port: dummy.port,
      username: "someone",
      password: SSH_PASSWORD,
    });
    await openHost(page, "lock-host");
    await acceptFirstKey(page);
    await expect.poll(() => dummy.shells).toBe(1);
    await expect.poll(() => dummy.open).toBe(1);

    await lock(page);

    await expect(unlockHeading(page)).toBeVisible();
    await expect.poll(() => dummy.open).toBe(0);
    await expect(page.locator(".xterm")).toHaveCount(0);
    await expect(page.getByText("lock-host")).toHaveCount(0);
    await expect(passphraseField(page)).toHaveValue("");

    // 패스프레이즈 없이는 돌아갈 수 없고, 다시 열어도 세션은 되살아나지 않는다.
    await page.reload();
    await unlock(page);
    await expect(hostRow(page, "lock-host")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.locator(".xterm")).toHaveCount(0);
    expect(dummy.connections).toBe(1);
  });
});

test("잠금 뒤에는 틀린 패스프레이즈로 열리지 않는다", async ({ page }) => {
  await createVault(page);
  await addHost(page, { name: "lock-host-2", hostname: "lock.example", username: "someone" });
  await lock(page);
  await passphraseField(page).fill(`${VAULT_PASSPHRASE}x`);
  await page.getByRole("button", { name: "잠금 해제" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "패스프레이즈가 맞지 않습니다." })).toBeVisible();
  await expect(page.getByText("lock-host-2")).toHaveCount(0);
});

test("잠금 뒤 페이지 메모리에 CryptoKey가 남지 않는다", async ({ page }) => {
  await createVault(page);
  // 대조: 열린 동안에는 키가 힙에서 보여야 이 측정이 의미가 있다.
  expect(await liveCryptoKeys(page)).toBeGreaterThan(0);

  await lock(page);
  await expect(unlockHeading(page)).toBeVisible();

  await expect.poll(() => liveCryptoKeys(page), { timeout: 20_000, intervals: [500, 1000, 2000] }).toBe(0);
});
