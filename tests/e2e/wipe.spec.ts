// 볼트 지우기: 확인 전에는 데이터가 남고, 확인 후에는 호스트와 키가 사라진다. 복구 경로는 없다.
import { expect, type Page, test } from "./support/fixtures";
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
  await expect(dialog).toContainText("계정에 저장된 호스트와 키가 모든 기기에서 삭제됩니다. 되돌릴 수 없습니다.");
  return dialog;
};

/** 1 while the account has a vault on the server, 0 once it is gone. The vault lives there, not in this browser. */
const storedRecords = async (page: Page) => {
  const response = await page.context().request.get("/api/vault");
  expect(response.status()).toBe(200);
  return (await response.json()).vault === null ? 0 : 1;
};

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
    // 링크는 계정 기능인 "연결 목록"뿐이다(볼트와 무관). 복구로 가는 링크는 없다.
    await expect(page.getByRole("main").getByRole("link")).toHaveText(["연결 목록"]);
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

test.describe("볼트 지우기와 SSH 연결", () => {
  async function connectedHost(page: Page, dummy: DummySsh) {
    await createVault(page);
    await addHost(page, { name: "wipe-live", hostname: "127.0.0.1", port: dummy.port, username: "someone", password: SSH_PASSWORD });
    await openHost(page, "wipe-live");
    await acceptFirstKey(page);
    await expect.poll(() => dummy.open).toBe(1);
  }

  const liveCount = async (page: Page) => {
    const response = await page.context().request.get("/api/sessions");
    expect(response.status()).toBe(200);
    return ((await response.json()) as { sessions: unknown[] }).sessions.length;
  };

  test("확인하면 POST /api/sessions/close-all을 먼저 보낸 뒤 DELETE /api/vault를 보낸다", async ({ page }) => {
    const dummy = await new DummySsh().start();
    try {
      await connectedHost(page, dummy);
      // close-all 응답이 끝나기 전에는 DELETE가 나가지 않는지 보려고 응답을 잠깐 늦춘다.
      await page.route("**/api/sessions/close-all", async (route) => {
        await new Promise((r) => setTimeout(r, 300));
        await route.continue();
      });
      const dialog = await openWipeDialog(page);
      // 확인 버튼을 누른 뒤에 나가는 요청만 본다(호스트 저장의 PUT 등은 그 전이다).
      const order: string[] = [];
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path === "/api/sessions/close-all" || (path === "/api/vault" && request.method() !== "GET")) {
          order.push(`${request.method()} ${path}`);
        }
      });
      await dialog.getByRole("button", { name: "볼트 지우기" }).click();
      await expect(createHeading(page)).toBeVisible();
      await expect.poll(() => order.length).toBe(2);
      expect(order).toEqual(["POST /api/sessions/close-all", "DELETE /api/vault"]);
    } finally {
      await dummy.stop();
    }
  });

  test("지운 뒤 계정의 연결 수는 0이고 SSH 연결도 끊긴다", async ({ page }) => {
    const dummy = await new DummySsh().start();
    try {
      await connectedHost(page, dummy);
      await expect.poll(() => liveCount(page)).toBe(1);
      const dialog = await openWipeDialog(page);
      await dialog.getByRole("button", { name: "볼트 지우기" }).click();
      await expect(createHeading(page)).toBeVisible();
      await expect.poll(() => liveCount(page)).toBe(0);
      await expect.poll(() => dummy.open).toBe(0);
    } finally {
      await dummy.stop();
    }
  });

  for (const [label, fail] of [
    ["서버 오류(500)", "500"],
    ["네트워크 실패", "abort"],
  ] as const) {
    test(`close-all이 ${label}로 실패해도 볼트는 지워진다`, async ({ page }) => {
      const dummy = await new DummySsh().start();
      try {
        await connectedHost(page, dummy);
        await page.route("**/api/sessions/close-all", (route) =>
          fail === "abort" ? route.abort("failed") : route.fulfill({ status: 500, body: "boom" }),
        );
        const dialog = await openWipeDialog(page);
        await dialog.getByRole("button", { name: "볼트 지우기" }).click();
        await expect(createHeading(page)).toBeVisible();
        expect(await storedRecords(page)).toBe(0);
        await expect(page.getByText("wipe-live")).toHaveCount(0);
      } finally {
        await dummy.stop();
      }
    });
  }
});
