// 복사·붙여넣기는 OS 기본 키만 쓴다. 버튼과 토스트는 없다.
// 데스크톱: Ctrl+C는 선택이 있을 때만 복사하고, 없으면 ^C. Ctrl+Insert 복사.
// Ctrl+V와 Ctrl+Shift+Insert 붙여넣기. 복사는 선택한 글자만이다.
import { expect, type Page, test } from "./support/fixtures";
import { acceptFirstKey, addHost, createVault, openHost } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD } from "./support/secrets";

const CLIPBOARD_BEFORE = "clipboard-before-copy";
const FEW_LINES = "FIRSTROW-alpha\r\nSECONDROW-beta\r\nTHIRDROW-gamma\r\n";
const MANY_LINES = Array.from({ length: 300 }, (_, i) => `buffer-line-${i}`).join("\r\n") + "\r\n";

const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const seedClipboard = (page: Page, text = CLIPBOARD_BEFORE) =>
  page.evaluate((value) => navigator.clipboard.writeText(value), text);
const selectionCells = (page: Page) => page.locator(".xterm-selection div");

/** Drags across character cells of one visible terminal row, as a person would. */
async function dragSelect(page: Page, dummy: DummySsh, row: number, fromCol: number, toCol: number) {
  const box = (await page.locator(".xterm-screen").boundingBox())!;
  const { cols, rows } = dummy.size!;
  const cellWidth = box.width / cols;
  const cellHeight = box.height / rows;
  const y = box.y + cellHeight * (row + 0.5);
  await page.mouse.move(box.x + cellWidth * fromCol + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + cellWidth * toCol - 1, y, { steps: 8 });
  await page.mouse.up();
  await expect(selectionCells(page).first()).toBeVisible();
}

async function connect(page: Page, dummy: DummySsh) {
  await createVault(page);
  await addHost(page, { name: "copy-host", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await openHost(page, "copy-host");
  await acceptFirstKey(page);
  await expect.poll(() => dummy.shells).toBe(1);
  await expect(page.locator(".xterm-rows")).toContainText(dummy.shellOutput.split("\r\n")[0].slice(0, 10));
}

/** Waits a moment and returns everything the server received since the last take. */
async function settledInput(dummy: DummySsh) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return dummy.takeInputHex();
}

const hex = (text: string) => Buffer.from(text).toString("hex");

for (const [label, viewport] of [
  ["데스크톱", { width: 1280, height: 800 }],
  ["모바일", { width: 390, height: 844 }],
] as const) {
  test(`${label}: 복사, 붙여넣기, 전체 복사 버튼이 없다`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const dummy = await new DummySsh({ shellOutput: FEW_LINES }).start();
    try {
      await connect(page, dummy);
      await expect(page.getByRole("button", { name: /복사|붙여넣기|전체|모두/ })).toHaveCount(0);
    } finally {
      await dummy.stop();
    }
  });
}

