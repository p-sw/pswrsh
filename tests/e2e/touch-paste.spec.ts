// 모바일 붙여넣기와 토스트.
// 0.4초 누른 뒤 글자 없는 빈 칸(비었거나 공백인 셀)에서 제자리에서 떼면 클립보드 내용이 서버로 한 번 간다.
// 글자 위에서 떼면 단어 선택과 자동 복사. 클립보드 읽기가 거절되면 오류 토스트 한 번.
// 손 뗄 때 기준(2026-11-07 신우님 결정): 누른 뒤 시작점에서 12px 넘게 움직인 적이 있으면(최대 이동 거리)
// 떼도 복사·붙여넣기 하지 않는다. 12px 이하이고 화살표를 보내지 않았으면 복사·붙여넣기 한다.
// 복사 성공 토스트는 없다. 복사 실패 토스트는 있다.
import { expect, type Page, test } from "./support/fixtures";
import { acceptFirstKey, addHost, createVault, openHost } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD } from "./support/secrets";
import { cell, Finger, readClipboard, selectionCells } from "./support/touch";

const OUTPUT = "TOUCHROW alpha bravo charlie\r\nSECONDROW delta echo\r\n";
const PASTE_TEXT = "mobile-paste-text";
const CLIPBOARD_BEFORE = "clipboard-before-paste";
const hex = (text: string) => Buffer.from(text).toString("hex");
const toasts = (page: Page) => page.locator("[data-sonner-toast]");
const errorToasts = (page: Page) => page.locator('[data-sonner-toast][data-type="error"]');

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  permissions: ["clipboard-read", "clipboard-write"],
});

let dummy: DummySsh;
let finger: Finger;

