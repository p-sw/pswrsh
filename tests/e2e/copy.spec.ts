// 복사는 선택 영역만. 선택이 없으면 전체 버퍼를 복사하지 않는다.
import { expect, type Page, test } from "@playwright/test";
import { acceptFirstKey, addHost, createVault, openHost } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD } from "./support/secrets";

const CLIPBOARD_BEFORE = "clipboard-before-copy";
const NO_SELECTION_TOAST = "선택된 텍스트가 없습니다";

const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const seedClipboard = (page: Page, text = CLIPBOARD_BEFORE) =>
  page.evaluate((value) => navigator.clipboard.writeText(value), text);

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
}

async function connect(page: Page, dummy: DummySsh) {
  await createVault(page);
  await addHost(page, { name: "copy-host", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await openHost(page, "copy-host");
  await acceptFirstKey(page);
  await expect.poll(() => dummy.shells).toBe(1);
  await expect(page.locator(".xterm-rows")).toContainText(dummy.shellOutput.split("\r\n")[0].slice(0, 10));
}

const LAYOUTS = [
  { label: "데스크톱", viewport: { width: 1280, height: 800 } },
  { label: "모바일", viewport: { width: 390, height: 844 } },
];

const MANY_LINES = Array.from({ length: 300 }, (_, i) => `buffer-line-${i}`).join("\r\n") + "\r\n";
const FEW_LINES = "FIRSTROW-alpha\r\nSECONDROW-beta\r\nTHIRDROW-gamma\r\n";

for (const { label, viewport } of LAYOUTS) {
  test.describe(label, () => {
    test.use({ viewport, permissions: ["clipboard-read", "clipboard-write"] });

    test("선택이 없으면 알림만 뜨고 클립보드가 그대로다", async ({ page }) => {
      const dummy = await new DummySsh({ shellOutput: MANY_LINES }).start();
      try {
        await connect(page, dummy);
        await seedClipboard(page);
        await page.getByRole("button", { name: "복사", exact: true }).click();
        await expect(page.getByText(NO_SELECTION_TOAST)).toBeVisible();
        expect(await readClipboard(page)).toBe(CLIPBOARD_BEFORE);
      } finally {
        await dummy.stop();
      }
    });

    test("드래그로 고른 글자만 복사되고 다른 줄은 들어가지 않는다", async ({ page }) => {
      const dummy = await new DummySsh({ shellOutput: FEW_LINES }).start();
      try {
        await connect(page, dummy);
        await seedClipboard(page);
        await dragSelect(page, dummy, 1, 0, 9);
        await page.getByRole("button", { name: "복사", exact: true }).click();
        await expect(page.getByText("선택한 내용을 복사했습니다.")).toBeVisible();
        expect(await readClipboard(page)).toBe("SECONDROW");
      } finally {
        await dummy.stop();
      }
    });

    test("선택을 풀면 다시 복사해도 이전 선택이나 버퍼가 들어가지 않는다", async ({ page }) => {
      const dummy = await new DummySsh({ shellOutput: FEW_LINES }).start();
      try {
        await connect(page, dummy);
        await dragSelect(page, dummy, 0, 0, 8);
        await page.getByRole("button", { name: "복사", exact: true }).click();
        expect(await readClipboard(page).then((text) => text === "FIRSTROW")).toBe(true);

        const box = (await page.locator(".xterm-screen").boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await seedClipboard(page);
        await page.getByRole("button", { name: "복사", exact: true }).click();
        await expect(page.getByText(NO_SELECTION_TOAST)).toBeVisible();
        expect(await readClipboard(page)).toBe(CLIPBOARD_BEFORE);
      } finally {
        await dummy.stop();
      }
    });
  });
}

test.describe("데스크톱 단축키", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("Ctrl+Shift+C도 선택이 없으면 복사하지 않고, 있으면 선택만 복사한다", async ({ page }) => {
    const dummy = await new DummySsh({ shellOutput: FEW_LINES }).start();
    try {
      await connect(page, dummy);
      await seedClipboard(page);
      await page.locator(".xterm-screen").click();
      await page.keyboard.press("Control+Shift+C");
      await expect(page.getByText(NO_SELECTION_TOAST)).toBeVisible();
      expect(await readClipboard(page)).toBe(CLIPBOARD_BEFORE);

      await dragSelect(page, dummy, 2, 0, 8);
      await page.keyboard.press("Control+Shift+C");
      await expect(page.getByText("선택한 내용을 복사했습니다.")).toBeVisible();
      expect(await readClipboard(page)).toBe("THIRDROW");
    } finally {
      await dummy.stop();
    }
  });

  test("전체 복사 버튼이 없다", async ({ page }) => {
    const dummy = await new DummySsh({ shellOutput: FEW_LINES }).start();
    try {
      await connect(page, dummy);
      await expect(page.getByRole("button", { name: /전체|모두/ })).toHaveCount(0);
    } finally {
      await dummy.stop();
    }
  });
});
