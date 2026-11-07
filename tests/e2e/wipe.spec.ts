// 볼트 지우기: 설정 페이지 맨 아래 "Dangerous Action" 섹션. 확인 전에는 데이터가 남고, 확인 후에는
// 호스트와 키가 사라지고 / 의 처음 설정(볼트 만들기) 화면이 된다. 복구 경로는 없다.
import { expect, type Page, test } from "./support/fixtures";
import {
  acceptFirstKey,
  addHost,
  confirmField,
  createHeading,
  createVault,
  goHome,
  goTo,
  hostRow,
  openHost,
  passphraseField,
  workspaceHeading,
} from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD, VAULT_PASSPHRASE } from "./support/secrets";

const WIPE_WARNING = "계정에 저장된 호스트와 키가 모든 기기에서 삭제되고, 열린 SSH 연결이 모두 끊깁니다. 되돌릴 수 없습니다.";

/** 볼트 지우기는 설정 페이지 맨 아래 "Dangerous Action" 섹션에 있다. */
const dangerSection = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Dangerous Action" }) });

const openWipeDialog = async (page: Page) => {
  if (!new URL(page.url()).pathname.startsWith("/settings")) await goTo(page, "설정");
  await dangerSection(page).getByRole("button", { name: "볼트 지우기" }).click();
  const dialog = page.getByRole("dialog", { name: "볼트 지우기" });
  await expect(dialog).toContainText(WIPE_WARNING);
  return dialog;
};

/** 1 while the account has a vault on the server, 0 once it is gone. The vault lives there, not in this browser. */
const storedRecords = async (page: Page) => {
  const response = await page.context().request.get("/api/vault");
  expect(response.status()).toBe(200);
  return (await response.json()).vault === null ? 0 : 1;
};

test("설정 페이지의 마지막 섹션이 Dangerous Action이고, 볼트 지우기 버튼과 연결이 끊긴다는 안내가 있다", async ({ page }) => {
  await createVault(page);
  await goTo(page, "설정");
  await expect(page.getByRole("heading", { level: 2 }).last()).toHaveText("Dangerous Action");
  await expect(dangerSection(page)).toContainText("되돌릴 수 없는 작업입니다.");
  await expect(dangerSection(page)).toContainText("열린 SSH 연결이 모두 끊깁니다.");
  await expect(dangerSection(page).getByRole("button", { name: "볼트 지우기" })).toBeEnabled();
  // 호스트 목록(데스크톱 헤더)에는 더 이상 볼트 지우기 버튼이 없다.
  await goHome(page);
  await expect(page.getByRole("button", { name: "볼트 지우기" })).toHaveCount(0);
});

test("볼트를 지우지 못하면(DELETE 500) 설정에 머물고 오류를 보이며 볼트는 남는다", async ({ page }) => {
  await createVault(page);
  await addHost(page, { name: "wipe-fail", hostname: "fail.example", username: "someone" });
  await page.route("**/api/vault", (route) =>
    route.request().method() === "DELETE" ? route.fulfill({ status: 500, body: "boom" }) : route.continue(),
  );
  const dialog = await openWipeDialog(page);
  await dialog.getByRole("button", { name: "볼트 지우기" }).click();
  await expect(dangerSection(page).getByRole("alert")).toHaveText("볼트를 지우지 못했습니다.");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(dangerSection(page).getByRole("button", { name: "볼트 지우기" })).toBeEnabled();
  expect(await storedRecords(page)).toBe(1);
  await page.unroute("**/api/vault");
  await goHome(page);
  await expect(hostRow(page, "wipe-fail")).toBeVisible();
});

test.describe("모바일", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("하단 내비의 설정에서 볼트를 지우면 처음 설정 화면이 된다", async ({ page }) => {
    await createVault(page);
    await addHost(page, { name: "wipe-phone", hostname: "phone.example", username: "someone" });
    const dialog = await openWipeDialog(page);
    await dialog.getByRole("button", { name: "볼트 지우기" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(createHeading(page)).toBeVisible();
    expect(await storedRecords(page)).toBe(0);
    await expect(page.getByText("wipe-phone")).toHaveCount(0);
  });
});

test("확인 대화상자를 취소, 닫기, Esc로 끝내면 데이터가 그대로다", async ({ page }) => {
  await createVault(page);
  await addHost(page, { name: "wipe-keep", hostname: "keep.example", username: "someone", password: SSH_PASSWORD });

  let dialog = await openWipeDialog(page);
  // 대화상자가 열렸을 뿐 아직 지워지면 안 된다.
  expect(await storedRecords(page)).toBe(1);
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/settings$/);

  dialog = await openWipeDialog(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/settings$/);

  expect(await storedRecords(page)).toBe(1);
  await goHome(page);
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

    // / 의 첫 실행 화면이 된다. 지운 볼트를 여는 입력은 없다.
    await expect(page).toHaveURL(/\/$/);
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
