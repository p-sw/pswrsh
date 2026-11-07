// 호스트를 누르면: 이 기기에 그 호스트의 탭이 있으면 그 탭으로, 없고 계정에 살아 있는 연결이 있으면
// (다른 기기 포함, 여러 개면 가장 최근에 입력한 것) 그 연결에 붙고, 아무것도 없으면 새 연결.
// ⋮ 메뉴 "새 연결"은 항상 새 연결이고, 계정 상한(20개)에 닿으면 비활성 + 이유.
// 연결 개수: 이 기기에서 열고 끊으면 1초 안에 목록 개수가 바뀐다. 다른 기기 것은 폴링(5초) 안에.
import { newDevice } from "./support/account";
import { acceptFirstKey, addHost, createVault, firstKeyDialog, hostRow, openHost, unlock } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { expect, type Page, test } from "./support/fixtures";
import { SSH_PASSWORD } from "./support/secrets";

const HOST = "reuse";
const OUTPUT = "reuse-shell-ready\r\n";
const LIMIT = 20;

let dummy: DummySsh;

test.beforeEach(async () => {
  dummy = await new DummySsh({ shellOutput: OUTPUT }).start();
});

test.afterEach(async () => {
  await dummy.stop();
});

const tabs = (page: Page) => page.getByRole("main").getByRole("tab");
const countBadge = (page: Page) => hostRow(page, HOST).getByText(/^연결 \d+개$/);
const newConnectionItem = (page: Page) => page.getByRole("menuitem", { name: /새 연결/ });

async function setUp(page: Page) {
  await createVault(page);
  await addHost(page, { name: HOST, hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
}

/** Waits for the n-th shell, accepting the first-key prompt if this device asks. */
async function shellReady(page: Page, n: number) {
  await expect
    .poll(async () => {
      if (await firstKeyDialog(page).isVisible()) await acceptFirstKey(page);
      return dummy.shells;
    })
    .toBe(n);
}

async function openNewConnection(page: Page) {
  await page.getByRole("button", { name: `${HOST} 메뉴` }).click();
  await newConnectionItem(page).click();
}

async function liveSessions(page: Page) {
  const response = await page.context().request.get("/api/sessions");
  expect(response.status()).toBe(200);
  return (await response.json()) as { sessions: { id: string; name: string; lastInputAt: string }[]; limit: number };
}

/** The same account on a second device, unlocked, on the workspace. */
async function secondDevice(page: Page, account: { email: string; password: string }) {
  const device = await newDevice(page.context(), account);
  const other = await device.newPage();
  await other.goto("/");
  await unlock(other);
  return { device, other };
}

test.describe("A. 호스트 클릭", () => {
  test("연결이 하나도 없으면 새 연결을 연다", async ({ page }) => {
    await setUp(page);
    await openHost(page, HOST);
    await shellReady(page, 1);
    await expect(page.locator(".xterm-rows")).toContainText("reuse-shell-ready");
    expect(dummy.connections).toBe(1);
    await expect(tabs(page)).toHaveCount(1);
  });

  test("이 기기에 그 호스트 탭이 있으면 다시 눌러도 새 연결 없이 그 탭으로 간다", async ({ page }) => {
    await setUp(page);
    await addHost(page, { name: "other", hostname: "127.0.0.1", port: dummy.port, username: "bob", password: SSH_PASSWORD });
    await openHost(page, HOST);
    await shellReady(page, 1);
    await openHost(page, "other");
    await shellReady(page, 2);
    await expect(tabs(page).filter({ hasText: "other" })).toHaveAttribute("aria-selected", "true");

    await openHost(page, HOST);
    await expect(tabs(page).filter({ hasText: HOST })).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(1000);
    expect(dummy.connections).toBe(2);
    await expect(tabs(page)).toHaveCount(2);
  });

  test("이 기기엔 탭이 없고 다른 기기에 살아 있는 연결이 있으면 새 연결 없이 그 연결에 붙는다", async ({ page, account }) => {
    await setUp(page);
    const { device, other } = await secondDevice(page, account);
    await openHost(other, HOST);
    await shellReady(other, 1);

    await openHost(page, HOST);
    await expect(page.locator(".xterm-rows")).toContainText("reuse-shell-ready");
    await page.waitForTimeout(1000);
    expect(dummy.connections).toBe(1);
    expect((await liveSessions(page)).sessions).toHaveLength(1);
    await expect(tabs(page)).toHaveCount(1);
    await device.close();
  });

  test("살아 있는 연결이 여러 개면 가장 최근에 입력한 연결에 붙는다", async ({ page, account }) => {
    await setUp(page);
    const { device, other } = await secondDevice(page, account);
    await openHost(other, HOST);
    await shellReady(other, 1);
    await openNewConnection(other);
    await shellReady(other, 2);
    // 먼저 연 연결("reuse")에 입력해서, 나중에 연 "reuse (2)"보다 최근에 쓴 연결로 만든다.
    await tabs(other).filter({ hasText: /^reuse$/ }).click();
    await other.locator(".xterm-helper-textarea:visible").focus();
    await other.keyboard.type("x");
    await expect.poll(() => dummy.inputHex()).toBe("78");

    await openHost(page, HOST);
    await expect(tabs(page)).toHaveCount(1);
    await expect(tabs(page)).toHaveText(/^reuse$/);
    await page.waitForTimeout(500);
    expect(dummy.connections).toBe(2);
    await device.close();
  });

  test("[앱 변경 대기] 소켓만 끊긴 탭이 있는 호스트를 누르면 새 연결 없이 살아 있는 세션에 붙는다", async ({ page }) => {
    // 페이지와 게이트웨이 사이의 웹소켓만 끊는다. SSH 연결과 게이트웨이 세션은 살아 있다.
    const sockets: { close: () => Promise<void> }[] = [];
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      ws.connectToServer();
      sockets.push(ws);
    });
    await setUp(page);
    await openHost(page, HOST);
    await shellReady(page, 1);
    await Promise.all(sockets.map((s) => s.close()));
    await expect(tabs(page)).toHaveAttribute("title", "연결 끊김");
    expect(dummy.open).toBe(1);
    expect((await liveSessions(page)).sessions).toHaveLength(1);

    await openHost(page, HOST);
    await expect(tabs(page).last()).not.toHaveAttribute("title", "연결 끊김");
    await page.waitForTimeout(1000);
    expect(dummy.connections, "a host click made a new SSH connection").toBe(1);
  });

  test("⋮ 메뉴의 '새 연결'은 탭이 있어도 새 연결을 연다", async ({ page }) => {
    await setUp(page);
    await openHost(page, HOST);
    await shellReady(page, 1);
    await page.getByRole("button", { name: `${HOST} 메뉴` }).click();
    // 수정·삭제 위에 있다.
    await expect(page.getByRole("menuitem")).toHaveText([/새 연결/, /수정/, /삭제/]);
    await newConnectionItem(page).click();
    await shellReady(page, 2);
    expect(dummy.connections).toBe(2);
    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).last()).toHaveAttribute("aria-selected", "true");
  });

  test("연결이 20개면 '새 연결'이 비활성이고 이유가 보이며, 하나 끊으면 다시 켜진다", async ({ page }) => {
    test.slow();
    await setUp(page);
    await openHost(page, HOST);
    await shellReady(page, 1);
    for (let n = 2; n <= LIMIT; n++) {
      await openNewConnection(page);
      await shellReady(page, n);
    }
    await expect.poll(async () => (await liveSessions(page)).sessions.length).toBe(LIMIT);

    await page.getByRole("button", { name: `${HOST} 메뉴` }).click();
    await expect(newConnectionItem(page)).toHaveAttribute("aria-disabled", "true");
    await expect(newConnectionItem(page)).toContainText(`연결이 계정당 상한인 ${LIMIT}개에 닿았습니다.`);
    await newConnectionItem(page).click({ force: true });
    await page.waitForTimeout(800);
    expect(dummy.connections).toBe(LIMIT);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "연결 끊기" }).first().click();
    await expect.poll(() => dummy.open).toBe(LIMIT - 1);
    await page.getByRole("button", { name: `${HOST} 메뉴` }).click();
    await expect(newConnectionItem(page)).not.toHaveAttribute("aria-disabled", "true");
    await expect(newConnectionItem(page)).not.toContainText("상한");
  });
});

