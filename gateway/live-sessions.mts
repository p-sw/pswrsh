// SSH sessions owned by the gateway. A dropped WebSocket does not close SSH.
// The private key is never stored here. Restarting the process drops every session.
import { WebSocket } from "ws";
import { db } from "../src/server/db.ts";

export const SESSION_LIMIT = 10;
const SCROLLBACK_LIMIT = 256 * 1024;

export type ListedSession = {
  id: string;
  name: string;
  status: "attached" | "detached";
  startedAt: string;
  lastInputAt: string;
};

export type LiveSession = {
  id: string;
  accountId: number;
  name: string;
  startedAt: number;
  lastInputAt: number;
  ready: boolean;
  ws: WebSocket | null;
  idle: NodeJS.Timeout | null;
  scrollback: Buffer[];
  scrollbackBytes: number;
  write: (data: Buffer) => void;
  resize: (cols: number, rows: number) => void;
  ack: (bytes: number) => void;
  bind: (socket: WebSocket) => void;
  detach: () => void;
  destroy: () => void;
};

const sessions = new Map<string, LiveSession>();

/** Milliseconds per keep-alive minute. The product setting stays in minutes. */
export function idleUnitMs() {
  const parsed = Number(process.env.PSWRSH_IDLE_UNIT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

export function keepAliveMinutes(accountId: number) {
  const row = db().prepare("SELECT keep_alive_minutes FROM users WHERE id = ?").get(accountId) as
    | { keep_alive_minutes: number }
    | undefined;
  const minutes = row?.keep_alive_minutes;
  return typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0 ? minutes : 30;
}

export function countFor(accountId: number) {
  let count = 0;
  for (const session of sessions.values()) if (session.accountId === accountId) count += 1;
  return count;
}

export function addSession(session: LiveSession) {
  sessions.set(session.id, session);
}

export function dropSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  if (session.idle) clearTimeout(session.idle);
  session.idle = null;
  sessions.delete(id);
}

export function ownedSession(accountId: number, id: string) {
  const session = sessions.get(id);
  if (!session || session.accountId !== accountId) return null;
  return session;
}

export function closeAccount(accountId: number) {
  for (const session of [...sessions.values()]) {
    if (session.accountId === accountId) session.destroy();
  }
}

export function pushScrollback(session: LiveSession, chunk: Buffer) {
  session.scrollback.push(chunk);
  session.scrollbackBytes += chunk.length;
  while (session.scrollbackBytes > SCROLLBACK_LIMIT && session.scrollback.length > 0) {
    const first = session.scrollback[0];
    const extra = session.scrollbackBytes - SCROLLBACK_LIMIT;
    if (first.length <= extra) {
      session.scrollback.shift();
      session.scrollbackBytes -= first.length;
    } else {
      session.scrollback[0] = first.subarray(extra);
      session.scrollbackBytes -= extra;
    }
  }
}

export function scrollbackSnapshot(session: LiveSession) {
  return Buffer.concat(session.scrollback);
}

export function clearIdle(session: LiveSession) {
  if (!session.idle) return;
  clearTimeout(session.idle);
  session.idle = null;
}

/** The account's keep-alive is read when the socket drops, not while it is attached. */
export function armIdle(session: LiveSession) {
  clearIdle(session);
  const delay = keepAliveMinutes(session.accountId) * idleUnitMs();
  session.idle = setTimeout(() => {
    session.idle = null;
    session.destroy();
  }, delay);
}

export function listSessions(accountId: number): ListedSession[] {
  const list: ListedSession[] = [];
  for (const session of sessions.values()) {
    if (session.accountId !== accountId || !session.ready) continue;
    list.push({
      id: session.id,
      name: session.name,
      status: session.ws?.readyState === WebSocket.OPEN ? "attached" : "detached",
      startedAt: new Date(session.startedAt).toISOString(),
      lastInputAt: new Date(session.lastInputAt).toISOString(),
    });
  }
  return list;
}
