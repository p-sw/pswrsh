// Drives the app the way a person does: labels, roles and visible text.
import { expect, type Locator, type Page } from "@playwright/test";
import { VAULT_PASSPHRASE } from "./secrets";

export const passphraseField = (page: Page) => page.getByLabel("패스프레이즈", { exact: true });
export const confirmField = (page: Page) => page.getByLabel("패스프레이즈 확인", { exact: true });
export const createHeading = (page: Page) => page.getByRole("heading", { name: "볼트 만들기" });
export const unlockHeading = (page: Page) => page.getByRole("heading", { name: "pswrsh 잠금 해제" });
export const workspaceHeading = (page: Page) => page.getByRole("heading", { name: "pswrsh", exact: true });

export async function createVault(page: Page, passphrase = VAULT_PASSPHRASE) {
  await page.goto("/");
  await expect(createHeading(page)).toBeVisible();
  await passphraseField(page).fill(passphrase);
  await confirmField(page).fill(passphrase);
  await page.getByRole("button", { name: "볼트 만들기" }).click();
  await expect(workspaceHeading(page)).toBeVisible();
}

/** Reloads the page. A reload drops the vault key, so it opens again with the passphrase. */
export async function reopen(page: Page, passphrase = VAULT_PASSPHRASE) {
  await page.reload();
  await unlock(page, passphrase);
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;
export const mobileNav = (page: Page) => page.getByRole("navigation", { name: "주요 메뉴" });

/**
 * Taps a bottom-navigation link. pnpm dev's Next dev-tools button sits over the bottom-left
 * corner (the 호스트 link); it is a dev tool, not the product, so it is removed first.
 */
export async function clickNav(page: Page, label: "호스트" | "연결" | "키" | "설정") {
  await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((element) => element.remove()));
  await mobileNav(page).getByRole("link", { name: label, exact: true }).click();
}

/**
 * Goes to a top-level page the way a person does: the bottom navigation on phones,
 * the account menu on wider screens.
 */
export async function goTo(page: Page, where: "키" | "연결" | "설정") {
  if (isPhone(page)) {
    await clickNav(page, where);
  } else {
    const item = { 키: "키 관리", 연결: "연결 목록", 설정: "설정" }[where];
    await page.getByRole("button", { name: "계정", exact: true }).click();
    await page.getByRole("menuitem", { name: item, exact: true }).click();
  }
}

/**
 * Back to the host list without a reload (a reload would ask for the passphrase): the bottom
 * navigation on phones, the "터미널로 돌아가기" link on wider screens.
 */
export async function goHome(page: Page) {
  if (isPhone(page)) await clickNav(page, "호스트");
  else await page.getByRole("link", { name: "터미널로 돌아가기" }).click();
  await expect(workspaceHeading(page)).toBeVisible();
}

