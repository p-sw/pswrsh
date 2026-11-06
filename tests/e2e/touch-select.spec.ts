// 모바일 터치로 터미널 글자를 선택할 수 있고, 그 선택만 복사된다.
// 터치는 CDP Input.dispatchTouchEvent로 보낸다. 브라우저가 진짜 터치로 받는다.
import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { acceptFirstKey, addHost, createVault, openHost } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD } from "./support/secrets";

const OUTPUT = "TOUCHROW alpha bravo charlie\r\nSECONDROW delta echo\r\nTHIRDROW foxtrot\r\n";
const CLIPBOARD_BEFORE = "clipboard-before-touch";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  permissions: ["clipboard-read", "clipboard-write"],
});

let dummy: DummySsh;
let cdp: CDPSession;

test.beforeEach(async ({ page }) => {
  dummy = await new DummySsh({ shellOutput: OUTPUT }).start();
  cdp = await page.context().newCDPSession(page);
  await createVault(page);
  await addHost(page, { name: "touch", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await openHost(page, "touch");
  await acceptFirstKey(page);
  await expect.poll(() => dummy.shells).toBe(1);
  await expect(page.locator(".xterm-rows")).toContainText("THIRDROW");
  await page.evaluate((text) => navigator.clipboard.writeText(text), CLIPBOARD_BEFORE);
});

test.afterEach(async () => {
  await cdp.detach().catch(() => {});
  await dummy.stop();
});

/** Center of a character cell of the visible screen. */
async function cell(page: Page, row: number, col: number) {
  const box = (await page.locator(".xterm-screen").boundingBox())!;
  const { cols, rows } = dummy.size!;
  return { x: box.x + (box.width / cols) * (col + 0.5), y: box.y + (box.height / rows) * (row + 0.5) };
}

const touch = (type: "touchStart" | "touchMove" | "touchEnd", point?: { x: number; y: number }) =>
  cdp.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ x: point.x, y: point.y }] : [] });

async function longPress(page: Page, at: { x: number; y: number }, holdMs = 700) {
  await touch("touchStart", at);
  await page.waitForTimeout(holdMs);
}

async function moveTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    await page.waitForTimeout(20);
  }
}

const copyButton = (page: Page) => page.getByRole("button", { name: "복사", exact: true });
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test("길게 누르면 그 단어가 선택되고, 복사하면 그 단어만 들어간다", async ({ page }) => {
  const at = await cell(page, 0, 17); // "bravo"
  await longPress(page, at);
  await touch("touchEnd");
  await copyButton(page).tap();
  await expect(page.getByText("선택한 내용을 복사했습니다.")).toBeVisible();
  expect(await clipboard(page)).toBe("bravo");
});

test("길게 누른 뒤 끌면 글자 단위로 선택되고 그 범위만 복사된다", async ({ page }) => {
  const from = await cell(page, 1, 0);
  const to = await cell(page, 1, 8); // "SECONDROW" 끝 글자
  await longPress(page, from);
  await moveTo(page, from, { x: to.x + 1, y: to.y });
  await touch("touchEnd");
  await copyButton(page).tap();
  const text = await clipboard(page);
  expect(text.startsWith("SECONDRO"), `copied ${JSON.stringify(text)}`).toBe(true);
  expect(text.length).toBeLessThanOrEqual("SECONDROW".length);
  expect(text).not.toContain("TOUCHROW");
  expect(text).not.toContain("THIRDROW");
});

test("짧게 탭하면 선택이 없고, 복사해도 클립보드가 그대로다", async ({ page }) => {
  const at = await cell(page, 0, 17);
  await touch("touchStart", at);
  await page.waitForTimeout(60);
  await touch("touchEnd");
  await copyButton(page).tap();
  await expect(page.getByText("선택된 텍스트가 없습니다")).toBeVisible();
  expect(await clipboard(page)).toBe(CLIPBOARD_BEFORE);
});

test("선택한 뒤 탭하면 선택이 풀리고 복사되지 않는다", async ({ page }) => {
  const at = await cell(page, 0, 17);
  await longPress(page, at);
  await touch("touchEnd");
  await page.locator(".xterm-screen").tap({ position: { x: 20, y: 200 } });
  await copyButton(page).tap();
  await expect(page.getByText("선택된 텍스트가 없습니다")).toBeVisible();
  expect(await clipboard(page)).toBe(CLIPBOARD_BEFORE);
});

test("터치 선택 중에는 서버로 바이트가 나가지 않는다", async ({ page }) => {
  dummy.takeInputHex();
  const from = await cell(page, 0, 9);
  await longPress(page, from);
  await moveTo(page, from, await cell(page, 0, 20));
  await touch("touchEnd");
  await page.waitForTimeout(300);
  expect(dummy.inputHex()).toBe("");
});

test("서버 앱이 마우스를 추적해도 터치로 선택되고 마우스 보고가 나가지 않는다", async ({ page }) => {
  dummy.write("\x1b[?1000hMOUSE-ON\r\n");
  await expect(page.locator(".xterm-rows")).toContainText("MOUSE-ON");
  dummy.takeInputHex();
  // MOUSE-ON 줄이 화면 아래로 밀렸어도 첫 줄의 bravo는 그대로 있다.
  await longPress(page, await cell(page, 0, 17));
  await touch("touchEnd");
  await page.waitForTimeout(300);
  expect(dummy.inputHex()).toBe("");
  await copyButton(page).tap();
  expect(await clipboard(page)).toBe("bravo");
});
