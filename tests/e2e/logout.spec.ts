// 로그아웃(잠금 버튼은 없다): 서버의 SSH 연결을 끊고, 이 브라우저에 저장된 볼트 키를 지우고 /login으로 간다.
// 다시 로그인하면 패스프레이즈를 묻는다. 같은 브라우저의 다른 탭도 키를 놓는다.
import { expect, type Page, test } from "./support/fixtures";
import {
  acceptFirstKey,
  addHost,
  createVault,
  hostRow,
  logInWithForm,
  logOut,
  logOutAndBackIn,
  openHost,
  passphraseField,
  unlock,
  unlockHeading,
  workspaceHeading,
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

test("잠금 버튼은 없다", async ({ page }) => {
  await createVault(page);
  await expect(page.getByRole("button", { name: "잠금", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "로그아웃" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /잠금/ })).toHaveCount(0);
});

test.describe("열린 세션이 있을 때", () => {
  let dummy: DummySsh;
  test.beforeEach(async () => {
    dummy = await new DummySsh().start();
  });
  test.afterEach(async () => {
    await dummy.stop();
  });

  test("로그아웃하면 SSH 연결이 끊기고, 다시 로그인하면 패스프레이즈를 묻고, 열어도 세션은 되살아나지 않는다", async ({
    page,
    account,
  }) => {
    await createVault(page);
    await addHost(page, {
      name: "logout-host",
      hostname: "127.0.0.1",
      port: dummy.port,
      username: "someone",
      password: SSH_PASSWORD,
    });
    await openHost(page, "logout-host");
    await acceptFirstKey(page);
    await expect.poll(() => dummy.shells).toBe(1);
    await expect.poll(() => dummy.open).toBe(1);

    await logOut(page);
    await expect.poll(() => dummy.open).toBe(0);
    await expect(page.getByText("logout-host")).toHaveCount(0);

    await logInWithForm(page, account);
    await expect(unlockHeading(page)).toBeVisible();
    await expect(passphraseField(page)).toHaveValue("");
    await expect(page.getByText("logout-host")).toHaveCount(0);
    await unlock(page);
    await expect(hostRow(page, "logout-host")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.locator(".xterm")).toHaveCount(0);
    expect(dummy.connections).toBe(1);
  });
});

test("로그아웃 뒤 다시 로그인하면 틀린 패스프레이즈로 열리지 않는다", async ({ page, account }) => {
  await createVault(page);
  await addHost(page, { name: "logout-host-2", hostname: "logout.example", username: "someone" });
  await logOutAndBackIn(page, account);
  await passphraseField(page).fill(`${VAULT_PASSPHRASE}x`);
  await page.getByRole("button", { name: "잠금 해제" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "패스프레이즈가 맞지 않습니다." })).toBeVisible();
  await expect(page.getByText("logout-host-2")).toHaveCount(0);
});

test.describe("같은 브라우저의 다른 탭에서 로그아웃하면", () => {
  // 그 뒤 이 탭 화면은 실행마다 다르다(잠금 해제 화면 또는 "서버에서 볼트를 불러오지 못했습니다."). 기대값 미정이라 묻지 않는다.
  test("이 탭도 볼트를 닫아 호스트 목록과 호스트가 사라진다", async ({ page }) => {
    await createVault(page);
    await addHost(page, { name: "other-tab-host", hostname: "tab.example", username: "someone" });
    const other = await page.context().newPage();
    await other.goto("/");
    await unlock(other);
    await logOut(other);

    await expect(workspaceHeading(page)).toBeHidden();
    await expect(page.getByText("other-tab-host")).toHaveCount(0);
    await other.close();
  });

  test("이 탭 메모리에 CryptoKey가 남지 않는다", async ({ page }) => {
    await createVault(page);
    // 대조: 열린 동안에는 키가 힙에서 보여야 이 측정이 의미가 있다.
    expect(await liveCryptoKeys(page)).toBeGreaterThan(0);

    const other = await page.context().newPage();
    await other.goto("/");
    await unlock(other);
    await logOut(other);
    await expect(workspaceHeading(page)).toBeHidden();

    await expect.poll(() => liveCryptoKeys(page), { timeout: 20_000, intervals: [500, 1000, 2000] }).toBe(0);
    await other.close();
  });
});