/** Logs out from the account menu. The app goes to /login. */
export async function logOut(page: Page) {
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Logs in through the login form, which sends the browser to /. */
export async function logInWithForm(page: Page, account: { email: string; password: string }) {
  const email = page.getByLabel("이메일", { exact: true });
  const password = page.getByLabel("비밀번호", { exact: true });
  const submit = page.getByRole("button", { name: "로그인", exact: true });
  // Typing before the form hydrates can be wiped by React: fill until both values stick.
  await expect(async () => {
    if ((await email.inputValue()) !== account.email) await email.fill(account.email);
    if ((await password.inputValue()) !== account.password) await password.fill(account.password);
    await expect(submit).toBeEnabled({ timeout: 1000 });
    await expect(email).toHaveValue(account.email, { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await submit.click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Logs out and back in on the same browser: the vault then asks for the passphrase. */
export async function logOutAndBackIn(page: Page, account: { email: string; password: string }) {
  await logOut(page);
  await logInWithForm(page, account);
  await expect(unlockHeading(page)).toBeVisible();
}

export async function unlock(page: Page, passphrase = VAULT_PASSPHRASE) {
  await expect(unlockHeading(page)).toBeVisible();
  await passphraseField(page).fill(passphrase);
  await page.getByRole("button", { name: "잠금 해제" }).click();
  await expect(workspaceHeading(page)).toBeVisible();
}

export type KeyInput = { name?: string; privateKey?: string; file?: string; passphrase?: string };

let keySeq = 0;

export const importDialog = (page: Page) => page.getByRole("dialog", { name: "키 불러오기" });

/**
 * Imports a key on /keys. With pick, it starts from the host form's link and ends back
 * in the host form with that key chosen. With expectError, it stops at the import
 * dialog's error and leaves the dialog open.
 */
export async function importKey(page: Page, key: KeyInput, { pick = false, expectError = false } = {}) {
  const name = key.name ?? "e2e-key-" + ++keySeq;
  if (pick) await page.getByRole("link", { name: "키 관리에서 고르기" }).click();
  else {
    // Through the menu, as a person does (bottom navigation on phones).
    await goTo(page, "키");
  }
  await expect(page.getByRole("heading", { name: "키 관리" })).toBeVisible();
  await page.getByRole("button", { name: "키 불러오기" }).click();
  const dialog = importDialog(page);
  await dialog.getByLabel("이름", { exact: true }).fill(name);
  if (key.privateKey !== undefined) await dialog.getByLabel("개인키", { exact: true }).fill(key.privateKey);
  if (key.file !== undefined) await dialog.getByLabel("개인키 파일").setInputFiles(key.file);
  if (key.passphrase !== undefined) await dialog.getByLabel("키 암호 (없으면 비움)").fill(key.passphrase);
  await dialog.getByRole("button", { name: "불러오기" }).click();
  if (expectError) return name;
  await expect(dialog).toBeHidden();
  // Importing shows the new public key. Close it to get back to the list.
  const shown = page.getByRole("dialog", { name, exact: true });
  // On phones the sheet also has a corner close button with the same name.
  await shown.getByRole("button", { name: "닫기", exact: true }).first().click();
  await expect(shown).toBeHidden();
  if (pick) {
    await page.locator("main li").filter({ hasText: name }).getByRole("button", { name: "이 키 사용" }).click();
    await expect(page.getByRole("dialog", { name: /호스트 (추가|수정)/ })).toBeVisible();
  }
  return name;
}

export type HostInput = {
  name?: string;
  hostname: string;
  port?: number;
  username: string;
  password?: string;
  key?: KeyInput;
  interactive?: boolean;
};

export async function fillHostForm(dialog: Locator, host: Partial<HostInput>) {
  if (host.name !== undefined) await dialog.getByLabel("이름", { exact: true }).fill(host.name);
  if (host.hostname !== undefined) await dialog.getByLabel("호스트", { exact: true }).fill(host.hostname);
  if (host.port !== undefined) await dialog.getByLabel("포트", { exact: true }).fill(String(host.port));
  if (host.username !== undefined) await dialog.getByLabel("사용자", { exact: true }).fill(host.username);
  if (host.interactive) {
    await dialog.getByRole("tab", { name: "대화형" }).click();
  } else if (host.key) {
    // Keys live in the vault's key list. The form sends you to /keys to import and pick one,
    // then comes back with what you typed.
    await dialog.getByRole("tab", { name: "개인키" }).click();
    await importKey(dialog.page(), host.key, { pick: true });
  } else if (host.password !== undefined) {
    await dialog.getByRole("tab", { name: "비밀번호" }).click();
    await dialog.locator("input[type=password]").fill(host.password);
  }
}

export async function addHost(page: Page, host: HostInput) {
  await page.getByRole("button", { name: "호스트 추가" }).first().click();
  const dialog = page.getByRole("dialog", { name: "호스트 추가" });
  await fillHostForm(dialog, host);
  await dialog.getByRole("button", { name: "저장" }).click();
  await expect(dialog).toBeHidden();
}

export const hostRow = (page: Page, name: string) => page.locator("aside li").filter({ hasText: name });

export async function openHost(page: Page, name: string) {
  await hostRow(page, name).locator("button").first().click();
}

export async function hostMenu(page: Page, name: string, item: "수정" | "삭제") {
  await page.getByRole("button", { name: `${name} 메뉴` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

export const firstKeyDialog = (page: Page) => page.getByRole("dialog", { name: "처음 접속하는 호스트입니다" });
export const changedKeyDialog = (page: Page) => page.getByRole("dialog", { name: "호스트 키가 바뀌었습니다" });
export const kbdDialog = (page: Page) => page.getByRole("dialog", { name: "fake-kbd-title" });

export async function acceptFirstKey(page: Page) {
  const dialog = firstKeyDialog(page);
  await dialog.getByRole("button", { name: "수락하고 접속" }).click();
  await expect(dialog).toBeHidden();
}

export const terminalAlert = (page: Page, text: string) => page.getByRole("alert").filter({ hasText: text });

export type Frame = { dir: "sent" | "received"; text: string | null; bytes: number };

/** Records every frame on the app's gateway socket, in order. */
export function recordGatewayFrames(page: Page) {
  const frames: Frame[] = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/ws") return;
    const add = (dir: Frame["dir"], payload: string | Buffer) => {
      if (typeof payload === "string") frames.push({ dir, text: payload, bytes: payload.length });
      else frames.push({ dir, text: null, bytes: payload.length });
    };
    socket.on("framesent", ({ payload }) => add("sent", payload));
    socket.on("framereceived", ({ payload }) => add("received", payload));
  });
  return frames;
}

export function sentMessages(frames: Frame[]) {
  return frames.filter((f) => f.dir === "sent" && f.text !== null).map((f) => JSON.parse(f.text!));
}