/** Stubs make the browser refuse a clipboard call, as a phone may. They change no app code. */
async function connect(page: Page, refuse: { read?: boolean; write?: boolean } = {}) {
  await page.addInitScript((r) => {
    const denied = () => Promise.reject(new DOMException("denied by test", "NotAllowedError"));
    if (r.read) navigator.clipboard.readText = denied;
    if (r.write) navigator.clipboard.writeText = denied;
  }, refuse);
  dummy = await new DummySsh({ shellOutput: OUTPUT }).start();
  finger = await Finger.on(page);
  await createVault(page);
  await addHost(page, { name: "paste", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await openHost(page, "paste");
  await acceptFirstKey(page);
  await expect.poll(() => dummy.shells).toBe(1);
  await expect(page.locator(".xterm-rows")).toContainText("SECONDROW");
  dummy.takeInputHex();
}

test.afterEach(async () => {
  await finger?.detach();
  await dummy?.stop();
});

async function holdAndRelease(page: Page, row: number, col: number) {
  await finger.hold(await cell(page, dummy, row, col), 700);
  await finger.up();
}

/** Seeds the clipboard through the real API, before any stub matters. */
const seed = (page: Page, text: string) =>
  page.evaluate((value) => navigator.clipboard.writeText(value), text);

test.describe("붙여넣기", () => {
  test("빈 줄의 빈 칸에서 0.4초 누른 뒤 떼면 클립보드 내용이 서버로 정확히 한 번 간다", async ({ page }) => {
    await connect(page);
    await seed(page, PASTE_TEXT);
    await holdAndRelease(page, 6, 5);
    await expect.poll(() => dummy.inputHex()).toBe(hex(PASTE_TEXT));
    await page.waitForTimeout(800);
    expect(dummy.inputHex(), "sent once").toBe(hex(PASTE_TEXT));
    await expect(selectionCells(page)).toHaveCount(0);
    await expect(toasts(page)).toHaveCount(0);
  });

  test("글자 사이 공백 칸도 빈 칸이다: 붙여넣기가 간다", async ({ page }) => {
    await connect(page);
    await seed(page, PASTE_TEXT);
    await holdAndRelease(page, 0, 14); // "alpha"와 "bravo" 사이 공백
    await expect.poll(() => dummy.inputHex()).toBe(hex(PASTE_TEXT));
    await page.waitForTimeout(800);
    expect(dummy.inputHex()).toBe(hex(PASTE_TEXT));
  });

  test("글자 위에서 떼면 붙여넣지 않고 단어를 복사한다", async ({ page }) => {
    await connect(page);
    await seed(page, PASTE_TEXT);
    await holdAndRelease(page, 0, 17); // "bravo"
    await expect.poll(() => readClipboard(page)).toBe("bravo");
    await page.waitForTimeout(500);
    expect(dummy.inputHex()).toBe("");
  });

  test("빈 칸이라도 0.4초보다 짧게 누르면 붙여넣지 않는다", async ({ page }) => {
    await connect(page);
    await seed(page, PASTE_TEXT);
    await finger.hold(await cell(page, dummy, 6, 5), 150);
    await finger.up();
    await page.waitForTimeout(800);
    expect(dummy.inputHex()).toBe("");
  });

  test("빈 칸에서 0.4초 누른 뒤 화살표 거리(30px)까지 끌면 붙여넣지 않고 화살표만 간다", async ({ page }) => {
    await connect(page);
    await seed(page, PASTE_TEXT);
    const at = await cell(page, dummy, 6, 5);
    await finger.hold(at, 700);
    await finger.glide({ x: at.x + 30, y: at.y }, 4, 15);
    await finger.up();
    await page.waitForTimeout(800);
    expect(dummy.inputHex()).toBe("1b5b43");
  });

  for (const [label, dx] of [
    ["8px", 8],
    ["경계 12px", 12],
  ] as const) {
    test(`빈 칸에서 누른 뒤 ${label}만 움직였다 떼면 화살표 없이 붙여넣기가 간다`, async ({ page }) => {
      await connect(page);
      await seed(page, PASTE_TEXT);
      const at = await cell(page, dummy, 6, 5);
      await finger.hold(at, 700);
      await finger.glide({ x: at.x + dx, y: at.y }, 3, 15);
      await finger.up();
      await expect.poll(() => dummy.inputHex()).toBe(hex(PASTE_TEXT));
      await page.waitForTimeout(500);
      expect(dummy.inputHex(), "sent once, no arrow").toBe(hex(PASTE_TEXT));
    });
  }

  test("[앱 변경 대기] 빈 칸에서 누른 뒤 12px 넘게(18px, 화살표 거리 전) 움직였다 떼면 아무것도 보내지 않는다", async ({ page }) => {
    await connect(page);
    await seed(page, PASTE_TEXT);
    const at = await cell(page, dummy, 6, 5);
    await finger.hold(at, 700);
    await finger.glide({ x: at.x, y: at.y + 18 }, 3, 15);
    await finger.up();
    await page.waitForTimeout(800);
    expect(dummy.inputHex()).toBe("");
    await expect(toasts(page)).toHaveCount(0);
  });

  test("[앱 변경 대기] 빈 칸에서 18px 움직였다가 제자리로 돌아와 떼도 붙여넣지 않는다(최대 이동 거리 기준)", async ({ page }) => {
    await connect(page);
    await seed(page, PASTE_TEXT);
    const at = await cell(page, dummy, 6, 5);
    await finger.hold(at, 700);
    await finger.glide({ x: at.x + 18, y: at.y }, 3, 15);
    await finger.glide(at, 3, 15);
    await finger.up();
    await page.waitForTimeout(800);
    expect(dummy.inputHex()).toBe("");
  });

  test("클립보드 읽기가 거절되면 오류 토스트가 한 번 뜨고 서버로는 아무것도 가지 않는다", async ({ page }) => {
    await connect(page, { read: true });
    await holdAndRelease(page, 6, 5);
    await expect(errorToasts(page)).toHaveCount(1);
    await page.waitForTimeout(800);
    await expect(toasts(page)).toHaveCount(1);
    expect(dummy.inputHex()).toBe("");
  });
});

test.describe("복사: 손 뗄 때 이동 거리", () => {
  test("글자 위에서 누른 뒤 8px만 움직였다 떼면 단어가 복사된다", async ({ page }) => {
    await connect(page);
    await seed(page, CLIPBOARD_BEFORE);
    const at = await cell(page, dummy, 0, 17); // "bravo"
    await finger.hold(at, 700);
    await finger.glide({ x: at.x, y: at.y + 8 }, 3, 15);
    await finger.up();
    await expect.poll(() => readClipboard(page)).toBe("bravo");
    expect(dummy.inputHex()).toBe("");
  });

  test("[앱 변경 대기] 글자 위에서 누른 뒤 12px 넘게(18px) 움직였다 떼면 복사하지 않고 아무것도 보내지 않는다", async ({ page }) => {
    await connect(page);
    await seed(page, CLIPBOARD_BEFORE);
    const at = await cell(page, dummy, 0, 17);
    await finger.hold(at, 700);
    await finger.glide({ x: at.x, y: at.y + 18 }, 3, 15);
    await finger.up();
    await page.waitForTimeout(800);
    expect(await readClipboard(page)).toBe(CLIPBOARD_BEFORE);
    expect(dummy.inputHex()).toBe("");
  });
});

test.describe("복사 토스트", () => {
  test("글자 위 홀드 복사가 성공하면 토스트가 뜨지 않는다", async ({ page }) => {
    await connect(page);
    await seed(page, CLIPBOARD_BEFORE);
    await holdAndRelease(page, 0, 17);
    await expect.poll(() => readClipboard(page)).toBe("bravo");
    await page.waitForTimeout(800);
    await expect(toasts(page)).toHaveCount(0);
    await expect(page.getByText("복사했습니다.")).toHaveCount(0);
  });

  test("클립보드 쓰기가 거절되면 복사 실패 오류 토스트가 한 번 뜬다", async ({ page }) => {
    await connect(page, { write: true });
    await holdAndRelease(page, 0, 17);
    await expect(errorToasts(page)).toHaveCount(1);
    await page.waitForTimeout(800);
    await expect(toasts(page)).toHaveCount(1);
    await expect(page.getByText("복사했습니다.")).toHaveCount(0);
    expect(dummy.inputHex()).toBe("");
  });
});
