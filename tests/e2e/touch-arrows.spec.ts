// 모바일: 0.4초 누른 뒤 끌면 화살표. 기준점은 누른 자리, 주축만 쓴다.
// 주축 12px 미만은 없음. 12px 넘으면 1회. 12~40px은 초당 4회, 40px 넘으면 초당 15회로 반복.
// 방향이 바뀌면 새 방향 1회 후 반복을 다시 시작. 12px 안으로 돌아오면 멈춤.
// 화살표는 xterm 입력이라 일반 모드는 CSI, 애플리케이션 커서 모드는 SS3.
import { expect, type Page, test } from "@playwright/test";
import { acceptFirstKey, addHost, createVault, openHost } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD } from "./support/secrets";
import { Finger, type Point, readClipboard, selectionCells } from "./support/touch";

const CLIPBOARD_BEFORE = "clipboard-before-arrows";
const OUTPUT = Array.from({ length: 200 }, (_, i) => `row-${String(i).padStart(3, "0")} alpha bravo`).join("\r\n");

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  permissions: ["clipboard-read", "clipboard-write"],
});

type Arrow = "up" | "down" | "right" | "left";
const FINAL: Record<string, Arrow> = { "41": "up", "42": "down", "43": "right", "44": "left" };

/** Splits server input into arrow presses. Anything else in the input is returned as `other`. */
function parse(hex: string) {
  const arrows: { arrow: Arrow; form: "CSI" | "SS3" }[] = [];
  const other = hex.replace(/1b(5b|4f)(4[1-4])/g, (_, intro: string, final: string) => {
    arrows.push({ arrow: FINAL[final], form: intro === "5b" ? "CSI" : "SS3" });
    return "";
  });
  return { arrows, other };
}

let dummy: DummySsh;
let finger: Finger;
let origin: Point;

