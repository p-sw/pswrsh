// 모바일: 0.4초 누른 뒤 끌면 화살표. 기준점은 누른 자리, 주축만 쓴다.
// 주축 24px 미만은 없음. 24px 넘으면 1회. 1단계(24~72px) 초당 4회, 2단계(72~140px) 초당 10회,
// 3단계(140px~) 초당 20회로 반복. 방향이 바뀌면 새 방향 1회 후 반복을 다시 시작. 24px 안으로 돌아오면 멈춤.
// 화살표 패널: data-stage(0~3), data-direction(보내는 방향, 1단계 전엔 빈 값), data-progress(다음 단계까지 %),
// 가리키는 칸의 arrow-progress가 그 비율만큼 차고, 꺾쇠 수는 단계 수(1단계 전에도 1개).
// 화살표는 xterm 입력이라 일반 모드는 CSI, 애플리케이션 커서 모드는 SS3.
import { expect, type Page, test } from "./support/fixtures";
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

test("주축 24px 미만(18px)으로만 움직이면 화살표를 보내지 않는다", async ({ page }) => {
  await finger.hold(origin, 600);
  for (const [dx, dy] of [
    [18, 0],
    [-18, 0],
    [0, 18],
    [0, -18],
    [18, 18],
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

test("경계: 22px에서는 보내지 않고, 26px로 넘기면 1회 보낸다", async ({ page }) => {
  await holdThenSlide(page, 22, 0);
  await page.waitForTimeout(600);
  expect(dummy.inputHex()).toBe("");
  await finger.glide(offset(26, 0), 2, 15);
  await finger.up();
  await page.waitForTimeout(600);
  expect(dummy.inputHex()).toBe("1b5b43");
});

for (const [name, dx, dy, arrow, csi] of [
  ["오른쪽", 30, 0, "right", "1b5b43"],
  ["왼쪽", -30, 0, "left", "1b5b44"],
  ["위", 0, -30, "up", "1b5b41"],
  ["아래", 0, 30, "down", "1b5b42"],
] as const) {
  test(`${name}으로 24px을 넘겨(30px) 바로 떼면 ${arrow} 화살표(${csi}) 정확히 1회`, async ({ page }) => {
    await holdThenSlide(page, dx, dy);
    await finger.up();
    await page.waitForTimeout(800);
    expect(dummy.inputHex()).toBe(csi);
  });
}

for (const [label, dx, dy, arrow, perSecond, min, max] of [
  // 2초 동안의 반복 수. 타이머 흔들림을 넣어 범위로 본다.
  ["1단계(24~72px, 45px)", 45, 0, "right", 4, 6, 10],
  ["2단계(72~140px, 100px)", 0, -100, "up", 10, 15, 25],
  ["3단계(140px~, 160px)", 160, 0, "right", 20, 30, 46],
] as const) {
  test(`${label}에 머물면 초당 약 ${perSecond}회로 반복한다`, async ({ page }) => {
    await holdThenSlide(page, dx, dy);
    const count = await countDuring(page, 500, 2500);
    await finger.up();
    expect(count, `${count} presses in 2s`).toBeGreaterThanOrEqual(min);
    expect(count, `${count} presses in 2s`).toBeLessThanOrEqual(max);
    expect(new Set(arrowsNow().arrows.map((a) => a.arrow))).toEqual(new Set([arrow]));
    expect(arrowsNow().other).toBe("");
  });
}

test("1단계에서 더 끌면 2단계, 3단계로 반복이 빨라진다", async ({ page }) => {
  await holdThenSlide(page, 45, 0);
  const stage1 = await countDuring(page, 400, 1400);
  await finger.glide(offset(100, 0), 3, 15);
  const stage2 = await countDuring(page, 200, 1200);
  await finger.glide(offset(160, 0), 3, 15);
  const stage3 = await countDuring(page, 200, 1200);
  await finger.up();
  expect(stage1, `stage1 ${stage1}/s`).toBeLessThanOrEqual(6);
  expect(stage2, `stage2 ${stage2}/s`).toBeGreaterThanOrEqual(7);
  expect(stage2, `stage2 ${stage2}/s`).toBeLessThanOrEqual(13);
  expect(stage3, `stage3 ${stage3}/s`).toBeGreaterThanOrEqual(15);
});

test("3단계에서 1단계 거리로 돌아오면 다시 초당 약 4회로 느려진다", async ({ page }) => {
  await holdThenSlide(page, 0, 160);
  await page.waitForTimeout(500);
  await finger.glide(offset(0, 45), 4, 15);
  const slow = await countDuring(page, 300, 1300);
  await finger.up();
  expect(slow, `slow ${slow}/s`).toBeGreaterThanOrEqual(2);
  expect(slow, `slow ${slow}/s`).toBeLessThanOrEqual(6);
});

for (const [label, dx, dy, arrow] of [
  ["가로가 크면 가로만", 40, 12, "right"],
  ["세로가 크면 세로만", 12, -40, "up"],
  ["대각선에 가까워도 큰 쪽만", -45, 36, "left"],
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
  await holdThenSlide(page, 45, 0);
  await page.waitForTimeout(700);
  const rightsBefore = arrowsNow().arrows.filter((a) => a.arrow === "right").length;
  expect(rightsBefore).toBeGreaterThan(0);

  await finger.glide(offset(-45, 0), 4, 10);
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

// ── 반복 간격·축 유지 (fix-connection-reuse-review 5804986 동작. 61edb19에서는 실패할 수 있음 → 앱 변경 대기) ──

/** Arrival times (ms) of each arrow press, in order. */
function arrowTimes() {
  const times: { at: number; arrow: Arrow }[] = [];
  for (const { at, hex } of dummy.inputLog) for (const a of parse(hex).arrows) times.push({ at, arrow: a.arrow });
  return times;
}

/** Waits for the first arrow press after index `before` (default: presses so far) and returns its arrival time. */
async function nextPress(before = arrowTimes().length) {
  await expect.poll(() => arrowTimes().length, { intervals: [5], timeout: 2000 }).toBeGreaterThan(before);
  return arrowTimes()[before].at;
}

test("2단계에서 1단계로 바뀌면 다음 전송은 마지막 전송 250ms 뒤다(2단계 100ms 간격으로 한 번 더 나가지 않는다)", async ({ page }) => {
  await holdThenSlide(page, 100, 0);
  await page.waitForTimeout(500);
  const last = await nextPress();
  const seen = arrowTimes().length;
  await page.waitForTimeout(20);
  await finger.glide(offset(45, 0), 1, 0);
  const moved = Date.now();
  const next = await nextPress(seen);
  await finger.up();
  expect(moved - last, "moved to stage 1 before the next stage-2 press was due").toBeLessThan(80);
  expect(next - last, `gap ${next - last}ms`).toBeGreaterThanOrEqual(210);
  expect(next - last, `gap ${next - last}ms`).toBeLessThanOrEqual(300);
});

test("[앱 변경 대기] 1단계에서 2단계로 바뀔 때 마지막 전송 뒤 100ms가 이미 지났으면 곧바로 보낸다(250ms를 새로 세지 않는다)", async ({ page }) => {
  await holdThenSlide(page, 45, 0);
  await page.waitForTimeout(300);
  const last = await nextPress();
  const seen = arrowTimes().length;
  await page.waitForTimeout(140);
  await finger.glide(offset(100, 0), 1, 0);
  const moved = Date.now();
  const next = await nextPress(seen);
  await finger.up();
  expect(moved - last, "moved to stage 2 before the next stage-1 press was due").toBeLessThan(220);
  // 이어서 세면 last+100이 이미 지났으니 옮긴 직후. 새로 세거나 1단계 타이머를 기다리면 last+250 이후.
  expect(next - moved, `sent ${next - moved}ms after the move (gap ${next - last}ms)`).toBeLessThanOrEqual(60);
});

test("[앱 변경 대기] 24px 안으로 돌아왔다 250ms 안에 같은 방향으로 다시 나가면 곧바로 보내지 않고 직전 전송 250ms 뒤에 보낸다", async ({ page }) => {
  await holdThenSlide(page, 45, 0);
  await page.waitForTimeout(300);
  const last = await nextPress();
  const seen = arrowTimes().length;
  await finger.glide(offset(15, 0), 1, 20);
  await finger.glide(offset(45, 0), 1, 20);
  const back = Date.now();
  const next = await nextPress(seen);
  await finger.up();
  expect(back - last, "re-exited within 250ms of the last press").toBeLessThan(200);
  expect(next - last, `gap ${next - last}ms`).toBeGreaterThanOrEqual(220);
  expect(next - last, `gap ${next - last}ms`).toBeLessThanOrEqual(310);
});

test("[앱 변경 대기] 대각선 근처에서는 기존 축을 유지한다: 오른쪽 45px에서 세로 50px(1.2배 미만)이면 계속 오른쪽", async ({ page }) => {
  await holdThenSlide(page, 45, 0);
  await page.waitForTimeout(400);
  await finger.glide(offset(45, 50), 4, 15);
  await page.waitForTimeout(800);
  await finger.up();
  const { arrows } = arrowsNow();
  expect(arrows.length).toBeGreaterThan(0);
  expect(new Set(arrows.map((a) => a.arrow))).toEqual(new Set(["right"]));
});

test("대각선에서 다른 축이 1.2배를 넘으면(45px 대 60px) 그 축으로 바꾼다", async ({ page }) => {
  await holdThenSlide(page, 45, 0);
  await page.waitForTimeout(400);
  await finger.glide(offset(45, 60), 4, 15);
  await page.waitForTimeout(150);
  const firstDown = arrowsNow().arrows.findIndex((a) => a.arrow === "down");
  expect(firstDown, "a down arrow soon after crossing 1.2x").toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(800);
  await finger.up();
  const { arrows } = arrowsNow();
  expect(arrows.slice(firstDown).every((a) => a.arrow === "down"), "only down after the switch").toBe(true);
});

test("24px 안으로(15px) 돌아오면 멈춘다", async ({ page }) => {
  await holdThenSlide(page, 0, 100);
  await page.waitForTimeout(600);
  await finger.glide(offset(0, 15), 4, 10);
  await page.waitForTimeout(150);
  const frozen = arrowsNow().arrows.length;
  expect(frozen).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(arrowsNow().arrows.length).toBe(frozen);
  await finger.up();
});

test("떼면 반복이 멈춘다", async ({ page }) => {
  await holdThenSlide(page, 100, 0);
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
    [30, 0, "1b4f43"],
    [-30, 0, "1b4f44"],
    [0, -30, "1b4f41"],
    [0, 30, "1b4f42"],
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
  await holdThenSlide(page, 30, 0);
  await finger.up();
  await page.waitForTimeout(500);
  expect(dummy.inputHex()).toBe("1b5b43");
});

test("홀드 끌기는 스크롤하지 않고, 선택도 복사도 하지 않는다", async ({ page }) => {
  // 끝에 있을 때 손가락을 아래로 끌면 스크롤로는 이전 출력이 나온다. 홀드 뒤에는 그러면 안 된다.
  // (화살표는 입력이라 xterm이 끝으로 붙인다. 그래서 끝에서 시작한다.)
  const rows = await page.locator(".xterm-rows").innerText();
  await holdThenSlide(page, 0, 100);
  await page.waitForTimeout(600);
  await finger.glide(offset(0, 160), 6, 15);
  await page.waitForTimeout(600);
  await finger.up();
  await page.waitForTimeout(400);

  expect(await page.locator(".xterm-rows").innerText()).toBe(rows);
  await expect(selectionCells(page)).toHaveCount(0);
  expect(await readClipboard(page)).toBe(CLIPBOARD_BEFORE);
  expect(arrowsNow().arrows.length).toBeGreaterThan(0);
});

test("홀드 화살표 뒤에도 키보드 글자는 그대로 나간다", async ({ page }) => {
  await holdThenSlide(page, 30, 0);
  await finger.up();
  await expect.poll(() => dummy.inputHex()).toBe("1b5b43");
  dummy.takeInputHex();
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("x");
  await expect.poll(() => dummy.inputHex()).toBe("78");
});

test.describe("화살표 패널", () => {
  const panel = (page: Page) => page.getByTestId("arrow-panel");
  /** The cell the finger points at: the one holding the progress fill. */
  const pointedCell = (page: Page) => panel(page).locator("div:has(> [data-testid=arrow-progress])");

  test("홀드 뒤 아주 조금(2px)만 움직이면 패널이 뜨지 않는다", async ({ page }) => {
    await holdThenSlide(page, 2, 0);
    await page.waitForTimeout(300);
    await expect(panel(page)).toHaveCount(0);
    await finger.up();
  });

  for (const [label, dx, dy, pointing, stage, progress, chevrons] of [
    // 1단계 전: 아직 보내지 않지만 1단계까지의 진행도(18/24=75%)를 보여 준다.
    // (headless Chromium은 터치 시작 뒤 첫 약 15px 이동을 페이지에 넘기지 않아 그보다 큰 거리로 본다.)
    ["1단계 전(18px)", 18, 0, "right", 0, 75, 1],
    // 1단계: (48-24)/(72-24)=50%.
    ["1단계(48px)", 48, 0, "right", 1, 50, 1],
    // 2단계: (106-72)/(140-72)=50%.
    ["2단계(106px)", -106, 0, "left", 2, 50, 2],
    // 3단계: 마지막 단계라 100%로 꽉 찬다.
    ["3단계(160px)", 160, 0, "right", 3, 100, 3],
  ] as const) {
    test(`${label}: data-stage=${stage}, data-progress=${progress}, 꺾쇠 ${chevrons}개`, async ({ page }) => {
      await holdThenSlide(page, dx, dy);
      const p = panel(page);
      await expect(p).toBeVisible();
      await expect(p).toHaveAttribute("data-stage", String(stage));
      await expect(p).toHaveAttribute("data-pointing", pointing);
      await expect(p).toHaveAttribute("data-direction", stage === 0 ? "" : pointing);
      await expect(p).toHaveAttribute("data-progress", String(progress));
      await expect(p.getByTestId("arrow-progress")).toHaveCount(1);
      await expect(p.getByTestId("arrow-progress")).toHaveAttribute("style", new RegExp(`width:\\s*${progress}%`));
      await expect(pointedCell(page).locator("[data-chevrons]")).toHaveAttribute("data-chevrons", String(chevrons));
      // 가리키지 않는 칸은 꺾쇠 하나.
      const counts = await p.locator("[data-chevrons]").evaluateAll((els) => els.map((e) => e.getAttribute("data-chevrons")));
      expect(counts.filter((n) => n !== "1").length).toBe(chevrons === 1 ? 0 : 1);
      await finger.up();
    });
  }

  test("세로 방향이면 진행도가 높이로 찬다: 위로 48px이면 height 50%", async ({ page }) => {
    await holdThenSlide(page, 0, -48);
    const p = panel(page);
    await expect(p).toHaveAttribute("data-direction", "up");
    await expect(p).toHaveAttribute("data-stage", "1");
    await expect(p.getByTestId("arrow-progress")).toHaveAttribute("style", /height:\s*50%/);
    await finger.up();
  });

  test("보내는 칸만 data-active=true이고 1단계 전에는 어느 칸도 active가 아니다", async ({ page }) => {
    await holdThenSlide(page, 0, 18);
    const p = panel(page);
    await expect(p).toHaveAttribute("data-pointing", "down");
    await expect(p.locator("[data-active=true]")).toHaveCount(0);
    await finger.glide(offset(0, 48), 3, 15);
    await expect(p).toHaveAttribute("data-direction", "down");
    await expect(p.locator("[data-active=true]")).toHaveCount(1);
    await expect(p.locator("[data-active=true]")).toHaveAttribute("data-stage", "1");
    await finger.up();
  });

  test("끄는 동안 진행도가 거리에 따라 늘었다 줄어든다", async ({ page }) => {
    await holdThenSlide(page, 36, 0); // (36-24)/48 = 25%
    const p = panel(page);
    await expect(p).toHaveAttribute("data-progress", "25");
    await finger.glide(offset(60, 0), 2, 15); // 75%
    await expect(p).toHaveAttribute("data-progress", "75");
    await finger.glide(offset(30, 0), 2, 15); // 12.5% -> 13
    await expect(p).toHaveAttribute("data-progress", "13");
    await expect(p).toHaveAttribute("data-stage", "1");
    await finger.up();
  });

  test("24px 안으로 돌아오면 data-stage=0, data-direction이 비고 진행도는 1단계까지로 돌아간다", async ({ page }) => {
    await holdThenSlide(page, 100, 0);
    const p = panel(page);
    await expect(p).toHaveAttribute("data-stage", "2");
    await finger.glide(offset(6, 0), 4, 10); // 6/24 = 25%
    await expect(p).toHaveAttribute("data-stage", "0");
    await expect(p).toHaveAttribute("data-direction", "");
    await expect(p).toHaveAttribute("data-progress", "25");
    await finger.up();
  });

  test("떼면 패널이 사라진다", async ({ page }) => {
    await holdThenSlide(page, 48, 0);
    await expect(panel(page)).toBeVisible();
    await finger.up();
    await expect(panel(page)).toHaveCount(0);
  });
});
