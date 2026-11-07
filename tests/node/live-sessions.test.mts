// Unit tests for the gateway's session registry (gateway/live-sessions.mts).
// No sockets or SSH: sessions are plain fakes; time runs on node:test mock timers.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, describe, mock, test } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pswrsh-unit-"));
process.env.PSWRSH_DATA_DIR = dataDir;
delete process.env.PSWRSH_IDLE_UNIT_MS;

const reg = await import("../../gateway/live-sessions.mts");
const { db } = await import("../../src/server/db.ts");

const OPEN = 1; // WebSocket.OPEN
const CLOSED = 3;

let seq = 0;
function fake(accountId: number, name: string, extra: Record<string, unknown> = {}) {
  const session = {
    id: `s${++seq}`,
    accountId,
    name,
    hostId: "",
    startedAt: 0,
    lastInputAt: 0,
    ready: true,
    viewers: new Set<{ readyState: number }>(),
    idle: null as NodeJS.Timeout | null,
    idleAt: null as number | null,
    scrollback: [] as Buffer[],
    scrollbackBytes: 0,
    destroyed: 0,
    destroy() {
      session.destroyed += 1;
      reg.dropSession(session.id);
    },
    ...extra,
  };
  return session;
}
const added: { id: string }[] = [];
function add(session: ReturnType<typeof fake>) {
  reg.addSession(session as never);
  added.push(session);
  return session;
}

function user(id: number, keepAlive?: number) {
  db().prepare("INSERT OR REPLACE INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', 0)").run(id, `u${id}@t.test`);
  if (keepAlive !== undefined) db().prepare("UPDATE users SET keep_alive_minutes = ? WHERE id = ?").run(keepAlive, id);
}

afterEach(() => {
  for (const s of added.splice(0)) reg.dropSession(s.id);
  delete process.env.PSWRSH_IDLE_UNIT_MS;
});
after(() => rmSync(dataDir, { recursive: true, force: true }));

describe("constants", () => {
  test("limit is 20 connections and names are capped at 80 chars", () => {
    assert.equal(reg.SESSION_LIMIT, 20);
    assert.equal(reg.NAME_MAX, 80);
  });
});

describe("countFor", () => {
  test("counts only the given account's sessions, ready or not", () => {
    add(fake(1, "a"));
    add(fake(1, "b", { ready: false }));
    add(fake(2, "c"));
    assert.equal(reg.countFor(1), 2);
    assert.equal(reg.countFor(2), 1);
    assert.equal(reg.countFor(3), 0);
  });

  test("drops back after a session is removed", () => {
    const s = add(fake(1, "a"));
    reg.dropSession(s.id);
    assert.equal(reg.countFor(1), 0);
  });

  test("dropSession on an unknown id is a no-op", () => {
    assert.doesNotThrow(() => reg.dropSession("nope"));
  });
});

describe("uniqueName", () => {
  test("returns the base when nobody uses it", () => {
    assert.equal(reg.uniqueName(1, "web"), "web");
  });
  test("appends (2), (3) for repeats in the same account", () => {
    add(fake(1, "web"));
    assert.equal(reg.uniqueName(1, "web"), "web (2)");
    add(fake(1, "web (2)"));
    assert.equal(reg.uniqueName(1, "web"), "web (3)");
  });
  test("fills the first free gap", () => {
    add(fake(1, "web"));
    add(fake(1, "web (3)"));
    assert.equal(reg.uniqueName(1, "web"), "web (2)");
  });
  test("ignores other accounts' names", () => {
    add(fake(2, "web"));
    assert.equal(reg.uniqueName(1, "web"), "web");
  });
});

