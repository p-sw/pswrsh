// 자격 증명은 호스트 키를 수락하기 전에 게이트웨이로 나가지 않는다.
import { expect, type Page, test } from "./support/fixtures";
import {
  acceptFirstKey,
  addHost,
  createVault,
  firstKeyDialog,
  openHost,
  recordGatewayFrames,
  sentMessages,
  terminalAlert,
} from "./support/app";
import { DummySsh } from "./support/dummy-ssh";
import { KEY_PASSPHRASE, leaks, LOCKED_PRIVATE_KEY, PRIVATE_KEY, SSH_PASSWORD } from "./support/secrets";

let dummy: DummySsh;
test.beforeEach(async () => {
  dummy = await new DummySsh().start();
});
test.afterEach(async () => {
  await dummy.stop();
});

const SETTLE_MS = 700;

test("저장된 비밀번호: 수락 전에는 접속 정보만 나가고 서버에 인증 시도가 없으며, 수락 후에 나간다", async ({ page }) => {
  const frames = recordGatewayFrames(page);
  await createVault(page);
  await addHost(page, { name: "pw", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await openHost(page, "pw");
  await expect(firstKeyDialog(page)).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);

  expect(sentMessages(frames).map((m) => m.t)).toEqual(["connect"]);
  expect(leaks(JSON.stringify(frames))).toEqual([]);
  expect(dummy.authAttempts).toEqual([]);

  await acceptFirstKey(page);
  await expect.poll(() => dummy.authAttempts.length).toBeGreaterThan(0);

  // 순서: 서버가 호스트 키를 보낸 다음에야 trust가 나간다.
  const order = frames.filter((f) => f.text).map((f) => `${f.dir}:${JSON.parse(f.text!).t}`);
  expect(order.indexOf("received:hostkey")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("sent:trust")).toBeGreaterThan(order.indexOf("received:hostkey"));
  // 대조: 이 검사가 비밀번호를 볼 수 있다. 수락 뒤 frame에는 실제로 들어 있다.
  expect(leaks(JSON.stringify(frames))).toContain("ssh password");
});

test("개인키와 키 패스프레이즈: 수락 전에는 나가지 않는다", async ({ page }) => {
  const frames = recordGatewayFrames(page);
  await createVault(page);
  await addHost(page, {
    name: "key",
    hostname: "127.0.0.1",
    port: dummy.port,
    username: "ann",
    key: { privateKey: LOCKED_PRIVATE_KEY, passphrase: KEY_PASSPHRASE },
  });
  await openHost(page, "key");
  await expect(firstKeyDialog(page)).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);

  expect(sentMessages(frames).map((m) => m.t)).toEqual(["connect"]);
  expect(leaks(JSON.stringify(frames))).toEqual([]);
  expect(dummy.authAttempts).toEqual([]);

  await acceptFirstKey(page);
  await expect.poll(() => dummy.authAttempts.length).toBeGreaterThan(0);
  expect(sentMessages(frames).map((m) => m.t)).toContain("trust");
});

test("비밀번호 칸이 비었으면 수락 전에는 묻지도 않는다", async ({ page }) => {
  const frames = recordGatewayFrames(page);
  await createVault(page);
  await addHost(page, { name: "ask", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: "" });
  await openHost(page, "ask");
  await expect(firstKeyDialog(page)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "비밀번호 입력" })).toHaveCount(0);

  await acceptFirstKey(page);
  const prompt = page.getByRole("dialog", { name: "비밀번호 입력" });
  await expect(prompt).toBeVisible();
  expect(sentMessages(frames).map((m) => m.t)).toEqual(["connect"]);

  await prompt.locator("input[type=password]").fill(SSH_PASSWORD);
  await prompt.getByRole("button", { name: "접속" }).click();
  await expect.poll(() => dummy.authAttempts.length).toBe(1);
  expect(dummy.authAttempts[0].password === SSH_PASSWORD).toBe(true);
});

for (const [how, reject] of [
  ["거부 버튼", (page: Page) => firstKeyDialog(page).getByRole("button", { name: "거부" }).click()],
  ["Esc", (page: Page) => page.keyboard.press("Escape")],
] as const) {
  test(`${how}로 끝내면 자격 증명이 끝까지 나가지 않고 접속되지 않으며 키도 저장되지 않는다`, async ({ page }) => {
    const frames = recordGatewayFrames(page);
    await createVault(page);
    await addHost(page, {
      name: "refused",
      hostname: "127.0.0.1",
      port: dummy.port,
      username: "ann",
      key: { privateKey: PRIVATE_KEY },
    });
    await openHost(page, "refused");
    await expect(firstKeyDialog(page)).toBeVisible();
    await reject(page);

    await expect(terminalAlert(page, "호스트 키를 수락하지 않아 접속을 중단했습니다.")).toBeVisible();
    await expect.poll(() => dummy.open).toBe(0);
    await page.waitForTimeout(SETTLE_MS);
    expect(sentMessages(frames).map((m) => m.t)).toEqual(["connect"]);
    expect(leaks(JSON.stringify(frames))).toEqual([]);
    expect(dummy.authAttempts).toEqual([]);
    expect(dummy.shells).toBe(0);

    // 다시 연결하면 또 처음 접속으로 묻는다.
    await page.getByRole("button", { name: "다시 연결" }).click();
    await expect(firstKeyDialog(page)).toBeVisible();
  });
}

test("수락한 호스트 키와 같으면 다시 묻지 않고 접속한다", async ({ page }) => {
  await createVault(page);
  await addHost(page, { name: "known", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
  await openHost(page, "known");
  await expect(firstKeyDialog(page)).toContainText(dummy.fingerprint);
  await acceptFirstKey(page);
  await expect.poll(() => dummy.shells).toBe(1);

  await page.getByRole("button", { name: "연결 끊기" }).click();
  await expect.poll(() => dummy.open).toBe(0);
  await openHost(page, "known");
  await expect.poll(() => dummy.shells).toBe(2);
  await expect(firstKeyDialog(page)).toHaveCount(0);
});
