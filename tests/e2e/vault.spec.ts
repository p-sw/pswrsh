// 첫 볼트: 패스프레이즈 두 번이 같아야 생기고, 8자 미만은 거절, 틀린 패스프레이즈는 열리지 않는다.
// 볼트 키는 메모리에만 있다(28d6ddc에서 새로고침 유지를 되돌림). 새로고침·새 탭·다시 로그인하면 다시 묻고,
// 브라우저 저장소에 키를 두지 않는다. 잠금 버튼은 없다.
import { expect, type Page, test } from "./support/fixtures";
import { logIn, newDevice, seedAccount } from "./support/account";
import {
  addHost,
  confirmField,
  createHeading,
  createVault,
  hostRow,
  logInWithForm,
  logOut,
  passphraseField,
  reopen,
  unlock,
  unlockHeading,
  workspaceHeading,
} from "./support/app";
import { VAULT_PASSPHRASE } from "./support/secrets";

/** CryptoKey objects stored in any IndexedDB database of this origin. */
const storedCryptoKeys = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const isKey = (value: unknown): boolean =>
      value instanceof CryptoKey ||
      (Array.isArray(value) ? value.some(isKey) : !!value && typeof value === "object" && Object.values(value).some(isKey));
    let count = 0;
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const values = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        count += values.filter(isKey).length;
      }
      db.close();
    }
    return count;
  });

test("서로 다른 두 입력이면 볼트가 생기지 않는다", async ({ page }) => {
  await page.goto("/");
  await passphraseField(page).fill(VAULT_PASSPHRASE);
  await confirmField(page).fill(`${VAULT_PASSPHRASE}x`);
  await page.getByRole("button", { name: "볼트 만들기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "두 패스프레이즈가 같지 않습니다." })).toBeVisible();
  await expect(workspaceHeading(page)).toBeHidden();
  await page.reload();
  await expect(createHeading(page)).toBeVisible();
});

test("7자는 두 입력이 같아도 거절되고 볼트가 생기지 않는다", async ({ page }) => {
  await page.goto("/");
  await passphraseField(page).fill("1234567");
  await confirmField(page).fill("1234567");
  await page.getByRole("button", { name: "볼트 만들기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "8자 이상" })).toBeVisible();
  await expect(workspaceHeading(page)).toBeHidden();
  await page.reload();
  await expect(createHeading(page)).toBeVisible();
});

test("8자는 받아들이고, 다시 열 때 그 패스프레이즈로 열린다", async ({ page }) => {
  await createVault(page, "12345678");
  await reopen(page, "12345678");
});

test("틀린 패스프레이즈는 열리지 않고 호스트를 보여 주지 않으며, 맞으면 열린다", async ({ page }) => {
  await createVault(page);
  await addHost(page, { name: "vault-host", hostname: "vault.example", username: "someone" });
  await page.reload();
  await expect(unlockHeading(page)).toBeVisible();

  for (const wrong of [`${VAULT_PASSPHRASE}x`, "short", VAULT_PASSPHRASE.toUpperCase()]) {
    await passphraseField(page).fill(wrong);
    await page.getByRole("button", { name: "잠금 해제" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "패스프레이즈가 맞지 않습니다." })).toBeVisible();
    await expect(workspaceHeading(page)).toBeHidden();
    await expect(page.getByText("vault-host")).toHaveCount(0);
    await expect(page.getByText("vault.example")).toHaveCount(0);
  }
  await unlock(page);
  await expect(hostRow(page, "vault-host")).toBeVisible();
});

test.describe("볼트 키는 메모리에만 있다", () => {
  test("새로고침하면 패스프레이즈를 다시 묻고, 그 전에는 호스트를 보여 주지 않는다", async ({ page }) => {
    await createVault(page);
    await addHost(page, { name: "ask-again", hostname: "ask.example", username: "someone" });
    await page.reload();
    await expect(unlockHeading(page)).toBeVisible();
    await expect(page.getByText("ask-again")).toHaveCount(0);
    await unlock(page);
    await expect(hostRow(page, "ask-again")).toBeVisible();
  });

  test("같은 브라우저의 새 탭도 패스프레이즈를 묻는다", async ({ page }) => {
    await createVault(page);
    const other = await page.context().newPage();
    await other.goto("/");
    await expect(unlockHeading(other)).toBeVisible();
    await expect(workspaceHeading(page)).toBeVisible();
    await other.close();
  });

  test("볼트를 연 뒤에도 브라우저 저장소에 키를 두지 않는다(pswrsh-vault-key 없음, 저장된 CryptoKey 0개)", async ({ page }) => {
    await createVault(page);
    await addHost(page, { name: "no-saved-key", hostname: "nokey.example", username: "someone" });
    await reopen(page);
    expect(await storedCryptoKeys(page)).toBe(0);
    const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    expect(names).not.toContain("pswrsh-vault-key");
  });
});

test.describe("로그아웃과 계정 바꾸기", () => {
  test("로그아웃 뒤 다시 로그인하면 잠금 해제 화면이다", async ({ page, account }) => {
    await createVault(page);
    await logOut(page);
    await logInWithForm(page, account);
    await expect(unlockHeading(page)).toBeVisible();
    await expect(workspaceHeading(page)).toBeHidden();
  });

  test("다른 계정으로 로그인하면 그 계정의 볼트를 그 계정의 패스프레이즈로 열고, 이전 계정 호스트는 보이지 않는다", async ({
    page,
  }) => {
    await createVault(page);
    await addHost(page, { name: "first-account-host", hostname: "first.example", username: "someone" });

    const other = await seedAccount();
    const deviceB = await newDevice(page.context(), other);
    const pageB = await deviceB.newPage();
    await createVault(pageB, "second-account-passphrase");
    await addHost(pageB, { name: "second-account-host", hostname: "second.example", username: "someone" });
    await deviceB.close();

    await logIn(page.context(), other);
    await page.reload();
    await expect(unlockHeading(page)).toBeVisible();
    await expect(page.getByText("first-account-host")).toHaveCount(0);

    // 이전 계정의 패스프레이즈로는 열리지 않는다.
    await passphraseField(page).fill(VAULT_PASSPHRASE);
    await page.getByRole("button", { name: "잠금 해제" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "패스프레이즈가 맞지 않습니다." })).toBeVisible();

    await unlock(page, "second-account-passphrase");
    await expect(hostRow(page, "second-account-host")).toBeVisible();
    await expect(page.getByText("first-account-host")).toHaveCount(0);
  });

  test("볼트가 없는 다른 계정으로 로그인하면 볼트 만들기 화면이다", async ({ page }) => {
    await createVault(page);
    await addHost(page, { name: "first-only", hostname: "first.example", username: "someone" });
    await logIn(page.context(), await seedAccount());
    await page.reload();
    await expect(createHeading(page)).toBeVisible();
    await expect(page.getByText("first-only")).toHaveCount(0);
  });
});
