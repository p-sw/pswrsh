// 모바일: 터미널을 0.3초 안에 24px 안에서 두 번 짧게 치면 Tab(09) 1회. 세 번째 탭은 새 첫 탭이다.
// 첫 탭 대기는 꾹 누름, 스크롤, 두 손가락, 터치 취소에서 초기화된다. 두 번째 탭은 xterm에 클릭으로 가지 않는다.
// 터미널은 touch-action: manipulation(iOS 더블탭 확대 방지).
// 햅틱: navigator.vibrate가 있으면 10ms 호출. 없으면(iOS) 숨긴 <input type=checkbox switch>의 label을 누른다.
//  - 화살표(제스처 밖에서 나감): 텍스트 입력에 포커스가 있으면 switch를 누르지 않는다.
//  - 더블탭 Tab, 키바 Tab(제스처 안): 포커스와 무관하게 누른다.
//  - readOnly/disabled 입력은 텍스트 입력이 아니다.
//  - 키바에서는 Tab만 햅틱. Esc, Ctrl은 없다.
import { expect, type Page, test } from "./support/fixtures";
import { acceptFirstKey, addHost, createVault, openHost } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD } from "./support/secrets";
import { Finger, type Point, selectionCells } from "./support/touch";

const OUTPUT = Array.from({ length: 200 }, (_, i) => `row-${String(i).padStart(3, "0")} alpha bravo`).join("\r\n");
const TAB = "09";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  permissions: ["clipboard-read", "clipboard-write"],
});

let dummy: DummySsh;
let finger: Finger;
let origin: Point;

type HapticMode = "vibrate" | "switch";

/** Records haptics before the app loads: vibrate calls, or clicks reaching the hidden switch. */
async function recordHaptics(page: Page, mode: HapticMode) {
  await page.addInitScript((m) => {
    const w = window as unknown as { __vibrate: number[]; __switch: number };
    w.__vibrate = [];
    w.__switch = 0;
    if (m === "vibrate") {
      Object.defineProperty(Navigator.prototype, "vibrate", {
        configurable: true,
        value: (ms: number) => {
          w.__vibrate.push(ms);
          return true;
        },
      });
    } else {
      delete (Navigator.prototype as { vibrate?: unknown }).vibrate;
      document.addEventListener(
        "click",
        (event) => {
          const target = event.target;
          if (target instanceof HTMLInputElement && target.hasAttribute("switch")) w.__switch++;
        },
        true,
      );
    }
  }, mode);
}

const vibrateCalls = (page: Page) => page.evaluate(() => (window as unknown as { __vibrate: number[] }).__vibrate);
const switchClicks = (page: Page) => page.evaluate(() => (window as unknown as { __switch: number }).__switch);

