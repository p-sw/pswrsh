// 첫 볼트: 패스프레이즈 두 번이 같아야 생기고, 8자 미만은 거절, 틀린 패스프레이즈는 열리지 않는다.
import { expect, test } from "@playwright/test";
import {
  addHost,
  confirmField,
  createHeading,
  createVault,
  hostRow,
  passphraseField,
  unlock,
  unlockHeading,
  workspaceHeading,
} from "./support/app";
import { VAULT_PASSPHRASE } from "./support/secrets";

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
  await page.reload();
  await unlock(page, "12345678");
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
