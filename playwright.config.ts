import { defineConfig } from "@playwright/test";
import { APP_ORIGIN } from "./tests/e2e/support/ports";

// One worker: all cases share one `pnpm dev`, and the plaintext scan must run last.
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "tests/.artifacts/results",
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "tests/.artifacts/report.json" }]],
  use: {
    baseURL: APP_ORIGIN,
    viewport: { width: 1280, height: 800 },
    // Traces and videos would record the fake secrets the plaintext scan looks for.
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
