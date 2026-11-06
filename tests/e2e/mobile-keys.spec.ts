// 모바일 특수키: Esc, Tab, Ctrl+문자, 화살표가 정해진 바이트로 나간다. 데스크톱 레이아웃에는 그 바가 없다.
import { expect, type Page, test } from "@playwright/test";
import { acceptFirstKey, addHost, createVault, openHost } from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { SSH_PASSWORD } from "./support/secrets";

const keyBar = (page: Page) => page.getByRole("toolbar", { name: "특수키" });

async function connect(page: Page, dummy: DummySsh) {
  await createVault(page);
  await addHost(page, { name: "keys", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await openHost(page, "keys");
  await acceptFirstKey(page);
  await expect.poll(() => dummy.shells).toBe(1);
}

/** Runs a gesture and checks the exact bytes the SSH server received for it. */
async function expectBytes(dummy: DummySsh, hex: string, gesture: () => Promise<unknown>) {
  dummy.takeInputHex();
  await gesture();
  await expect.poll(() => dummy.inputHex()).toBe(hex);
  // 늦게 도착한 바이트가 없는지 한 번 더 본다.
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(dummy.takeInputHex()).toBe(hex);
}

test.describe("모바일 390x844, 터치", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  let dummy: DummySsh;
  test.beforeEach(async () => {
    dummy = await new DummySsh().start();
  });
  test.afterEach(async () => {
    await dummy.stop();
  });

  test("Esc는 1b를 보낸다", async ({ page }) => {
    await connect(page, dummy);
    // pnpm dev의 Next 개발 도구 버튼이 바 왼쪽 아래를 덮는다. 제품이 아니라 개발 도구이므로 테스트에서 치운다.
    await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((element) => element.remove()));
    await expectBytes(dummy, "1b", () => keyBar(page).getByRole("button", { name: "Esc", exact: true }).tap({ timeout: 10_000 }));
  });

  for (const [name, hex] of [
    ["Tab", "09"],
    ["왼쪽", "1b5b44"],
    ["위", "1b5b41"],
    ["아래", "1b5b42"],
    ["오른쪽", "1b5b43"],
  ] as const) {
    test(`${name}는 ${hex}를 보낸다`, async ({ page }) => {
      await connect(page, dummy);
      // 손가락이 닿는 자리를 다른 요소가 덮고 있으면 여기서 실패한다.
      await expectBytes(dummy, hex, () => keyBar(page).getByRole("button", { name, exact: true }).tap({ timeout: 10_000 }));
    });
  }

  for (const [letter, hex] of [
    ["c", "03"],
    ["a", "01"],
    ["d", "04"],
    ["z", "1a"],
    ["C", "03"],
  ] as const) {
    test(`Ctrl 다음 ${letter}는 ${hex} 한 바이트이고, 다음 ${letter}는 그대로 간다`, async ({ page }) => {
      await connect(page, dummy);
      const ctrl = keyBar(page).getByRole("button", { name: "Ctrl", exact: true });
      await expectBytes(dummy, hex, async () => {
        await ctrl.tap();
        await expect(ctrl).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.type(letter);
      });
      await expect(ctrl).toHaveAttribute("aria-pressed", "false");
      await expectBytes(dummy, Buffer.from(letter).toString("hex"), () => page.keyboard.type(letter));
    });
  }

  for (const [name, csi, ss3] of [
    ["왼쪽", "1b5b44", "1b4f44"],
    ["위", "1b5b41", "1b4f41"],
    ["아래", "1b5b42", "1b4f42"],
    ["오른쪽", "1b5b43", "1b4f43"],
  ] as const) {
    test(`애플리케이션 커서 모드에서 ${name}는 SS3 ${ss3}, 모드를 끄면 다시 CSI ${csi}`, async ({ page }) => {
      await connect(page, dummy);
      const button = keyBar(page).getByRole("button", { name, exact: true });
      // 서버 쪽 앱이 DECCKM을 켠다. 표시 문자열이 그려지면 xterm이 그 앞의 모드 변경도 처리한 것이다.
      dummy.write("\x1b[?1hAPPMODE-ON\r\n");
      await expect(page.locator(".xterm-rows")).toContainText("APPMODE-ON");
      await expectBytes(dummy, ss3, () => button.tap());
      dummy.write("\x1b[?1lAPPMODE-OFF\r\n");
      await expect(page.locator(".xterm-rows")).toContainText("APPMODE-OFF");
      await expectBytes(dummy, csi, () => button.tap());
    });
  }

  test("화살표 뒤에도 키보드 글자가 그대로 나간다", async ({ page }) => {
    await connect(page, dummy);
    await expectBytes(dummy, "1b5b41", () => keyBar(page).getByRole("button", { name: "위", exact: true }).tap());
    await page.locator(".xterm-helper-textarea").focus();
    await expectBytes(dummy, "78", () => page.keyboard.type("x"));
  });

  test("Ctrl을 두 번 누르면 풀려서 다음 글자가 그대로 간다", async ({ page }) => {
    await connect(page, dummy);
    const ctrl = keyBar(page).getByRole("button", { name: "Ctrl", exact: true });
    await ctrl.tap();
    await ctrl.tap();
    await expect(ctrl).toHaveAttribute("aria-pressed", "false");
    await page.locator(".xterm-screen").tap();
    await expectBytes(dummy, "63", () => page.keyboard.type("c"));
  });

  test("Ctrl만 눌러서는 아무 바이트도 나가지 않는다", async ({ page }) => {
    await connect(page, dummy);
    dummy.takeInputHex();
    await keyBar(page).getByRole("button", { name: "Ctrl", exact: true }).tap();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(dummy.inputHex()).toBe("");
  });

  test("바는 터미널 아래에 있고 터미널 마지막 줄을 가리지 않는다", async ({ page }) => {
    await connect(page, dummy);
    await expect(keyBar(page)).toBeVisible();
    await expect(keyBar(page).getByRole("button")).toHaveCount(7);
    const bar = (await keyBar(page).boundingBox())!;
    const terminal = (await page.locator(".xterm-screen").boundingBox())!;
    expect(terminal.y + terminal.height).toBeLessThanOrEqual(bar.y);
    expect(bar.y + bar.height).toBeLessThanOrEqual(844);
  });
});

test.describe("레이아웃 경계", () => {
  let dummy: DummySsh;
  test.beforeEach(async () => {
    dummy = await new DummySsh().start();
  });
  test.afterEach(async () => {
    await dummy.stop();
  });

  test("데스크톱 1280에는 연결된 세션에서도 바가 없다", async ({ page }) => {
    await connect(page, dummy);
    await expect(page.locator(".xterm-screen")).toBeVisible();
    await expect(keyBar(page)).toBeHidden();
    for (const name of ["Esc", "Tab", "Ctrl", "왼쪽", "위", "아래", "오른쪽"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeHidden();
    }
  });

  test("대조와 경계: 767에서 보이고 768에서 사라진다", async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 800 });
    await connect(page, dummy);
    await expect(keyBar(page)).toBeVisible();
    await page.setViewportSize({ width: 768, height: 800 });
    await expect(keyBar(page)).toBeHidden();
    await page.setViewportSize({ width: 767, height: 800 });
    await expect(keyBar(page)).toBeVisible();
  });
});