test.beforeEach(async ({ page }) => {
  dummy = await new DummySsh({ shellOutput: OUTPUT }).start();
  finger = await Finger.on(page);
  await createVault(page);
  await addHost(page, { name: "arrows", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await openHost(page, "arrows");
  await acceptFirstKey(page);
  await expect.poll(() => dummy.shells).toBe(1);
  await expect(page.locator(".xterm-rows")).toContainText("row-199");
  await page.evaluate((text) => navigator.clipboard.writeText(text), CLIPBOARD_BEFORE);
  const box = (await page.locator(".xterm-screen").boundingBox())!;
  origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  dummy.takeInputHex();
});

test.afterEach(async () => {
  await finger.detach();
  await dummy.stop();
});

const offset = (dx: number, dy: number): Point => ({ x: origin.x + dx, y: origin.y + dy });
const arrowsNow = () => parse(dummy.inputHex());

/** Holds 0.4s+ at the origin, then slides to the offset quickly (about 60ms). */
async function holdThenSlide(page: Page, dx: number, dy: number) {
  await finger.hold(origin, 600);
  await finger.glide(offset(dx, dy), 4, 15);
}

/** Arrow presses the server got during [fromMs, toMs) after now, while the finger stays put. */
async function countDuring(page: Page, fromMs: number, toMs: number) {
  await page.waitForTimeout(fromMs);
  const start = arrowsNow().arrows.length;
  await page.waitForTimeout(toMs - fromMs);
  return arrowsNow().arrows.length - start;
}

test("주축 12px 미만으로만 움직이면 화살표를 보내지 않는다", async ({ page }) => {
  await finger.hold(origin, 600);
  for (const [dx, dy] of [
    [8, 0],
    [-8, 0],
    [0, 8],
    [0, -8],
    [8, 8],
  ]) {
    await finger.glide(offset(dx, dy), 3, 15);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(600);
  // 누른 채로 있는 동안에는 아무것도 나가지 않는다.
  expect(dummy.inputHex()).toBe("");
  await finger.up();
  await page.waitForTimeout(300);
  // 뗀 뒤의 동작(단어 복사, 빈 칸이면 붙여넣기)은 touch-select/touch-paste가 본다. 여기서는 화살표가 없는지만 본다.
  expect(arrowsNow().arrows).toEqual([]);
});

for (const [name, dx, dy, arrow, csi] of [
  ["오른쪽", 20, 0, "right", "1b5b43"],
  ["왼쪽", -20, 0, "left", "1b5b44"],
  ["위", 0, -20, "up", "1b5b41"],
  ["아래", 0, 20, "down", "1b5b42"],
] as const) {
  test(`${name}으로 12px을 넘겨 바로 떼면 ${arrow} 화살표(${csi}) 정확히 1회`, async ({ page }) => {
    await holdThenSlide(page, dx, dy);
    await finger.up();
    await page.waitForTimeout(800);
    expect(dummy.inputHex()).toBe(csi);
  });
}

test("12~40px(25px)에 머물면 초당 약 4회로 반복한다", async ({ page }) => {
  await holdThenSlide(page, 25, 0);
  const count = await countDuring(page, 500, 2500);
  await finger.up();
  // 2초 동안 4회/초면 8회. 타이머 흔들림을 넣어 3~5회/초로 본다.
  expect(count, `${count} presses in 2s`).toBeGreaterThanOrEqual(6);
  expect(count, `${count} presses in 2s`).toBeLessThanOrEqual(10);
  expect(new Set(arrowsNow().arrows.map((a) => a.arrow))).toEqual(new Set(["right"]));
  expect(arrowsNow().other).toBe("");
});

test("40px을 넘기면(60px) 초당 약 15회로 반복한다", async ({ page }) => {
  await holdThenSlide(page, 0, -60);
  const count = await countDuring(page, 500, 2500);
  await finger.up();
  // 2초 동안 15회/초면 30회. 11~19회/초로 본다.
  expect(count, `${count} presses in 2s`).toBeGreaterThanOrEqual(22);
  expect(count, `${count} presses in 2s`).toBeLessThanOrEqual(38);
  expect(new Set(arrowsNow().arrows.map((a) => a.arrow))).toEqual(new Set(["up"]));
  expect(arrowsNow().other).toBe("");
});

test("느린 구간에서 40px을 넘기면 빠른 반복으로 바뀐다", async ({ page }) => {
  await holdThenSlide(page, 25, 0);
  const slow = await countDuring(page, 400, 1400);
  await finger.glide(offset(60, 0), 3, 15);
  const fast = await countDuring(page, 200, 1200);
  await finger.up();
  expect(slow, `slow ${slow}/s`).toBeLessThanOrEqual(6);
  expect(fast, `fast ${fast}/s`).toBeGreaterThanOrEqual(11);
});

for (const [label, dx, dy, arrow] of [
  ["가로가 크면 가로만", 30, 10, "right"],
  ["세로가 크면 세로만", 10, -30, "up"],
  ["대각선에 가까워도 큰 쪽만", -35, 28, "left"],
] as const) {
  test(`주축만 쓴다: ${label}`, async ({ page }) => {
    await holdThenSlide(page, dx, dy);
    await page.waitForTimeout(1200);
    await finger.up();
    const { arrows, other } = arrowsNow();
    expect(arrows.length).toBeGreaterThan(0);
    expect(new Set(arrows.map((a) => a.arrow))).toEqual(new Set([arrow]));
    expect(other).toBe("");
  });
}

test("방향이 바뀌면 새 방향으로 곧바로 1회 보내고, 이전 방향은 더 보내지 않으며, 반복을 다시 시작한다", async ({ page }) => {
  await holdThenSlide(page, 25, 0);
  await page.waitForTimeout(700);
  const rightsBefore = arrowsNow().arrows.filter((a) => a.arrow === "right").length;
  expect(rightsBefore).toBeGreaterThan(0);

  await finger.glide(offset(-25, 0), 4, 10);
  // "1회 후 반복 재시작": 다음 반복 주기(250ms)를 기다리지 않고 나간다.
  await page.waitForTimeout(150);
  const afterSwitch = arrowsNow().arrows;
  const firstLeft = afterSwitch.findIndex((a) => a.arrow === "left");
  expect(firstLeft, "a left arrow within 150ms of the switch").toBeGreaterThanOrEqual(0);

  await page.waitForTimeout(1200);
  await finger.up();
  const all = arrowsNow().arrows;
  const lefts = all.slice(firstLeft);
  expect(lefts.every((a) => a.arrow === "left"), "no right arrow after the switch").toBe(true);
  // 1회 + 1.2초 동안 4회/초 반복.
  expect(lefts.length).toBeGreaterThanOrEqual(4);
  expect(all.slice(0, firstLeft).every((a) => a.arrow === "right")).toBe(true);
});

test("12px 안으로 돌아오면 멈춘다", async ({ page }) => {
  await holdThenSlide(page, 0, 60);
  await page.waitForTimeout(600);
  await finger.glide(offset(0, 5), 4, 10);
  await page.waitForTimeout(150);
  const frozen = arrowsNow().arrows.length;
  expect(frozen).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(arrowsNow().arrows.length).toBe(frozen);
  await finger.up();
});

test("떼면 반복이 멈춘다", async ({ page }) => {
  await holdThenSlide(page, 60, 0);
  await page.waitForTimeout(500);
  await finger.up();
  await page.waitForTimeout(150);
  const frozen = arrowsNow().arrows.length;
  await page.waitForTimeout(1000);
  expect(arrowsNow().arrows.length).toBe(frozen);
});

test("애플리케이션 커서 모드면 SS3, 끄면 다시 CSI", async ({ page }) => {
  dummy.write("\x1b[?1hAPPMODE-ON\r\n");
  await expect(page.locator(".xterm-rows")).toContainText("APPMODE-ON");
  for (const [dx, dy, ss3] of [
    [20, 0, "1b4f43"],
    [-20, 0, "1b4f44"],
    [0, -20, "1b4f41"],
    [0, 20, "1b4f42"],
  ] as const) {
    dummy.takeInputHex();
    await holdThenSlide(page, dx, dy);
    await finger.up();
    await page.waitForTimeout(500);
    expect(dummy.inputHex()).toBe(ss3);
  }
  dummy.write("\x1b[?1lAPPMODE-OFF\r\n");
  await expect(page.locator(".xterm-rows")).toContainText("APPMODE-OFF");
  dummy.takeInputHex();
  await holdThenSlide(page, 20, 0);
  await finger.up();
  await page.waitForTimeout(500);
  expect(dummy.inputHex()).toBe("1b5b43");
});

test("홀드 끌기는 스크롤하지 않고, 선택도 복사도 하지 않는다", async ({ page }) => {
  // 끝에 있을 때 손가락을 아래로 끌면 스크롤로는 이전 출력이 나온다. 홀드 뒤에는 그러면 안 된다.
  // (화살표는 입력이라 xterm이 끝으로 붙인다. 그래서 끝에서 시작한다.)
  const rows = await page.locator(".xterm-rows").innerText();
  await holdThenSlide(page, 0, 60);
  await page.waitForTimeout(600);
  await finger.glide(offset(0, 150), 6, 15);
  await page.waitForTimeout(600);
  await finger.up();
  await page.waitForTimeout(400);

  expect(await page.locator(".xterm-rows").innerText()).toBe(rows);
  await expect(selectionCells(page)).toHaveCount(0);
  expect(await readClipboard(page)).toBe(CLIPBOARD_BEFORE);
  expect(arrowsNow().arrows.length).toBeGreaterThan(0);
});

test("홀드 화살표 뒤에도 키보드 글자는 그대로 나간다", async ({ page }) => {
  await holdThenSlide(page, 20, 0);
  await finger.up();
  await expect.poll(() => dummy.inputHex()).toBe("1b5b43");
  dummy.takeInputHex();
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("x");
  await expect.poll(() => dummy.inputHex()).toBe("78");
});