test.describe("데스크톱 키", () => {
  test.use({ viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] });

  let dummy: DummySsh;
  test.afterEach(async () => {
    await dummy.stop();
  });

  test("선택이 없을 때 Ctrl+C는 셸에 ^C(03)를 보내고 클립보드는 그대로다", async ({ page }) => {
    dummy = await new DummySsh({ shellOutput: MANY_LINES }).start();
    await connect(page, dummy);
    await seedClipboard(page);
    await page.locator(".xterm-screen").click();
    dummy.takeInputHex();
    await page.keyboard.press("Control+C");
    expect(await settledInput(dummy)).toBe("03");
    expect(await readClipboard(page)).toBe(CLIPBOARD_BEFORE);
  });

  test("선택이 있을 때 Ctrl+C는 고른 글자만 복사하고 셸에는 아무것도 보내지 않는다", async ({ page }) => {
    dummy = await new DummySsh({ shellOutput: FEW_LINES }).start();
    await connect(page, dummy);
    await seedClipboard(page);
    await dragSelect(page, dummy, 1, 0, 9);
    dummy.takeInputHex();
    await page.keyboard.press("Control+C");
    expect(await settledInput(dummy)).toBe("");
    await expect.poll(() => readClipboard(page)).toBe("SECONDROW");
  });

  test("선택을 풀면 다음 Ctrl+C는 다시 ^C이고 이전 선택이 복사되지 않는다", async ({ page }) => {
    dummy = await new DummySsh({ shellOutput: FEW_LINES }).start();
    await connect(page, dummy);
    await dragSelect(page, dummy, 0, 0, 8);
    await page.keyboard.press("Control+C");
    await expect.poll(() => readClipboard(page)).toBe("FIRSTROW");

    const box = (await page.locator(".xterm-screen").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(selectionCells(page)).toHaveCount(0);
    await seedClipboard(page);
    dummy.takeInputHex();
    await page.keyboard.press("Control+C");
    expect(await settledInput(dummy)).toBe("03");
    expect(await readClipboard(page)).toBe(CLIPBOARD_BEFORE);
  });

  test("Ctrl+Insert는 고른 글자만 복사하고 셸에는 아무것도 보내지 않는다", async ({ page }) => {
    dummy = await new DummySsh({ shellOutput: FEW_LINES }).start();
    await connect(page, dummy);
    await seedClipboard(page);
    await dragSelect(page, dummy, 2, 0, 8);
    dummy.takeInputHex();
    await page.keyboard.press("Control+Insert");
    expect(await settledInput(dummy)).toBe("");
    await expect.poll(() => readClipboard(page)).toBe("THIRDROW");
  });

  test("Ctrl+C 복사가 성공하면 토스트가 뜨지 않는다", async ({ page }) => {
    dummy = await new DummySsh({ shellOutput: FEW_LINES }).start();
    await connect(page, dummy);
    await dragSelect(page, dummy, 1, 0, 9);
    await page.keyboard.press("Control+C");
    await expect.poll(() => readClipboard(page)).toBe("SECONDROW");
    await page.waitForTimeout(800);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await expect(page.getByText("복사했습니다.")).toHaveCount(0);
  });

  // Ctrl+C는 브라우저 기본 copy 이벤트로 복사하므로 앱이 볼 실패가 없다.
  // 앱이 클립보드에 직접 쓰는 Ctrl+Insert로 실패 토스트를 본다.
  test("클립보드 쓰기가 거절되면 Ctrl+Insert는 오류 토스트를 한 번 띄우고 셸에는 아무것도 보내지 않는다", async ({ page }) => {
    // 브라우저가 쓰기를 거절하는 경우를 흉내 낸다. 앱 코드는 바꾸지 않는다.
    await page.addInitScript(() => {
      navigator.clipboard.writeText = () => Promise.reject(new DOMException("denied by test", "NotAllowedError"));
    });
    dummy = await new DummySsh({ shellOutput: FEW_LINES }).start();
    await connect(page, dummy);
    await dragSelect(page, dummy, 1, 0, 9);
    dummy.takeInputHex();
    await page.keyboard.press("Control+Insert");
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(1);
    await page.waitForTimeout(800);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(1);
    expect(await settledInput(dummy)).toBe("");
  });

  for (const shortcut of ["Control+V", "Control+Shift+Insert"]) {
    test(`${shortcut}는 클립보드 내용을 한 번만 셸로 보낸다`, async ({ page }) => {
      dummy = await new DummySsh({ shellOutput: FEW_LINES }).start();
      await connect(page, dummy);
      const text = `pasted-${shortcut.length}-text`;
      await seedClipboard(page, text);
      await page.locator(".xterm-screen").click();
      dummy.takeInputHex();
      await page.keyboard.press(shortcut);
      await expect.poll(() => dummy.inputHex()).toBe(hex(text));
      expect(await settledInput(dummy)).toBe(hex(text));
    });
  }
});
