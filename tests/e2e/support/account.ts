// Accounts for e2e runs. The app sends every page to /setup until setup is done and to
// /login until there is a session, and keeps each account's vault on the server.
// So the run marks setup done once, and every test gets its own fresh account and session.
import { randomBytes } from "node:crypto";
import { expect, type BrowserContext } from "@playwright/test";
import { APP_ORIGIN } from "./ports";

/** Not one of the fake secrets the plaintext scan looks for: it never reaches a vault. */
export const ACCOUNT_PASSWORD = "e2e-account-password";

let passwordHash: Promise<string> | undefined;

async function database() {
  // Imported late: db.ts reads PSWRSH_DATA_DIR when it loads, and global setup sets it.
  if (!process.env.PSWRSH_DATA_DIR) throw new Error("PSWRSH_DATA_DIR is not set; run through playwright test");
  return (await import("../../../src/server/db.ts")).db();
}

/** Run once before the app starts: no setup screen, no setup token. */
export async function completeSetup() {
  (await database()).prepare("UPDATE setup_state SET completed_at = ? WHERE id = 1").run(Date.now());
}

/** A new account with no vault, no settings and no sessions. */
export async function seedAccount(email = `e2e-${randomBytes(6).toString("hex")}@example.com`) {
  const { hashPassword } = await import("../../../src/server/password.ts");
  passwordHash ??= hashPassword(ACCOUNT_PASSWORD);
  const result = (await database())
    .prepare("INSERT INTO users (email, password_hash, is_admin, created_at) VALUES (?, ?, 0, ?)")
    .run(email, await passwordHash, Date.now());
  return { id: Number(result.lastInsertRowid), email, password: ACCOUNT_PASSWORD };
}

/** Logs the context in through /api/login, as the login form does. The cookie lands in the context. */
export async function logIn(context: BrowserContext, account: { email: string; password: string }) {
  const response = await context.request.post("/api/login", { data: { email: account.email, password: account.password } });
  expect(response.status(), await response.text()).toBe(200);
}

/** A second device of the same account: its own browser storage, its own session. */
export async function newDevice(context: BrowserContext, account: { email: string; password: string }) {
  const browser = context.browser()!;
  const device = await browser.newContext({ baseURL: APP_ORIGIN, viewport: { width: 1280, height: 800 } });
  await logIn(device, account);
  return device;
}