async function openTerminal(page: Page) {
  dummy = await new DummySsh({ shellOutput: OUTPUT }).start();
  finger = await Finger.on(page);
  await createVault(page);
  await addHost(page, { name: "tabs", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await openHost(page, "tabs");
  await acceptFirstKey(page);
  await expect.poll(() => dummy.shells).toBe(1);
  await expect(page.locator(".xterm-rows")).toContainText("row-199");
  const box = (await page.locator(".xterm-screen").boundingBox())!;
  origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  dummy.takeInputHex();
}

test.afterEach(async () => {
  await finger?.detach();
  await dummy?.stop();
});

const at = (dx: number, dy = 0): Point => ({ x: origin.x + dx, y: origin.y + dy });

/** A short tap: down and up with no move. */
async function tap(point: Point) {
  await finger.down(point);
  await finger.up();
}

/** Counts Tab bytes in what the server got, after a short settle. */
async function tabsSent(page: Page) {
  await page.waitForTimeout(300);
  return (dummy.inputHex().match(/09/g) ?? []).length;
}

test.describe("더블탭 Tab", () => {
  test.beforeEach(async ({ page }) => {
    await openTerminal(page);
  });

  test("터미널은 touch-action: manipulation 이다", async ({ page }) => {
    await expect(page.locator(".pswrsh-terminal").first()).toHaveCSS("touch-action", "manipulation");
  });

  test("같은 자리를 빠르게 두 번 치면 Tab(09)을 정확히 1회 보낸다", async ({ page }) => {
    await tap(origin);
    await page.waitForTimeout(100);
    await tap(origin);
    expect(await tabsSent(page)).toBe(1);
    expect(dummy.inputHex()).toBe(TAB);
  });

  test("한 번만 치면 Tab을 보내지 않는다", async ({ page }) => {
    await tap(origin);
    expect(await tabsSent(page)).toBe(0);
  });

  test("두 번째 탭이 20px 떨어져도(24px 안) Tab을 보낸다", async ({ page }) => {
    await tap(origin);
    await page.waitForTimeout(80);
    await tap(at(20));
    expect(await tabsSent(page)).toBe(1);
  });

  test("두 번째 탭이 40px 떨어지면(24px 밖) Tab을 보내지 않는다", async ({ page }) => {
    await tap(origin);
    await page.waitForTimeout(80);
    await tap(at(40));
    expect(await tabsSent(page)).toBe(0);
  });

  test("두 번째 탭이 0.5초 뒤면(0.3초 밖) Tab을 보내지 않는다", async ({ page }) => {
    await tap(origin);
    await page.waitForTimeout(500);
    await tap(origin);
    expect(await tabsSent(page)).toBe(0);
  });

  test("세 번 연달아 치면 Tab은 1회, 네 번이면 2회다(세 번째 탭은 새 첫 탭)", async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await tap(origin);
      await page.waitForTimeout(80);
    }
    expect(await tabsSent(page)).toBe(1);
    dummy.takeInputHex();
    await page.waitForTimeout(400);
    for (let i = 0; i < 4; i++) {
      await tap(origin);
      await page.waitForTimeout(80);
    }
    expect(await tabsSent(page)).toBe(2);
  });

  test("두 번째 탭은 단어 선택을 남기지 않는다(xterm 더블클릭이 아님)", async ({ page }) => {
    await tap(origin);
    await page.waitForTimeout(80);
    await tap(origin);
    expect(await tabsSent(page)).toBe(1);
    await expect(selectionCells(page)).toHaveCount(0);
  });

  test("탭 뒤 꾹 눌렀다 떼고 바로 탭하면 Tab을 보내지 않는다(꾹 누름이 초기화)", async ({ page }) => {
    await tap(origin);
    await finger.hold(origin, 600);
    await finger.up();
    await tap(origin);
    expect(await tabsSent(page)).toBe(0);
  });

  test("탭 뒤 스크롤하고 바로 탭하면 Tab을 보내지 않는다(스크롤이 초기화)", async ({ page }) => {
    await tap(origin);
    await finger.down(origin);
    await finger.glide(at(0, 150), 6, 10);
    await finger.up();
    await tap(origin);
    expect(await tabsSent(page)).toBe(0);
  });

  test("탭 뒤 꾹 눌러 화살표를 보내고 바로 탭하면 Tab을 보내지 않는다", async ({ page }) => {
    await tap(origin);
    await finger.hold(origin, 600);
    await finger.glide(at(40), 4, 15);
    await finger.up();
    await page.waitForTimeout(100);
    expect(dummy.inputHex()).toContain("1b5b43");
    await tap(origin);
    expect(await tabsSent(page)).toBe(0);
  });

  test("두 번째 탭이 터치 취소로 끝나면 Tab을 보내지 않고, 다음 탭도 새 첫 탭이다", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    try {
      await tap(origin);
      await page.waitForTimeout(80);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [origin] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await page.waitForTimeout(50);
      await tap(origin);
      expect(await tabsSent(page)).toBe(0);
    } finally {
      await cdp.detach().catch(() => {});
    }
  });
});

