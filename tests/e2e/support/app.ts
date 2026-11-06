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

export type HostInput = {
  name?: string;
  hostname: string;
  port?: number;
  username: string;
  password?: string;
  key?: { privateKey?: string; file?: string; passphrase?: string };
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
    await dialog.getByRole("tab", { name: "개인키" }).click();
    if (host.key.privateKey !== undefined) await dialog.locator("textarea").fill(host.key.privateKey);
    if (host.key.file !== undefined) await dialog.locator("input[type=file]").setInputFiles(host.key.file);
    if (host.key.passphrase !== undefined) await dialog.locator("input[type=password]").fill(host.key.passphrase);
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
