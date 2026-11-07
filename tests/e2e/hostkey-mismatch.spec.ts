// 호스트키 불일치는 접속하지 않고, 기존 지문과 새 지문을 보여 준다. 교체를 명시할 때만 진행한다.
import { expect, type Page, test } from "./support/fixtures";
import {
  acceptFirstKey,
  addHost,
  changedKeyDialog,
  createVault,
  firstKeyDialog,
  openHost,
  recordGatewayFrames,
  sentMessages,
  terminalAlert,
  unlock,
} from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { leaks, SSH_PASSWORD } from "./support/secrets";

let original: DummySsh;
let impostor: DummySsh | null = null;

test.beforeEach(async () => {
  original = await new DummySsh().start();
  impostor = null;
});
test.afterEach(async () => {
  await (impostor ?? original).stop();
});

/** Trusts the original server, then puts a different key on the same address. */
async function trustThenSwapKey(page: Page) {
  await createVault(page);
  await addHost(page, {
    name: "swapped",
    hostname: "127.0.0.1",
    port: original.port,
    username: "ann",
    password: SSH_PASSWORD,
  });
  await openHost(page, "swapped");
  await acceptFirstKey(page);
  await expect.poll(() => original.shells).toBe(1);
  await page.getByRole("button", { name: "연결 끊기" }).click();
  await expect.poll(() => original.open).toBe(0);

  const port = original.port;
  await original.stop();
  impostor = await new DummySsh().start(port);
  expect(impostor.fingerprint).not.toBe(original.fingerprint);
  return impostor;
}

test("불일치면 기존 지문과 새 지문을 보여 주고, 답하기 전에는 인증도 셸도 없다", async ({ page }) => {
  const frames = recordGatewayFrames(page);
  const server = await trustThenSwapKey(page);
  frames.length = 0;

  await openHost(page, "swapped");
  const dialog = changedKeyDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("저장된 지문");
  await expect(dialog).toContainText(original.fingerprint);
  await expect(dialog).toContainText("새 지문");
  await expect(dialog).toContainText(server.fingerprint);
  await expect(dialog.getByRole("button", { name: "접속 안 함" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "새 키로 교체하고 접속" })).toBeVisible();

  await page.waitForTimeout(700);
  expect(server.authAttempts).toEqual([]);
  expect(server.shells).toBe(0);
  expect(sentMessages(frames).map((m) => m.t)).toEqual(["connect"]);
  expect(leaks(JSON.stringify(frames))).toEqual([]);
});

for (const [how, refuse] of [
  ["접속 안 함", (page: Page) => changedKeyDialog(page).getByRole("button", { name: "접속 안 함" }).click()],
  ["Esc", (page: Page) => page.keyboard.press("Escape")],
] as const) {
  test(`${how}로 끝내면 접속하지 않고 저장된 지문을 바꾸지 않는다`, async ({ page }) => {
    const frames = recordGatewayFrames(page);
    const server = await trustThenSwapKey(page);
    frames.length = 0;

    await openHost(page, "swapped");
    await expect(changedKeyDialog(page)).toBeVisible();
    await refuse(page);

    await expect(terminalAlert(page, "호스트 키를 수락하지 않아 접속을 중단했습니다.")).toBeVisible();
    await expect.poll(() => server.open).toBe(0);
    await page.waitForTimeout(700);
    expect(server.authAttempts).toEqual([]);
    expect(server.shells).toBe(0);
    expect(sentMessages(frames).map((m) => m.t)).toEqual(["connect"]);

    // 다시 시도해도 기존 지문 그대로 불일치로 나온다. 다시 열어도 같다.
    await page.reload();
    await unlock(page);
    await openHost(page, "swapped");
    await expect(changedKeyDialog(page)).toContainText(original.fingerprint);
    await expect(changedKeyDialog(page)).toContainText(server.fingerprint);
  });
}

test("새 키로 교체를 눌러야 인증과 셸이 진행되고, 그 뒤에는 새 키로 묻지 않는다", async ({ page }) => {
  const server = await trustThenSwapKey(page);

  await openHost(page, "swapped");
  await changedKeyDialog(page).getByRole("button", { name: "새 키로 교체하고 접속" }).click();
  await expect(changedKeyDialog(page)).toBeHidden();

  await expect.poll(() => server.shells).toBe(1);
  expect(server.authAttempts).toHaveLength(1);
  expect(server.authAttempts[0].password === SSH_PASSWORD).toBe(true);

  await page.getByRole("button", { name: "연결 끊기" }).click();
  await expect.poll(() => server.open).toBe(0);

  await page.reload();
  await unlock(page);
  await openHost(page, "swapped");
  await expect.poll(() => server.shells).toBe(2);
  await expect(changedKeyDialog(page)).toHaveCount(0);
  await expect(firstKeyDialog(page)).toHaveCount(0);
});
