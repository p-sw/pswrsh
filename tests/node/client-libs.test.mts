// Unit tests for browser-side helpers that need no DOM rendering:
// remainingLabel (src/lib/live-sessions.ts) and the terminal style store.
// fetch, document and timers are fakes; nothing touches the network.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { remainingLabel } from "../../src/lib/live-sessions.ts";

describe("remainingLabel", () => {
  const now = Date.UTC(2026, 10, 7, 0, 0, 0);
  const at = (ms: number) => new Date(now + ms).toISOString();
  const cases: [string, number, string][] = [
    ["already expired", -5000, "0초"],
    ["exactly now", 0, "0초"],
    ["1 ms left rounds up to 1초", 1, "1초"],
    ["59초", 59_000, "59초"],
    ["59.001 s rounds up to 1분 0초", 59_001, "1분 0초"],
    ["60 s", 60_000, "1분 0초"],
    ["12분 30초", 750_000, "12분 30초"],
    ["59분 59초", 3_599_000, "59분 59초"],
    ["1 hour drops seconds", 3_600_000, "1시간 0분"],
    ["1시간 1분 (seconds hidden)", 3_661_000, "1시간 1분"],
    ["25 hours", 90_000_000, "25시간 0분"],
  ];
  for (const [label, delta, expected] of cases) {
    test(`${label} -> "${expected}"`, () => assert.equal(remainingLabel(at(delta), now), expected));
  }

  test("counts down by one second per second", () => {
    const exp = at(10_000);
    assert.deepEqual(
      [0, 1000, 2000, 9000, 10_000].map((t) => remainingLabel(exp, now + t)),
      ["10초", "9초", "8초", "1초", "0초"],
    );
  });

  test("an unparseable expiresAt does not render NaN", () => {
    assert.doesNotMatch(remainingLabel("garbage", now), /NaN/);
  });
});

// --- terminal style store ---------------------------------------------------------

type Style = { font: string; size: number | null; weight: number; theme: string };
const DEFAULT: Style = { font: "system", size: null, weight: 400, theme: "default" };

let fresh = 0;
async function loadStore() {
  // A query string gives each test its own module instance (module-level state).
  return import(`../../src/lib/terminal-style-store.ts?i=${++fresh}`) as Promise<
    typeof import("../../src/lib/terminal-style-store.ts")
  >;
}

type Pending = { resolve: (body: unknown) => void; reject: (e: unknown) => void; status: number };
let calls: Pending[] = [];
function fakeFetch() {
  calls = [];
  globalThis.fetch = (() =>
    new Promise((resolve, reject) => {
      const p: Pending = {
        status: 200,
        resolve: (body) => resolve({ ok: p.status < 400, status: p.status, json: async () => body } as Response),
        reject,
      };
      calls.push(p);
    })) as typeof fetch;
}
const settings = (terminalStyle: unknown) => ({ settings: { terminalStyle } });
const flush = () => new Promise((r) => setImmediate(r));

class FakeDocument extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { document?: unknown }).document;
});