describe("nameTaken", () => {
  test("true when another session of the account has the name", () => {
    add(fake(1, "web"));
    const me = add(fake(1, "db"));
    assert.equal(reg.nameTaken(1, "web", me.id), true);
  });
  test("false for the session's own current name", () => {
    const me = add(fake(1, "web"));
    assert.equal(reg.nameTaken(1, "web", me.id), false);
  });
  test("false when only another account has the name", () => {
    add(fake(2, "web"));
    const me = add(fake(1, "db"));
    assert.equal(reg.nameTaken(1, "web", me.id), false);
  });
  test("is case-sensitive (\"Web\" and \"web\" are different)", () => {
    add(fake(1, "web"));
    const me = add(fake(1, "db"));
    assert.equal(reg.nameTaken(1, "Web", me.id), false);
  });
});

describe("ownedSession", () => {
  test("returns the session for its owner", () => {
    const s = add(fake(1, "a"));
    assert.equal(reg.ownedSession(1, s.id), s);
  });
  test("returns null for another account (no cross-account access)", () => {
    const s = add(fake(1, "a"));
    assert.equal(reg.ownedSession(2, s.id), null);
  });
  test("returns null for an unknown id", () => {
    assert.equal(reg.ownedSession(1, "missing"), null);
  });
});

describe("closeAccount", () => {
  test("destroys every session of the account and none of the others", () => {
    const a = add(fake(1, "a"));
    const b = add(fake(1, "b"));
    const c = add(fake(2, "c"));
    reg.closeAccount(1);
    assert.deepEqual([a.destroyed, b.destroyed, c.destroyed], [1, 1, 0]);
    assert.equal(reg.countFor(1), 0);
    assert.equal(reg.countFor(2), 1);
  });
});

describe("idleUnitMs", () => {
  const cases: [string | undefined, number][] = [
    [undefined, 60_000],
    ["1000", 1000],
    ["0", 60_000],
    ["-5", 60_000],
    ["abc", 60_000],
    ["Infinity", 60_000],
    ["0.5", 0.5],
  ];
  for (const [value, expected] of cases) {
    test(`PSWRSH_IDLE_UNIT_MS=${value} -> ${expected}`, () => {
      if (value === undefined) delete process.env.PSWRSH_IDLE_UNIT_MS;
      else process.env.PSWRSH_IDLE_UNIT_MS = value;
      assert.equal(reg.idleUnitMs(), expected);
    });
  }
});

describe("keepAliveMinutes", () => {
  test("reads the account setting", () => {
    user(10, 5);
    assert.equal(reg.keepAliveMinutes(10), 5);
  });
  test("falls back to 30 for an unknown account", () => {
    assert.equal(reg.keepAliveMinutes(9999), 30);
  });
  test("falls back to 30 for zero or negative values", () => {
    user(11, 0);
    assert.equal(reg.keepAliveMinutes(11), 30);
    user(12, -3);
    assert.equal(reg.keepAliveMinutes(12), 30);
  });
});

describe("armIdle / clearIdle (keep-alive countdown)", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 }));
  afterEach(() => mock.timers.reset());

  test("sets idleAt to now + keepAlive * unit", () => {
    user(20, 3);
    process.env.PSWRSH_IDLE_UNIT_MS = "1000";
    const s = add(fake(20, "a"));
    reg.armIdle(s as never);
    assert.equal(s.idleAt, 1_000_000 + 3000);
  });

  test("does not destroy one tick before the deadline, destroys at it", () => {
    user(21, 2);
    process.env.PSWRSH_IDLE_UNIT_MS = "1000";
    const s = add(fake(21, "a"));
    reg.armIdle(s as never);
    mock.timers.tick(1999);
    assert.equal(s.destroyed, 0);
    mock.timers.tick(1);
    assert.equal(s.destroyed, 1);
    assert.equal(s.idleAt, null);
    assert.equal(reg.countFor(21), 0);
  });

  test("clearIdle cancels the pending close and clears idleAt", () => {
    user(22, 1);
    process.env.PSWRSH_IDLE_UNIT_MS = "1000";
    const s = add(fake(22, "a"));
    reg.armIdle(s as never);
    reg.clearIdle(s as never);
    mock.timers.tick(10_000);
    assert.equal(s.destroyed, 0);
    assert.equal(s.idleAt, null);
  });

  test("re-arming replaces the old timer (only one close, at the new deadline)", () => {
    user(23, 2);
    process.env.PSWRSH_IDLE_UNIT_MS = "1000";
    const s = add(fake(23, "a"));
    reg.armIdle(s as never);
    mock.timers.tick(1500);
    reg.armIdle(s as never);
    mock.timers.tick(1000); // first deadline passed
    assert.equal(s.destroyed, 0);
    mock.timers.tick(1000);
    assert.equal(s.destroyed, 1);
  });

  test("dropSession clears a pending timer", () => {
    user(24, 1);
    process.env.PSWRSH_IDLE_UNIT_MS = "1000";
    const s = add(fake(24, "a"));
    reg.armIdle(s as never);
    reg.dropSession(s.id);
    mock.timers.tick(5000);
    assert.equal(s.destroyed, 0);
  });
});

