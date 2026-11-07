// 모바일: 0.4초 누른 뒤 제자리에서 떼면 그 자리 단어를 선택하고, 떼는 순간 클립보드에 복사한다.
// 짧은 탭은 선택하지 않는다. 버튼과 토스트는 없다.
import { expect, test } from "./support/fixtures";
import { acceptFirstKey, addHost, createVault, openHost } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD } from "./support/secrets";
import { cell, Finger, readClipboard, selectionCells } from "./support/touch";

const OUTPUT = "TOUCHROW alpha bravo charlie\r\nSECONDROW delta echo\r\nTHIRDROW foxtrot\r\n";
const CLIPBOARD_BEFORE = "clipboard-before-touch";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  permissions: ["clipboard-read", "clipboard-write"],
});

let dummy: DummySsh;
let finger: Finger;

test.beforeEach(async ({ page }) => {
  dummy = await new DummySsh({ shellOutput: OUTPUT }).start();
  finger = await Finger.on(page);
  await createVault(page);
  await addHost(page, { name: "touch", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await openHost(page, "touch");
  await acceptFirstKey(page);
  await expect.poll(() => dummy.shells).toBe(1);
  await expect(page.locator(".xterm-rows")).toContainText("THIRDROW");
  await page.evaluate((text) => navigator.clipboard.writeText(text), CLIPBOARD_BEFORE);
});

test.afterEach(async () => {
  await finger.detach();
  await dummy.stop();
});

test("0.4초 누르는 동안은 복사하지 않고, 제자리에서 떼는 순간 그 단어만 복사된다", async ({ page }) => {
  await finger.hold(await cell(page, dummy, 0, 17), 700); // "bravo"
  expect(await readClipboard(page), "nothing copied before release").toBe(CLIPBOARD_BEFORE);
  await finger.up();
  await expect.poll(() => readClipboard(page)).toBe("bravo");
  await expect(selectionCells(page).first()).toBeVisible();
});

test("다른 단어를 다시 길게 누르면 그 단어로 바뀐다", async ({ page }) => {
  await finger.hold(await cell(page, dummy, 0, 17));
  await finger.up();
  await expect.poll(() => readClipboard(page)).toBe("bravo");
  await finger.hold(await cell(page, dummy, 1, 17)); // "echo"
  await finger.up();
  await expect.poll(() => readClipboard(page)).toBe("echo");
});

for (const ms of [60, 250]) {
  // 한 번만 탭한다. 같은 자리 두 번 탭은 브라우저가 더블클릭으로 바꾸므로 따로 본다.
  test(`0.4초보다 짧게(${ms}ms) 한 번 누르면 선택도 복사도 없다`, async ({ page }) => {
    await finger.hold(await cell(page, dummy, 0, 17), ms);
    await finger.up();
    await page.waitForTimeout(700);
    await expect(selectionCells(page)).toHaveCount(0);
    expect(await readClipboard(page)).toBe(CLIPBOARD_BEFORE);
  });
}

test("선택한 뒤 짧게 탭하면 선택이 풀리고 클립보드는 바뀌지 않는다", async ({ page }) => {
  await finger.hold(await cell(page, dummy, 0, 17));
  await finger.up();
  await expect.poll(() => readClipboard(page)).toBe("bravo");
  await page.evaluate((text) => navigator.clipboard.writeText(text), CLIPBOARD_BEFORE);
  await finger.hold(await cell(page, dummy, 2, 3), 60);
  await finger.up();
  await expect(selectionCells(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await readClipboard(page)).toBe(CLIPBOARD_BEFORE);
});

test("길게 눌러 떼는 동안 서버로 바이트가 나가지 않는다", async ({ page }) => {
  dummy.takeInputHex();
  await finger.hold(await cell(page, dummy, 0, 17));
  await finger.up();
  await expect.poll(() => readClipboard(page)).toBe("bravo");
  await page.waitForTimeout(300);
  expect(dummy.inputHex()).toBe("");
});

test("서버 앱이 마우스를 추적해도 길게 눌러 떼면 단어가 복사되고 마우스 보고가 나가지 않는다", async ({ page }) => {
  dummy.write("\x1b[?1000hMOUSE-ON\r\n");
  await expect(page.locator(".xterm-rows")).toContainText("MOUSE-ON");
  dummy.takeInputHex();
  await finger.hold(await cell(page, dummy, 0, 17));
  await finger.up();
  await expect.poll(() => readClipboard(page)).toBe("bravo");
  await page.waitForTimeout(300);
  expect(dummy.inputHex()).toBe("");
});
