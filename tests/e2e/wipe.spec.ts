// 볼트 지우기: 확인 전에는 데이터가 남고, 확인 후에는 호스트와 키가 사라진다. 복구 경로는 없다.
import { expect, type Page, test } from "@playwright/test";
import {
  acceptFirstKey,
  addHost,
  confirmField,
  createHeading,
  createVault,
  hostRow,
  openHost,
  passphraseField,
  unlock,
  workspaceHeading,
} from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD, VAULT_PASSPHRASE } from "./support/secrets";

const openWipeDialog = async (page: Page) => {
  await page.getByRole("button", { name: "볼트 지우기" }).click();
  const dialog = page.getByRole("dialog", { name: "볼트 지우기" });
  await expect(dialog).toContainText("이 브라우저의 호스트와 키가 삭제됩니다. 되돌릴 수 없습니다.");
  return dialog;
};

const storedRecords = (page: Page) =>
  page.evaluate(async () => {
    let count = 0;
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        count += await new Promise<number>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      db.close();
    }
    return count;
  });

test("확인 대화상자를 취소, 닫기, Esc로 끝내면 데이터가 그대로다", async ({ page }) => {
  await createVault(page);
  await addHost(page, { name: "wipe-keep", hostname: "keep.example", username: "someone", password: SSH_PASSWORD });

  let dialog = await openWipeDialog(page);
  // 대화상자가 열렸을 뿐 아직 지워지면 안 된다.
  expect(await storedRecords(page)).toBe(1);
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  await expect(hostRow(page, "wipe-keep")).toBeVisible();

  dialog = await openWipeDialog(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(hostRow(page, "wipe-keep")).toBeVisible();

  expect(await storedRecords(page)).toBe(1);
  await page.reload();
  await unlock(page);
  await expect(hostRow(page, "wipe-keep")).toBeVisible();
});

test("확인하면 호스트와 키가 사라지고, 복구 경로가 없으며, 같은 패스프레이즈로도 되돌아오지 않는다", async ({ page }) => {
  const dummy = await new DummySsh().start();
  try {
    await createVault(page);
    await addHost(page, {
      name: "wipe-gone",
      hostname: "127.0.0.1",
      port: dummy.port,
      username: "someone",
      password: SSH_PASSWORD,
    });
    await openHost(page, "wipe-gone");
    await acceptFirstKey(page);
    await expect.poll(() => dummy.open).toBe(1);

    const dialog = await openWipeDialog(page);
    await dialog.getByRole("button", { name: "볼트 지우기" }).click();

    // 첫 실행 화면이 된다. 지운 볼트를 여는 입력은 없다.
    await expect(createHeading(page)).toBeVisible();
    await expect(page.getByText("wipe-gone")).toHaveCount(0);
    await expect.poll(() => dummy.open).toBe(0);
    expect(await storedRecords(page)).toBe(0);

    await page.reload();
    await expect(createHeading(page)).toBeVisible();
    expect(await storedRecords(page)).toBe(0);

    // 복구, 힌트, 백업 경로가 없다: 이 화면에서 누를 수 있는 것은 볼트 만들기뿐이다.
    await passphraseField(page).fill(VAULT_PASSPHRASE);
    await confirmField(page).fill(VAULT_PASSPHRASE);
    // main으로 좁힌다: pnpm dev에는 Next 개발 도구 버튼이 더 있다.
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(1);
    await expect(page.getByRole("main").getByRole("link")).toHaveCount(0);
    await expect(page.getByText(/힌트|백업|복구하기|복원/)).toHaveCount(0);

    // 같은 패스프레이즈로 만들어도 빈 볼트다.
    await page.getByRole("button", { name: "볼트 만들기" }).click();
    await expect(workspaceHeading(page)).toBeVisible();
    await expect(page.getByText("저장된 호스트가 없습니다.")).toBeVisible();
    await expect(page.getByText("wipe-gone")).toHaveCount(0);

    // 호스트 키 기록도 지워졌다: 같은 주소가 다시 처음 접속으로 나온다.
    await addHost(page, {
      name: "wipe-again",
      hostname: "127.0.0.1",
      port: dummy.port,
      username: "someone",
      password: SSH_PASSWORD,
    });
    await openHost(page, "wipe-again");
    await expect(page.getByRole("dialog", { name: "처음 접속하는 호스트입니다" })).toBeVisible();
  } finally {
    await dummy.stop();
  }
});
