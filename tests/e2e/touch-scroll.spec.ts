// 모바일: 한 손가락을 바로 끌면 스크롤백, 길게 누른 뒤 끌면 선택만.
// 판정 문구: "위로 끌면 이전 출력이 보이고, 아래로 끌면 돌아온다." 손가락이 움직이는 방향이다.
import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { acceptFirstKey, addHost, createVault, openHost } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD } from "./support/secrets";

const LINES = 300;
const OUTPUT = Array.from({ length: LINES }, (_, i) => `line-${String(i).padStart(3, "0")} ${"x".repeat(8)}`).join("\r\n");
const CLIPBOARD_BEFORE = "clipboard-before-scroll";

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
  await addHost(page, { name: "scroll", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await openHost(page, "scroll");
  await acceptFirstKey(page);
  await expect.poll(() => dummy.shells).toBe(1);
  await expect(page.locator(".xterm-rows")).toContainText(`line-${LINES - 1}`);
  await page.evaluate((text) => navigator.clipboard.writeText(text), CLIPBOARD_BEFORE);
});

test.afterEach(async () => {
  await cdp.detach().catch(() => {});
  await dummy.stop();
});

/** Line numbers of the rows the user can see right now, top to bottom. */
async function visibleLines(page: Page) {
  const text = await page.locator(".xterm-rows").innerText();
  return [...text.matchAll(/line-(\d{3})/g)].map((m) => Number(m[1]));
}
const topLine = async (page: Page) => (await visibleLines(page))[0];

const touch = (type: "touchStart" | "touchMove" | "touchEnd", point?: { x: number; y: number }) =>
  cdp.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ x: point.x, y: point.y }] : [] });

async function screen(page: Page) {
  return (await page.locator(".xterm-screen").boundingBox())!;
}

/** A finger drag. holdMs > 400 makes it a long press first. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, holdMs = 0) {
  await touch("touchStart", from);
  if (holdMs) await page.waitForTimeout(holdMs);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    await page.waitForTimeout(15);
  }
  await touch("touchEnd");
  await page.waitForTimeout(200);
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

// 복사 버튼과 토스트는 없어졌다. 선택 표시가 없고 클립보드가 그대로인지 본다.
async function expectNoSelection(page: Page) {
  await expect(page.locator(".xterm-selection div")).toHaveCount(0);
  expect(await clipboard(page)).toBe(CLIPBOARD_BEFORE);
}

test("바로 위로 끌면 이전 출력이 보이고, 아래로 끌면 돌아온다", async ({ page }) => {
  const box = await screen(page);
  const x = box.x + box.width / 2;
  const bottomTop = await topLine(page);
  expect(bottomTop).toBeGreaterThan(100);

  await drag(page, { x, y: box.y + box.height * 0.8 }, { x, y: box.y + box.height * 0.2 });
  const afterUp = await topLine(page);
  expect(afterUp, `finger up: top line ${bottomTop} -> ${afterUp}`).toBeLessThan(bottomTop);

  await drag(page, { x, y: box.y + box.height * 0.2 }, { x, y: box.y + box.height * 0.8 });
  expect(await topLine(page), "finger down returns").toBe(bottomTop);
});

test("바로 끌기는 한쪽으로 이전 출력, 반대로 되돌아오며, 그 동안 서버로 바이트가 없고 선택도 없다", async ({ page }) => {
  // 방향과 무관한 검사다. 방향은 위 테스트가 판정한다.
  const box = await screen(page);
  const x = box.x + box.width / 2;
  const up = { from: { x, y: box.y + box.height * 0.8 }, to: { x, y: box.y + box.height * 0.2 } };
  const down = { from: { x, y: box.y + box.height * 0.2 }, to: { x, y: box.y + box.height * 0.8 } };
  dummy.takeInputHex();
  const bottomTop = await topLine(page);

  let back = up;
  await drag(page, down.from, down.to);
  let earlier = await topLine(page);
  if (earlier === bottomTop) {
    await drag(page, up.from, up.to);
    earlier = await topLine(page);
    back = down;
  }
  test.info().annotations.push({
    type: "direction",
    description: `earlier output came with finger ${back === up ? "down" : "up"}: top line ${bottomTop} -> ${earlier}`,
  });
  expect(earlier, "a straight drag shows earlier output").toBeLessThan(bottomTop);
  await expect(page.locator(".xterm-rows")).toContainText(`line-${String(earlier).padStart(3, "0")}`);

  await drag(page, back.from, back.to);
  await drag(page, back.from, back.to);
  expect(await topLine(page), "the opposite drag returns to the end").toBe(bottomTop);

  await page.waitForTimeout(300);
  expect(dummy.inputHex()).toBe("");
  await expectNoSelection(page);
});

test("서버 앱이 마우스를 추적해도 바로 끌기는 마우스 보고를 보내지 않는다", async ({ page }) => {
  dummy.write("\x1b[?1000h\x1b[?1006h");
  await page.waitForTimeout(300);
  dummy.takeInputHex();
  const box = await screen(page);
  const x = box.x + box.width / 2;
  await drag(page, { x, y: box.y + box.height * 0.2 }, { x, y: box.y + box.height * 0.8 });
  await drag(page, { x, y: box.y + box.height * 0.8 }, { x, y: box.y + box.height * 0.2 });
  await page.waitForTimeout(300);
  expect(dummy.inputHex()).toBe("");
});

// '길게 누른 뒤 끌면 선택'은 새 조작법에서 '홀드 뒤 끌면 화살표'로 바뀌었다(touch-arrows.spec.ts).

test("길게 누른 뒤 화면 끝까지 크게 끌어도 스크롤로 바뀌지 않는다", async ({ page }) => {
  const box = await screen(page);
  const lines = await visibleLines(page);
  const x = box.x + box.width / 2;
  await drag(page, { x, y: box.y + box.height * 0.5 }, { x, y: box.y + box.height * 0.05 }, 700);
  expect(await visibleLines(page)).toEqual(lines);
  await drag(page, { x, y: box.y + box.height * 0.5 }, { x, y: box.y + box.height * 0.95 }, 700);
  expect(await visibleLines(page)).toEqual(lines);
});

test("이전 출력으로 스크롤한 뒤 길게 눌러 떼면 그 단어가 잡혀 복사된다", async ({ page }) => {
  const box = await screen(page);
  const x = box.x + box.width / 2;
  // 방향은 정해졌다: 손가락을 아래로 끌면 이전 출력. 끝에서 벗어난 상태에서 본다.
  const bottomTop = await topLine(page);
  await drag(page, { x, y: box.y + box.height * 0.2 }, { x, y: box.y + box.height * 0.9 });
  expect(await topLine(page)).toBeLessThan(bottomTop);
  const lines = await visibleLines(page);
  const rowHeight = box.height / dummy.size!.rows;
  const cellWidth = box.width / dummy.size!.cols;
  await touch("touchStart", { x: box.x + cellWidth * 2.5, y: box.y + rowHeight * 0.5 });
  await page.waitForTimeout(700);
  await touch("touchEnd");
  // 새 조작법: 제자리에서 떼는 순간 복사된다.
  await expect.poll(() => clipboard(page)).toBe(`line-${String(lines[0]).padStart(3, "0")}`);
  // 단어를 잡아도 스크롤 위치는 그대로다.
  expect(await visibleLines(page)).toEqual(lines);
});
