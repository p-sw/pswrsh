// The `test` every spec uses: each test runs as a new, logged-in account,
// so the first screen is the vault screen and no vault leaks between tests.
import { test as base } from "@playwright/test";
import { logIn, seedAccount } from "./account";

export { expect } from "@playwright/test";
export type { BrowserContext, Page } from "@playwright/test";

export const test = base.extend<{ account: { id: number; email: string; password: string } }>({
  account: async ({}, use) => {
    await use(await seedAccount());
  },
  context: async ({ context, account }, use) => {
    await logIn(context, account);
    await use(context);
  },
});