describe("terminal style store", () => {
  const SAVED: Style = { font: "system", size: 16, weight: 400, theme: "default" };
  const OTHER: Style = { font: "system", size: 18, weight: 400, theme: "default" };

  test("starts with the default style", async () => {
    const store = await loadStore();
    assert.deepEqual(store.getTerminalStyle(), DEFAULT);
  });

  test("terminalStyleReady applies the account's style and notifies subscribers", async () => {
    fakeFetch();
    const store = await loadStore();
    let notified = 0;
    store.subscribeTerminalStyle(() => notified++);
    const ready = store.terminalStyleReady();
    calls[0].resolve(settings(SAVED));
    await ready;
    assert.deepEqual(store.getTerminalStyle(), SAVED);
    assert.equal(notified, 1);
  });

  test("terminalStyleReady fetches only once per page", async () => {
    fakeFetch();
    const store = await loadStore();
    const a = store.terminalStyleReady();
    calls[0].resolve(settings(SAVED));
    await a;
    await store.terminalStyleReady();
    assert.equal(calls.length, 1);
  });

  test("concurrent refreshes share one request", async () => {
    fakeFetch();
    const store = await loadStore();
    const a = store.refreshTerminalStyle();
    const b = store.refreshTerminalStyle();
    assert.equal(a, b);
    assert.equal(calls.length, 1);
    calls[0].resolve(settings(SAVED));
    await a;
  });

  test("a refresh after the previous one finished fetches again", async () => {
    fakeFetch();
    const store = await loadStore();
    const a = store.refreshTerminalStyle();
    calls[0].resolve(settings(SAVED));
    await a;
    store.refreshTerminalStyle();
    assert.equal(calls.length, 2);
  });

  const ignored: [string, (p: Pending) => void][] = [
    ["an invalid style", (p) => p.resolve(settings({ font: "nope", size: 99, weight: 1, theme: "x" }))],
    ["no style at all", (p) => p.resolve({})],
    ["HTTP 500", (p) => { p.status = 500; p.resolve({}); }],
    ["a network error", (p) => p.reject(new Error("offline"))],
  ];
  for (const [label, answer] of ignored) {
    test(`${label} keeps the current style and resolves`, async () => {
      fakeFetch();
      const store = await loadStore();
      const r = store.refreshTerminalStyle();
      answer(calls[0]);
      await r;
      assert.deepEqual(store.getTerminalStyle(), DEFAULT);
    });
  }

  test("the same style again does not re-notify subscribers", async () => {
    const store = await loadStore();
    let notified = 0;
    store.subscribeTerminalStyle(() => notified++);
    store.setTerminalStyle({ ...SAVED });
    store.setTerminalStyle({ ...SAVED });
    assert.equal(notified, 1);
  });

  test("unsubscribe stops notifications", async () => {
    const store = await loadStore();
    let notified = 0;
    const off = store.subscribeTerminalStyle(() => notified++);
    off();
    store.setTerminalStyle(SAVED);
    assert.equal(notified, 0);
  });

  test("a save in one tab switches another tab's style right away (BroadcastChannel)", async () => {
    fakeFetch();
    (globalThis as { document?: unknown }).document = new FakeDocument();
    const saver = await loadStore();
    const other = await loadStore();
    const stop = other.watchTerminalStyle();
    calls[0].resolve(settings(DEFAULT));
    await flush();
    saver.setTerminalStyle(OTHER);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(other.getTerminalStyle(), OTHER);
    stop();
  });

  test("a garbage broadcast is ignored", async () => {
    fakeFetch();
    (globalThis as { document?: unknown }).document = new FakeDocument();
    const store = await loadStore();
    const stop = store.watchTerminalStyle();
    calls[0].resolve(settings(SAVED));
    await flush();
    const ch = new BroadcastChannel("pswrsh-terminal-style");
    ch.postMessage({ font: 1 });
    ch.close();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(store.getTerminalStyle(), SAVED);
    stop();
  });

  test("coming back to the foreground refetches; going hidden does not", async () => {
    fakeFetch();
    const doc = new FakeDocument();
    (globalThis as { document?: unknown }).document = doc;
    const store = await loadStore();
    const stop = store.watchTerminalStyle();
    calls[0].resolve(settings(DEFAULT));
    await flush();
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(calls.length, 1);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(calls.length, 2);
    calls[1].resolve(settings(OTHER));
    await flush();
    assert.deepEqual(store.getTerminalStyle(), OTHER);
    stop();
  });

  test("after cleanup, visibility changes and broadcasts are ignored", async () => {
    fakeFetch();
    const doc = new FakeDocument();
    (globalThis as { document?: unknown }).document = doc;
    const store = await loadStore();
    const stop = store.watchTerminalStyle();
    calls[0].resolve(settings(DEFAULT));
    await flush();
    stop();
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(calls.length, 1);
  });

  test(
    "a refresh that started before a save does not undo the save",
    async () => {
      fakeFetch();
      const store = await loadStore();
      const r = store.refreshTerminalStyle(); // e.g. tab became visible
      store.setTerminalStyle(OTHER); // user saves on the settings page
      calls[0].resolve(settings(SAVED)); // server answered the GET with the pre-save value
      await r;
      assert.deepEqual(store.getTerminalStyle(), OTHER);
    },
  );
});