test.describe("B. 연결 개수", () => {
  test("이 기기에서 열면 1초 안에 개수가 늘고, 끊으면 1초 안에 줄어든다", async ({ page }) => {
    await setUp(page);
    await openHost(page, HOST);
    await shellReady(page, 1);
    await expect(countBadge(page)).toHaveText("연결 1개", { timeout: 1000 });

    await openNewConnection(page);
    await shellReady(page, 2);
    await expect(countBadge(page)).toHaveText("연결 2개", { timeout: 1000 });

    await page.getByRole("button", { name: "연결 끊기" }).first().click();
    await expect(countBadge(page)).toHaveText("연결 1개", { timeout: 1000 });

    await page.getByRole("button", { name: "연결 끊기" }).first().click();
    await expect(countBadge(page)).toHaveCount(0, { timeout: 1000 });
  });

  test("탭의 닫기 버튼으로 닫아도 1초 안에 개수가 줄어든다", async ({ page }) => {
    await setUp(page);
    await openHost(page, HOST);
    await shellReady(page, 1);
    await openNewConnection(page);
    await shellReady(page, 2);
    await expect(countBadge(page)).toHaveText("연결 2개", { timeout: 1000 });
    await page.getByRole("button", { name: /세션 닫기$/ }).last().click();
    await expect(countBadge(page)).toHaveText("연결 1개", { timeout: 1000 });
  });

  test("다른 기기에서 열고 끊은 것도 폴링 주기(5초) 안에 반영된다", async ({ page, account }) => {
    await setUp(page);
    const { device, other } = await secondDevice(page, account);
    await openHost(other, HOST);
    await shellReady(other, 1);
    await expect(countBadge(page)).toHaveText("연결 1개", { timeout: 6000 });
    await other.getByRole("button", { name: "연결 끊기" }).first().click();
    await expect(countBadge(page)).toHaveCount(0, { timeout: 6000 });
    await device.close();
  });
});