test.describe("햅틱: vibrate가 있을 때", () => {
  test.beforeEach(async ({ page }) => {
    await recordHaptics(page, "vibrate");
    await openTerminal(page);
  });

  test("더블탭 Tab에 vibrate(10)을 1회 부른다", async ({ page }) => {
    await tap(origin);
    await page.waitForTimeout(80);
    await tap(origin);
    expect(await tabsSent(page)).toBe(1);
    expect(await vibrateCalls(page)).toEqual([10]);
  });

  test("화살표를 보낼 때마다 vibrate를 부른다", async ({ page }) => {
    await finger.hold(origin, 600);
    await finger.glide(at(40), 4, 15);
    await finger.up();
    await page.waitForTimeout(300);
    const arrows = (dummy.inputHex().match(/1b5b43/g) ?? []).length;
    expect(arrows).toBeGreaterThan(0);
    expect((await vibrateCalls(page)).length).toBe(arrows);
  });

  test("한 번 탭만 하면 vibrate를 부르지 않는다", async ({ page }) => {
    await tap(origin);
    await page.waitForTimeout(400);
    expect(await vibrateCalls(page)).toEqual([]);
  });

  test("키바는 Tab만 vibrate를 부르고 Esc·Ctrl은 부르지 않는다", async ({ page }) => {
    const bar = page.getByRole("toolbar", { name: "특수키" });
    await bar.getByRole("button", { name: "Esc" }).click();
    await bar.getByRole("button", { name: "Ctrl" }).click();
    await bar.getByRole("button", { name: "Ctrl" }).click();
    expect(await vibrateCalls(page)).toEqual([]);
    await bar.getByRole("button", { name: "Tab" }).click();
    await expect.poll(() => dummy.inputHex()).toContain(TAB);
    expect(await vibrateCalls(page)).toEqual([10]);
  });
});

test.describe("햅틱: vibrate가 없을 때(숨긴 switch)", () => {
  test.beforeEach(async ({ page }) => {
    await recordHaptics(page, "switch");
    await openTerminal(page);
  });

  const focusTerminal = (page: Page) => page.locator(".xterm-helper-textarea:visible").focus();
  const activeIsTerminal = (page: Page) =>
    page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea") ?? false);

  async function arrowOnce() {
    await finger.hold(origin, 600);
    await finger.glide(at(30), 3, 15);
    await finger.up();
  }

  test("터미널 입력에 포커스가 있으면 화살표에는 switch를 누르지 않는다", async ({ page }) => {
    await focusTerminal(page);
    await arrowOnce();
    await expect.poll(() => dummy.inputHex()).toBe("1b5b43");
    expect(await switchClicks(page)).toBe(0);
    expect(await activeIsTerminal(page)).toBe(true);
  });

  test("텍스트 입력에 포커스가 없으면 화살표에도 switch를 누른다", async ({ page }) => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await arrowOnce();
    await expect.poll(() => dummy.inputHex()).toBe("1b5b43");
    expect(await switchClicks(page)).toBe(1);
    // 숨긴 switch에 포커스를 남기지 않는다.
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.hasAttribute("switch") ?? false)).toBe(false);
  });

  for (const flag of ["readOnly", "disabled"] as const) {
    test(`포커스된 입력이 ${flag}이면 텍스트 입력이 아니라서 화살표에도 switch를 누른다`, async ({ page }) => {
      await page.evaluate((f) => {
        const input = document.createElement("input");
        input.type = "text";
        input.id = "probe";
        document.body.appendChild(input);
        input.focus();
        // disabled는 포커스를 잃으므로 activeElement를 고정해 판정만 본다.
        if (f === "readOnly") input.readOnly = true;
        else {
          input.disabled = true;
          Object.defineProperty(document, "activeElement", { configurable: true, get: () => input });
        }
      }, flag);
      await arrowOnce();
      await expect.poll(() => dummy.inputHex()).toBe("1b5b43");
      expect(await switchClicks(page)).toBe(1);
    });
  }

  test("더블탭 Tab은 터미널 입력에 포커스가 있어도 switch를 누르고 포커스를 지킨다", async ({ page }) => {
    await focusTerminal(page);
    await tap(origin);
    await page.waitForTimeout(80);
    await tap(origin);
    expect(await tabsSent(page)).toBe(1);
    expect(await switchClicks(page)).toBe(1);
    expect(await activeIsTerminal(page)).toBe(true);
  });

  test("키바 Tab은 터미널 입력에 포커스가 있어도 switch를 누르고, Esc는 누르지 않는다", async ({ page }) => {
    await focusTerminal(page);
    const bar = page.getByRole("toolbar", { name: "특수키" });
    await bar.getByRole("button", { name: "Esc" }).click();
    await expect.poll(() => dummy.inputHex()).toBe("1b");
    expect(await switchClicks(page)).toBe(0);
    await bar.getByRole("button", { name: "Tab" }).click();
    await expect.poll(() => dummy.inputHex()).toBe("1b" + TAB);
    expect(await switchClicks(page)).toBe(1);
    expect(await activeIsTerminal(page)).toBe(true);
  });
});