describe("listSessions", () => {
  test("lists only ready sessions of the account", () => {
    add(fake(1, "ready"));
    add(fake(1, "pending", { ready: false }));
    add(fake(2, "other"));
    assert.deepEqual(reg.listSessions(1).map((s) => s.name), ["ready"]);
  });

  test("attached session: status attached, viewers counts only OPEN sockets, expiresAt null", () => {
    const s = add(fake(1, "a", { hostId: "h1" }));
    s.viewers.add({ readyState: OPEN });
    s.viewers.add({ readyState: OPEN });
    s.viewers.add({ readyState: CLOSED });
    s.idleAt = 123; // even a stale idleAt must not show while attached
    const [listed] = reg.listSessions(1);
    assert.equal(listed.status, "attached");
    assert.equal(listed.viewers, 2);
    assert.equal(listed.expiresAt, null);
    assert.equal(listed.hostId, "h1");
  });

  test("detached session with a timer: expiresAt is the ISO deadline", () => {
    const s = add(fake(1, "a"));
    s.idleAt = Date.UTC(2026, 10, 7, 3, 0, 0);
    const [listed] = reg.listSessions(1);
    assert.equal(listed.status, "detached");
    assert.equal(listed.viewers, 0);
    assert.equal(listed.expiresAt, "2026-11-07T03:00:00.000Z");
  });

  test("detached session without a timer: expiresAt null", () => {
    add(fake(1, "a"));
    assert.equal(reg.listSessions(1)[0].expiresAt, null);
  });

  test("only CLOSED sockets left counts as detached", () => {
    const s = add(fake(1, "a"));
    s.viewers.add({ readyState: CLOSED });
    assert.equal(reg.listSessions(1)[0].status, "detached");
  });
});

describe("scrollback", () => {
  test("keeps everything under 256 KiB", () => {
    const s = fake(1, "a");
    reg.pushScrollback(s as never, Buffer.from("hello "));
    reg.pushScrollback(s as never, Buffer.from("world"));
    assert.equal(reg.scrollbackSnapshot(s as never).toString(), "hello world");
  });

  test("trims the oldest bytes past 256 KiB and keeps the newest", () => {
    const s = fake(1, "a");
    const limit = 256 * 1024;
    reg.pushScrollback(s as never, Buffer.alloc(limit, "a"));
    reg.pushScrollback(s as never, Buffer.from("XYZ"));
    const snap = reg.scrollbackSnapshot(s as never);
    assert.equal(snap.length, limit);
    assert.equal(snap.subarray(-3).toString(), "XYZ");
    assert.equal(s.scrollbackBytes, limit);
  });

  test("a single chunk larger than the limit is cut to its tail", () => {
    const s = fake(1, "a");
    const limit = 256 * 1024;
    const big = Buffer.concat([Buffer.alloc(10, "x"), Buffer.alloc(limit, "y")]);
    reg.pushScrollback(s as never, big);
    const snap = reg.scrollbackSnapshot(s as never);
    assert.equal(snap.length, limit);
    assert.ok(!snap.includes("x"));
  });
});
