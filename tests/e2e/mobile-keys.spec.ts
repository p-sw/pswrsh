// 모바일 특수키: Esc, Tab, Ctrl+문자, 화살표가 정해진 바이트로 나간다. 데스크톱 레이아웃에는 그 바가 없다.
import { expect, type Page, test } from "./support/fixtures";
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

  // 화살표 버튼은 새 조작법에서 빠졌다. 화살표 바이트는 touch-arrows.spec.ts의 홀드 끌기가 본다.
  for (const [name, hex] of [["Tab", "09"]] as const) {
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
    // 새 조작법: 바에는 Esc, Tab, Ctrl만 남는다.
    await expect(keyBar(page).getByRole("button")).toHaveCount(3);
    for (const name of ["Esc", "Tab", "Ctrl"]) {
      await expect(keyBar(page).getByRole("button", { name, exact: true })).toBeVisible();
    }
    for (const name of ["왼쪽", "위", "아래", "오른쪽"]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    const bar = (await keyBar(page).boundingBox())!;
    const terminal = (await page.locator(".xterm-screen").boundingBox())!;
    expect(terminal.y + terminal.height).toBeLessThanOrEqual(bar.y);
    expect(bar.y + bar.height).toBeLessThanOrEqual(844);
  });
});

for (const width of [390, 320]) {
  test.describe(`특수키 바 폭 ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test("Esc, Tab, Ctrl 세 칸이 바 폭을 균등하게 나누고 각각 44x44 이상이다", async ({ page }) => {
      const dummy = await new DummySsh().start();
      try {
        await connect(page, dummy);
        const bar = (await keyBar(page).boundingBox())!;
        const boxes = [];
        for (const name of ["Esc", "Tab", "Ctrl"]) {
          boxes.push((await keyBar(page).getByRole("button", { name, exact: true }).boundingBox())!);
        }
        for (const box of boxes) {
          expect(box.width, `width ${box.width}`).toBeGreaterThanOrEqual(44);
          expect(box.height, `height ${box.height}`).toBeGreaterThanOrEqual(44);
          expect(Math.abs(box.width - boxes[0].width), "equal widths").toBeLessThanOrEqual(1);
        }
        // 균등 분할: 왼쪽에서 오른쪽 끝까지 세 칸이 채운다. 남는 폭은 바 안쪽 여백과 칸 사이 간격뿐이다.
        expect(boxes[0].x - bar.x).toBeLessThanOrEqual(8);
        expect(bar.x + bar.width - (boxes[2].x + boxes[2].width)).toBeLessThanOrEqual(8);
        expect(boxes[0].width * 3).toBeGreaterThanOrEqual(bar.width - 24);
      } finally {
        await dummy.stop();
      }
    });
  });
}

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
