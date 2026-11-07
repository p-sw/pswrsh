// 없는 사용자와 가짜 비밀번호로 127.0.0.1:22에 시도하면 인증 실패가 화면에 나온다.
// 비밀번호나 키가 틀리면 대화형 인증으로 넘어가지 않는다.
import { execFileSync, spawnSync } from "node:child_process";
import { expect, type Page, test } from "./support/fixtures";
import {
  acceptFirstKey,
  addHost,
  createVault,
  firstKeyDialog,
  type HostInput,
  importDialog,
  importKey,
  kbdDialog,
  openHost,
  terminalAlert,
} from "./support/app";
import { DummySsh, publicKeyBlob, rejectAll } from "./support/dummy-ssh";
import {
  KEY_PASSPHRASE,
  LOCKED_PRIVATE_KEY,
  LOCKED_PUBLIC_KEY,
  PRIVATE_KEY,
  PUBLIC_KEY,
  RUN,
  SSH_PASSWORD,
} from "./support/secrets";

const AUTH_MESSAGE = "서버가 인증을 거부했습니다.";

async function connectExpectingFailure(page: Page, dummy: DummySsh, host: Omit<HostInput, "hostname" | "port">) {
  await createVault(page);
  await addHost(page, { ...host, hostname: "127.0.0.1", port: dummy.port });
  await openHost(page, host.name!);
  await acceptFirstKey(page);
}

test.describe("127.0.0.1:22의 실제 sshd", () => {
  const username = `pswrsh-nouser-${RUN}`;

  test("없는 사용자와 가짜 비밀번호는 인증 실패로 화면에 나오고 대화형 질문이 없다", async ({ page }) => {
    // 이 이름의 계정이 있으면 시도하지 않는다.
    expect(spawnSync("getent", ["passwd", username]).status).not.toBe(0);
    const since = new Date().toISOString().slice(0, 19).replace("T", " ");

    await createVault(page);
    await addHost(page, { name: "real-sshd", hostname: "127.0.0.1", port: 22, username, password: SSH_PASSWORD });
    await openHost(page, "real-sshd");

    // 화면의 지문이 이 머신 sshd의 키와 같아야 정말 거기까지 갔다는 뜻이다.
    const dialog = firstKeyDialog(page);
    await expect(dialog).toBeVisible();
    const shown = (await dialog.locator("code").innerText()).trim();
    const scanned = execFileSync("ssh-keyscan", ["-p", "22", "127.0.0.1"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const prints = execFileSync("ssh-keygen", ["-lf", "-"], { input: scanned, encoding: "utf8" });
    expect(prints).toContain(shown);

    await acceptFirstKey(page);
    const alert = terminalAlert(page, "인증 실패");
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).toContainText(AUTH_MESSAGE);
    await expect(page.getByRole("button", { name: "호스트 수정" })).toBeVisible();
    await expect(page.getByRole("button", { name: "다시 연결" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // sshd 쪽 기록이 읽히면 비밀번호 방식으로 실패했고 대화형은 없었는지 본다.
    const journal = spawnSync("sudo", ["-n", "journalctl", "--since", since, "--no-pager", "-o", "cat"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (journal.status === 0) {
      const lines = journal.stdout.split("\n").filter((line) => line.includes(username));
      expect(lines.some((line) => line.includes("Failed password for invalid user"))).toBe(true);
      expect(lines.some((line) => line.includes("keyboard-interactive"))).toBe(false);
    } else {
      test.info().annotations.push({ type: "not-checked", description: "sshd journal unreadable" });
    }
  });
});

test.describe("서버가 대화형도 받는다고 알릴 때", () => {
  let dummy: DummySsh;
  test.beforeEach(async () => {
    dummy = await new DummySsh().start();
  });
  test.afterEach(async () => {
    await dummy.stop();
  });

  test("틀린 비밀번호는 인증 실패로 끝나고 대화형으로 넘어가지 않는다", async ({ page }) => {
    dummy.policy = rejectAll("password", "keyboard-interactive");
    await connectExpectingFailure(page, dummy, { name: "wrong-pw", username: "ann", password: SSH_PASSWORD });

    await expect(terminalAlert(page, "인증 실패")).toContainText(AUTH_MESSAGE);
    await page.waitForTimeout(700);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(dummy.authAttempts.map((a) => a.method)).toEqual(["password"]);
    expect(dummy.shells).toBe(0);
  });

  test("틀린 키는 인증 실패로 끝나고 대화형으로 넘어가지 않는다", async ({ page }) => {
    dummy.policy = rejectAll("publickey", "keyboard-interactive");
    await connectExpectingFailure(page, dummy, { name: "wrong-key", username: "ann", key: { privateKey: PRIVATE_KEY } });

    await expect(terminalAlert(page, "인증 실패")).toContainText(AUTH_MESSAGE);
    await page.waitForTimeout(700);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(dummy.authAttempts.map((a) => a.method)).toEqual(["publickey"]);
    expect(dummy.authAttempts[0].publicKey === publicKeyBlob(PUBLIC_KEY)).toBe(true);
  });

  test("키 패스프레이즈가 틀리면 키를 불러올 때 막히고, 키는 저장되지 않으며 서버에는 아무것도 가지 않는다", async ({ page }) => {
    // 키는 키 관리에서 불러온다. 틀린 패스프레이즈는 불러오기 대화상자에서 걸러진다.
    await createVault(page);
    const name = await importKey(page, { privateKey: LOCKED_PRIVATE_KEY, passphrase: `${KEY_PASSPHRASE}x` }, { expectError: true });
    await expect(importDialog(page)).toContainText("키 암호가 맞지 않습니다.");
    await importDialog(page).getByRole("button", { name: "취소" }).click();
    await expect(importDialog(page)).toBeHidden();
    await expect(page.locator("main li").filter({ hasText: name })).toHaveCount(0);
    expect(dummy.connections).toBe(0);
    expect(dummy.authAttempts).toEqual([]);
  });

  test("맞는 키 패스프레이즈면 그 키로 인증을 시도한다", async ({ page }) => {
    await connectExpectingFailure(page, dummy, {
      name: "right-keypass",
      username: "ann",
      key: { privateKey: LOCKED_PRIVATE_KEY, passphrase: KEY_PASSPHRASE },
    });
    await expect.poll(() => dummy.shells).toBe(1);
    expect(dummy.authAttempts[0].publicKey === publicKeyBlob(LOCKED_PUBLIC_KEY)).toBe(true);
  });

  test("대조: 서버가 비밀번호를 받지 않으면 대화형 질문이 대화상자로 나온다", async ({ page }) => {
    dummy.policy = (attempt) =>
      attempt.method === "keyboard-interactive" ? { accept: true } : { accept: false, methods: ["keyboard-interactive"] };
    await connectExpectingFailure(page, dummy, { name: "kbd-only", username: "ann", password: SSH_PASSWORD });

    // 위 경우의 '대화상자 없음'이 빈 검사가 아니라는 대조다.
    const dialog = kbdDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.locator("input[type=password]").fill("fake-answer");
    await dialog.getByRole("button", { name: "보내기" }).click();
    await expect.poll(() => dummy.shells).toBe(1);
    expect(dummy.authAttempts.map((a) => a.method)).toEqual(["password", "keyboard-interactive"]);
    expect(dummy.authAttempts[1].answers).toEqual(["fake-answer"]);
  });
});
