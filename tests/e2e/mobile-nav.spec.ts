// 모바일(폭 768px 미만) 하단 내비 nav[aria-label="주요 메뉴"]: 호스트(/) · 연결(/connections) · 키(/keys) · 설정(/settings).
// 현재 페이지 링크에 aria-current="page". 터미널을 보는 동안과 호스트 폼에서 키를 고르는 동안은 숨김.
// 768px 이상(데스크톱)에서는 없고, 계정 메뉴에 키 관리·연결 목록·설정이 있다. 모바일 계정 메뉴에는 없다.
import { expect, type Page, test } from "./support/fixtures";
import { acceptFirstKey, addHost, clickNav, createVault, goHome, mobileNav, openHost, workspaceHeading } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD } from "./support/secrets";

const PHONE = { width: 390, height: 844 };
const ITEMS = [
  { label: "호스트", path: "/", heading: "pswrsh" },
  { label: "연결", path: "/connections", heading: "연결 목록" },
  { label: "키", path: "/keys", heading: "키 관리" },
  { label: "설정", path: "/settings", heading: "설정" },
] as const;

const navLink = (page: Page, label: string) => mobileNav(page).getByRole("link", { name: label, exact: true });

test.describe("모바일", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("호스트 목록 아래에 호스트·연결·키·설정 네 링크가 이 순서로 보이고, 호스트가 현재 탭이다", async ({ page }) => {
    await createVault(page);
    await expect(mobileNav(page)).toBeVisible();
    await expect(mobileNav(page).getByRole("link")).toHaveText(ITEMS.map((i) => i.label));
    await expect(navLink(page, "호스트")).toHaveAttribute("aria-current", "page");
    for (const label of ["연결", "키", "설정"]) {
      await expect(navLink(page, label)).not.toHaveAttribute("aria-current", /.*/);
    }
    // 화면 맨 아래에 붙어 있다.
    const box = (await mobileNav(page).boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(PHONE.height);
  });

  for (const { label, path, heading } of ITEMS) {
    test(`"${label}"을 누르면 ${path}로 가고, 그 페이지에서도 내비가 보이며 "${label}"만 현재 탭이다`, async ({ page }) => {
      await createVault(page);
      // 다른 페이지에서 출발해야 이동을 볼 수 있다. 호스트는 설정에서, 나머지는 호스트에서.
      if (path === "/") await clickNav(page, "설정");
      await clickNav(page, label);
      await expect(page).toHaveURL(new RegExp(`${path === "/" ? "" : path}/?$`));
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      await expect(mobileNav(page)).toBeVisible();
      await expect(mobileNav(page).locator('[aria-current="page"]')).toHaveText([label]);
    });
  }

  for (const label of ["연결", "키", "설정"] as const) {
    test(`"${label}" 페이지 위쪽에는 "터미널로 돌아가기" 버튼이 없다(하단 내비가 대신한다)`, async ({ page }) => {
      await createVault(page);
      await clickNav(page, label);
      await expect(mobileNav(page).locator('[aria-current="page"]')).toHaveText([label]);
      await expect(page.getByRole("link", { name: "터미널로 돌아가기" })).toBeHidden();
    });
  }

  test("내비로 다녀와도(새로고침이 아니므로) 볼트는 열린 채다", async ({ page }) => {
    await createVault(page);
    await addHost(page, { name: "nav-host", hostname: "nav.example", username: "ann" });
    for (const label of ["연결", "키", "설정", "호스트"] as const) await clickNav(page, label);
    await expect(workspaceHeading(page)).toBeVisible();
    await expect(page.locator("aside li").filter({ hasText: "nav-host" })).toBeVisible();
  });

  test("계정 메뉴에는 키 관리·연결 목록·설정이 없고 로그아웃이 있다", async ({ page }) => {
    await createVault(page);
    await page.getByRole("button", { name: "계정", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "로그아웃" })).toBeVisible();
    for (const name of ["키 관리", "연결 목록", "설정"]) {
      await expect(page.getByRole("menuitem", { name, exact: true })).toBeHidden();
    }
  });

  test("호스트 폼에서 키를 고르러 키 관리로 가면 내비가 숨는다", async ({ page }) => {
    await createVault(page);
    await page.getByRole("button", { name: "호스트 추가" }).first().click();
    const dialog = page.getByRole("dialog", { name: "호스트 추가" });
    await dialog.getByRole("tab", { name: "개인키" }).click();
    await page.getByRole("link", { name: "키 관리에서 고르기" }).click();
    await expect(page.getByRole("heading", { name: "키 관리" })).toBeVisible();
    await expect(mobileNav(page)).toHaveCount(0);
    // 키를 고르는 동안에는 위쪽 뒤로 버튼이 호스트 폼으로 돌아가는 길이다.
    await page.getByRole("link", { name: "터미널로 돌아가기" }).click();
    await expect(page.getByRole("dialog", { name: "호스트 추가" })).toBeVisible();
  });

  test.describe("터미널", () => {
    let dummy: DummySsh;
    test.beforeEach(async () => {
      dummy = await new DummySsh().start();
    });
    test.afterEach(async () => {
      await dummy.stop();
    });

    test("터미널을 여는 동안 내비가 숨고, 뒤로 가서 목록으로 돌아오면 다시 보인다", async ({ page }) => {
      await createVault(page);
      await addHost(page, { name: "nav-term", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
      await openHost(page, "nav-term");
      await acceptFirstKey(page);
      await expect.poll(() => dummy.shells).toBe(1);
      await expect(page.locator(".xterm")).toBeVisible();
      await expect(mobileNav(page)).toBeHidden();

      await page.getByRole("button", { name: "뒤로" }).click();
      await expect(mobileNav(page)).toBeVisible();
      await expect(navLink(page, "호스트")).toHaveAttribute("aria-current", "page");
    });
  });
});

test.describe("데스크톱", () => {
  test("호스트·연결·키·설정 어느 페이지에도 하단 내비가 보이지 않고, 계정 메뉴로 간다", async ({ page }) => {
    await createVault(page);
    await expect(mobileNav(page)).toBeHidden();
    for (const [item, path] of [
      ["연결 목록", "/connections"],
      ["키 관리", "/keys"],
      ["설정", "/settings"],
    ] as const) {
      await page.getByRole("button", { name: "계정", exact: true }).click();
      await page.getByRole("menuitem", { name: item, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(mobileNav(page)).toBeHidden();
      // 데스크톱은 페이지 위쪽 "터미널로 돌아가기"로 돌아온다.
      await goHome(page);
    }
  });
});

test.describe("경계 폭", () => {
  for (const [width, visible] of [
    [767, true],
    [768, false],
  ] as const) {
    test(`폭 ${width}px에서는 하단 내비가 ${visible ? "보인다" : "보이지 않는다"}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await createVault(page);
      if (visible) await expect(mobileNav(page)).toBeVisible();
      else await expect(mobileNav(page)).toBeHidden();
    });
  }
});
