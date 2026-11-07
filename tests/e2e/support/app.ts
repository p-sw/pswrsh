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
    // Through the account menu, not page.goto: a reload locks the vault.
    await page.getByRole("button", { name: "계정", exact: true }).click();
    await page.getByRole("menuitem", { name: "키 관리" }).click();
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

export async function lock(page: Page) {
  await page.getByRole("button", { name: "잠금", exact: true }).click();
}

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
