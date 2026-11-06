// Starts `pnpm dev` the way the README says, captures its output for the log scan,
// and returns the teardown that brings it down and proves the ports are closed.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";
import { newKeyPair } from "./support/dummy-ssh";

const ROOT = resolve(__dirname, "../..");
const ARTIFACTS = resolve(ROOT, "tests/.artifacts");
import { APP_PORT, GATEWAY_PORT } from "./support/ports";

function portOpen(port: number) {
  return new Promise<boolean>((done) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

async function waitFor(check: () => Promise<boolean>, what: string, ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export default async function globalSetup() {
  rmSync(ARTIFACTS, { recursive: true, force: true });
  mkdirSync(ARTIFACTS, { recursive: true });
  for (const port of [APP_PORT, GATEWAY_PORT]) {
    if (await portOpen(port)) throw new Error(`port ${port} is already in use`);
  }

  const logPath = resolve(ARTIFACTS, "app.log");
  const markerPath = resolve(ARTIFACTS, "started.marker");
  writeFileSync(markerPath, "");
  const log = openSync(logPath, "a");

  // Spawned before the fake secrets enter this process's environment.
  // PSWRSH_TEST_APP=start runs the same cases against the production build.
  const app = spawn("pnpm", [process.env.PSWRSH_TEST_APP === "start" ? "start" : "dev"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", PORT: String(APP_PORT), PSWRSH_GATEWAY_PORT: String(GATEWAY_PORT) },
  });

  await waitFor(() => portOpen(GATEWAY_PORT), "gateway port");
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${APP_PORT}/`)).ok;
    } catch {
      return false;
    }
  }, "app page");

  // Generated per run so nothing in the repo or an old log can match the scan.
  const run = randomBytes(6).toString("hex");
  const keyPassphrase = `fake-keypass-${run}`;
  const plainKey = newKeyPair();
  const lockedKey = newKeyPair({ passphrase: keyPassphrase });
  process.env.PSWRSH_TEST_RUN = run;
  process.env.PSWRSH_TEST_KEY_PRIVATE = plainKey.private;
  process.env.PSWRSH_TEST_KEY_PUBLIC = plainKey.public;
  process.env.PSWRSH_TEST_LOCKED_KEY_PRIVATE = lockedKey.private;
  process.env.PSWRSH_TEST_LOCKED_KEY_PUBLIC = lockedKey.public;
  process.env.PSWRSH_TEST_LOG = logPath;
  process.env.PSWRSH_TEST_MARKER = markerPath;
  process.env.PSWRSH_TEST_ARTIFACTS = ARTIFACTS;
  process.env.PSWRSH_TEST_ROOT = ROOT;

  return async () => {
    const pgid = app.pid!;
    try {
      process.kill(-pgid, "SIGTERM");
    } catch {}
    const closed = async () => !(await portOpen(APP_PORT)) && !(await portOpen(GATEWAY_PORT));
    try {
      await waitFor(closed, "ports to close", 10_000);
    } catch {
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {}
      await waitFor(closed, "ports to close after SIGKILL", 10_000);
    }
    console.log(`app stopped: ports ${APP_PORT} and ${GATEWAY_PORT} are closed`);
  };
}
