// Integration tests for the SSH gateway's HTTP + WebSocket API (gateway/server.mts).
// Real gateway process, real SQLite in a temp dir, throwaway SSH server on loopback.
// No Next.js and no browser. Keep-alive minutes run as 1 s (PSWRSH_IDLE_UNIT_MS=1000).
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, afterEach, before, describe, test } from "node:test";
import { WebSocket } from "ws";

const ROOT = resolve(import.meta.dirname, "../..");
const dataDir = mkdtempSync(join(tmpdir(), "pswrsh-gw-"));
process.env.PSWRSH_DATA_DIR = dataDir;
const { db } = await import("../../src/server/db.ts");
const { createSession } = await import("../../src/server/sessions.ts");
const { DummySsh } = await import("../e2e/support/dummy-ssh.ts");

async function freePort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

const APP_PORT = await freePort();
const ORIGIN = `http://127.0.0.1:${APP_PORT}`;
let GW = 0;
let gateway: ChildProcess;
let gatewayLog = "";
let gatewayExit: number | null | undefined;
const ssh = new DummySsh();

async function startGateway() {
  GW = await freePort();
  gatewayLog = "";
  gatewayExit = undefined;
  gateway = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "gateway/server.mts"],
    {
      cwd: ROOT,
      env: { ...process.env, PORT: String(APP_PORT), PSWRSH_GATEWAY_PORT: String(GW), PSWRSH_DATA_DIR: dataDir, PSWRSH_IDLE_UNIT_MS: "1000" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  gateway.stdout!.on("data", (d) => (gatewayLog += d));
  gateway.stderr!.on("data", (d) => (gatewayLog += d));
  gateway.on("exit", (code) => (gatewayExit = code));
  const end = Date.now() + 15_000;
  while (!gatewayLog.includes("listening")) {
    if (gatewayExit !== undefined || Date.now() > end) throw new Error("gateway did not start:\n" + gatewayLog);
    await new Promise((r) => setTimeout(r, 50));
  }
}

let nextUser = 1;
/** A fresh account plus one login cookie ("device"). */
function account(keepAliveMinutes = 30) {
  const id = nextUser++;
  db().prepare("INSERT INTO users (id, email, password_hash, created_at, keep_alive_minutes) VALUES (?, ?, 'x', 0, ?)").run(id, `g${id}@t.test`, keepAliveMinutes);
  return { id, cookie: device(id) };
}
function device(userId: number) {
  return `pswrsh_session=${encodeURIComponent(createSession(userId).token)}`;
}

type Res = { status: number; body: any };
function http(method: string, path: string, cookie: string | null, opts: { origin?: string | null; body?: string } = {}): Promise<Res> {
  return new Promise((done, fail) => {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    const origin = opts.origin === undefined ? ORIGIN : opts.origin;
    if (origin) headers.origin = origin;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const req = httpRequest({ host: "127.0.0.1", port: GW, method, path, headers }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => {
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {}
        done({ status: res.statusCode!, body });
      });
    });
    req.on("error", fail);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
const list = async (cookie: string) => (await http("GET", "/api/sessions", cookie)).body as { sessions: any[]; limit: number };
const rename = (cookie: string, id: string, body: unknown, origin?: string | null) =>
  http("PATCH", `/api/sessions/${encodeURIComponent(id)}`, cookie, { origin, body: typeof body === "string" ? body : JSON.stringify(body) });

/** A browser socket that records every JSON message. */
class Client {
  ws: WebSocket;
  messages: any[] = [];
  closed = false;
  private waiters: (() => void)[] = [];
  constructor(cookie: string, origin = ORIGIN) {
    this.ws = new WebSocket(`ws://127.0.0.1:${GW}/ws`, { headers: { cookie, origin } });
    this.ws.on("message", (raw, binary) => {
      if (!binary) this.messages.push(JSON.parse(String(raw)));
      this.wake();
    });
    this.ws.on("close", () => {
      this.closed = true;
      this.wake();
    });
    this.ws.on("error", () => this.wake());
    sockets.push(this);
  }
  private wake() {
    for (const w of this.waiters.splice(0)) w();
  }
  opened() {
    return new Promise<void>((ok, fail) => {
      this.ws.once("open", () => ok());
      this.ws.once("error", fail);
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async waitFor(pred: (m: any) => boolean, ms = 8000) {
    const end = Date.now() + ms;
    for (;;) {
      const hit = this.messages.find(pred);
      if (hit) return hit;
      if (this.closed) throw new Error("socket closed; got " + JSON.stringify(this.messages));
      if (Date.now() > end) throw new Error("timeout; got " + JSON.stringify(this.messages));
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 100);
      });
    }
  }
  async waitClosed(ms = 5000) {
    const end = Date.now() + ms;
    while (!this.closed) {
      if (Date.now() > end) throw new Error("socket did not close");
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  close() {
    this.ws.close();
  }
}
const sockets: Client[] = [];

/** Opens one SSH connection through the gateway and returns its socket and id. */
async function connect(cookie: string, extra: Record<string, unknown> = {}) {
  const c = new Client(cookie);
  await c.opened();
  c.send({ t: "connect", host: "127.0.0.1", port: ssh.port, username: "tester", cols: 80, rows: 24, ...extra });
  const first = await c.waitFor((m) => m.t === "hostkey" || m.t === "error");
  if (first.t === "error") return { c, error: first };
  c.send({ t: "trust", auth: { type: "password", password: "pw" } });
  const ready = await c.waitFor((m) => m.t === "ready");
  return { c, id: ready.id as string, name: ready.name as string };
}
async function attach(cookie: string, id: string) {
  const c = new Client(cookie);
  await c.opened();
  c.send({ t: "attach", id });
  await c.waitFor((m) => m.t === "ready");
  return c;
}
async function until(check: () => Promise<boolean> | boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 50));
  }
}

before(async () => {
  await ssh.start();
  await startGateway();
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
});
after(async () => {
  gateway?.kill("SIGTERM");
  await ssh.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("auth", () => {
  test("GET /api/sessions without a login cookie -> 401", async () => {
    assert.equal((await http("GET", "/api/sessions", null)).status, 401);
  });
  test("WebSocket from a foreign Origin is refused", async () => {
    const { cookie } = account();
    const c = new Client(cookie, "https://evil.example");
    await assert.rejects(c.opened());
  });
});

describe("listing", () => {
  test("GET /api/sessions reports the limit (20)", async () => {
    const { cookie } = account();
    assert.deepEqual(await list(cookie), { sessions: [], limit: 20 });
  });

  test("the opening hostId is listed; it is cut at 100 chars", async () => {
    const { cookie } = account();
    await connect(cookie, { hostId: "host-abc" });
    await connect(cookie, { hostId: "x".repeat(150) });
    const ids = (await list(cookie)).sessions.map((s) => s.hostId).sort();
    assert.deepEqual(ids, ["host-abc", "x".repeat(100)]);
  });

  test("a non-string hostId is stored as empty", async () => {
    const { cookie } = account();
    await connect(cookie, { hostId: 42 });
    assert.equal((await list(cookie)).sessions[0].hostId, "");
  });

  test("connections opened from two devices of one account are listed on both (account-wide count)", async () => {
    const { id } = account();
    const phone = device(id);
    const laptop = device(id);
    await connect(phone, { hostId: "h1" });
    await connect(laptop, { hostId: "h1" });
    await connect(laptop, { hostId: "h2" });
    for (const cookie of [phone, laptop]) {
      const byHost = Object.groupBy((await list(cookie)).sessions, (s: any) => s.hostId);
      assert.equal(byHost.h1?.length, 2);
      assert.equal(byHost.h2?.length, 1);
    }
  });

  test("another account sees none of them", async () => {
    const a = account();
    const b = account();
    await connect(a.cookie);
    assert.equal((await list(b.cookie)).sessions.length, 0);
  });

  test("second connection to the same host gets a numbered name", async () => {
    const { cookie } = account();
    const one = await connect(cookie, { name: "web" });
    const two = await connect(cookie, { name: "web" });
    assert.deepEqual([one.name, two.name], ["web", "web (2)"]);
  });
});

describe("20-connection limit", () => {
  test("20th opens, 21st is refused with code limit and a guide message, then the socket closes", async () => {
    const { cookie } = account();
    for (let i = 0; i < 19; i++) assert.ok((await connect(cookie)).id, `connection ${i + 1}`);
    assert.ok((await connect(cookie)).id, "20th connection");
    const over = await connect(cookie);
    assert.equal(over.error?.code, "limit");
    assert.match(over.error?.message, /20개/);
    await over.c.waitClosed();
    assert.equal((await list(cookie)).sessions.length, 20);
  });

  test("the limit counts devices together and frees up after one is closed", async () => {
    const { id } = account();
    const a = device(id);
    const b = device(id);
    const opened: string[] = [];
    for (let i = 0; i < 20; i++) opened.push((await connect(i % 2 ? a : b)).id!);
    assert.equal((await connect(a)).error?.code, "limit");
    assert.equal((await http("DELETE", `/api/sessions/${opened[0]}`, b)).status, 200);
    await until(async () => (await list(a)).sessions.length === 19);
    assert.ok((await connect(a)).id, "a slot opens again after closing one");
  });

  test("one account at the limit does not block another account", async () => {
    const full = account();
    for (let i = 0; i < 20; i++) await connect(full.cookie);
    const other = account();
    assert.ok((await connect(other.cookie)).id);
  });

  test("sessions still in the SSH handshake count toward the limit", async () => {
    const { cookie } = account();
    for (let i = 0; i < 19; i++) await connect(cookie);
    // 20th: stop at the host-key prompt (not ready, not listed)
    const pending = new Client(cookie);
    await pending.opened();
    pending.send({ t: "connect", host: "127.0.0.1", port: ssh.port, username: "u", cols: 80, rows: 24 });
    await pending.waitFor((m) => m.t === "hostkey");
    assert.equal((await list(cookie)).sessions.length, 19);
    assert.equal((await connect(cookie)).error?.code, "limit");
  });
});

describe("rename: PATCH /api/sessions/:id", () => {
  test("renames, answers the trimmed name, and the list shows it", async () => {
    const { cookie } = account();
    const { id } = await connect(cookie);
    const res = await rename(cookie, id!, { name: "  prod db  " });
    assert.deepEqual([res.status, res.body], [200, { ok: true, name: "prod db" }]);
    assert.equal((await list(cookie)).sessions[0].name, "prod db");
  });

  test("every attached device gets a renamed message at once", async () => {
    const { id: user } = account();
    const phone = device(user);
    const laptop = device(user);
    const opened = await connect(phone);
    const viewer = await attach(laptop, opened.id!);
    await rename(laptop, opened.id!, { name: "shared" });
    for (const c of [opened.c, viewer]) assert.deepEqual(await c.waitFor((m) => m.t === "renamed"), { t: "renamed", name: "shared" });
  });

  test("a device that attaches after the rename gets the new name in ready", async () => {
    const { cookie } = account();
    const { id } = await connect(cookie);
    await rename(cookie, id!, { name: "after" });
    const late = new Client(cookie);
    await late.opened();
    late.send({ t: "attach", id });
    assert.equal((await late.waitFor((m) => m.t === "ready")).name, "after");
  });

  test("exactly 80 characters is accepted", async () => {
    const { cookie } = account();
    const { id } = await connect(cookie);
    assert.equal((await rename(cookie, id!, { name: "가".repeat(80) })).status, 200);
  });

  const bad: [string, unknown][] = [
    ["empty string", { name: "" }],
    ["only spaces", { name: "   " }],
    ["81 characters", { name: "a".repeat(81) }],
    ["a number", { name: 5 }],
    ["missing name", {}],
    ["invalid JSON", "{name:"],
    ["JSON null", "null"],
  ];
  for (const [label, body] of bad) {
    test(`${label} -> 400 bad_name, name unchanged`, async () => {
      const { cookie } = account();
      const { id, name } = await connect(cookie);
      const res = await rename(cookie, id!, body);
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "bad_name");
      assert.equal((await list(cookie)).sessions[0].name, name);
    });
  }

  test("a name another connection of the account uses -> 409", async () => {
    const { cookie } = account();
    await connect(cookie, { name: "web" });
    const { id } = await connect(cookie, { name: "db" });
    const res = await rename(cookie, id!, { name: "web" });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "name_taken");
  });

  test("renaming to its own current name is fine (200)", async () => {
    const { cookie } = account();
    const { id } = await connect(cookie, { name: "web" });
    assert.equal((await rename(cookie, id!, { name: "web" })).status, 200);
  });

  test("a name used only by another account is allowed", async () => {
    const a = account();
    const b = account();
    await connect(a.cookie, { name: "web" });
    const { id } = await connect(b.cookie, { name: "db" });
    assert.equal((await rename(b.cookie, id!, { name: "web" })).status, 200);
  });

  for (const [label, origin] of [
    ["no Origin header", null],
    ["a foreign Origin", "https://evil.example"],
    ["a lookalike Origin", `${ORIGIN}.evil.example`],
  ] as const) {
    test(`${label} -> 403 and no rename`, async () => {
      const { cookie } = account();
      const { id, name } = await connect(cookie);
      assert.equal((await rename(cookie, id!, { name: "pwned" }, origin)).status, 403);
      assert.equal((await list(cookie)).sessions[0].name, name);
    });
  }

  test("https://ssh.psw.kr is an allowed Origin", async () => {
    const { cookie } = account();
    const { id } = await connect(cookie);
    assert.equal((await rename(cookie, id!, { name: "ok" }, "https://ssh.psw.kr")).status, 200);
  });

  test("another account's connection -> 404", async () => {
    const a = account();
    const b = account();
    const { id } = await connect(a.cookie);
    assert.equal((await rename(b.cookie, id!, { name: "x" })).status, 404);
  });

  test("an unknown id -> 404", async () => {
    const { cookie } = account();
    assert.equal((await rename(cookie, "no-such-id", { name: "x" })).status, 404);
  });

  test("without a login -> 401", async () => {
    assert.equal((await http("PATCH", "/api/sessions/x", null, { body: '{"name":"x"}' })).status, 401);
  });

  test("a body over 4 KiB gets a 400 answer (not a dropped connection)", async () => {
    const { cookie } = account();
    const { id } = await connect(cookie);
    const res = await rename(cookie, id!, { name: "a", pad: "x".repeat(5000) }).catch((e: Error) => ({ status: -1, body: e.message }));
    assert.equal(res.status, 400, `got ${JSON.stringify(res)}`);
  });
});

describe("keep-alive countdown (expiresAt)", () => {
  test("attached: expiresAt is null", async () => {
    const { cookie } = account(2);
    await connect(cookie);
    const [s] = (await list(cookie)).sessions;
    assert.equal(s.status, "attached");
    assert.equal(s.expiresAt, null);
  });

  test("detached: expiresAt ~= now + keep-alive; re-attaching clears it; the session closes after it", async () => {
    const { cookie } = account(3); // 3 "minutes" = 3 s here
    const { c, id } = await connect(cookie);
    const before = Date.now();
    c.send({ t: "detach" });
    await until(async () => (await list(cookie)).sessions[0]?.status === "detached");
    const exp = Date.parse((await list(cookie)).sessions[0].expiresAt);
    assert.ok(exp >= before + 3000 - 50 && exp <= Date.now() + 3000 + 50, `expiresAt off: ${exp - before}ms`);

    const again = await attach(cookie, id!);
    const [s] = (await list(cookie)).sessions;
    assert.deepEqual([s.status, s.expiresAt], ["attached", null]);

    again.close();
    await until(async () => (await list(cookie)).sessions[0]?.status === "detached");
    await until(async () => (await list(cookie)).sessions.length === 0, 6000);
  });

  test("closing the socket without detach also starts the countdown", async () => {
    const { cookie } = account(5);
    const { c } = await connect(cookie);
    c.ws.terminate();
    await until(async () => (await list(cookie)).sessions[0]?.expiresAt !== null);
  });

  test("with two devices attached, one leaving keeps it attached (no countdown)", async () => {
    const { id: user } = account(5);
    const a = device(user);
    const opened = await connect(a);
    await attach(device(user), opened.id!);
    opened.c.send({ t: "detach" });
    await until(async () => (await list(a)).sessions[0]?.viewers === 1);
    const [s] = (await list(a)).sessions;
    assert.deepEqual([s.status, s.expiresAt], ["attached", null]);
  });
});

describe("robustness", () => {
  for (const method of ["PATCH", "DELETE"]) {
    test(`${method} with a malformed %-escape in the id answers 4xx and the gateway keeps running`, async () => {
      const { cookie } = account();
      const opened = await connect(cookie); // a bystander connection that must survive
      const res = await http(method, "/api/sessions/%E0%A4%A", cookie, { body: '{"name":"x"}' }).catch((e: Error) => ({ status: -1, body: e.message }));
      await new Promise((r) => setTimeout(r, 300));
      const alive = gatewayExit === undefined;
      const why = "gateway exited (code " + gatewayExit + "), response " + JSON.stringify(res) + ", bystander closed: " + opened.c.closed + "\n" + gatewayLog.slice(-400);
      if (!alive) await startGateway(); // leave a running gateway for later tests
      assert.ok(alive, why);
      assert.ok(res.status >= 400 && res.status < 500, why);
    });
  }
  test("a PATCH body over 4 KiB answers 400 instead of dropping the connection", async () => {
    const { cookie } = account();
    const opened = await connect(cookie);
    const res = await rename(cookie, opened.id!, JSON.stringify({ name: "x".repeat(8000) }));
    assert.equal(res.status, 400);
  });
});
