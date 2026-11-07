// SSH gateway. The gateway owns the SSH session. The browser socket can drop
// without closing SSH. Never log or persist message contents: they can carry credentials.
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Socket } from "node:net";
import ssh2 from "ssh2";
import type { ClientChannel } from "ssh2";
import { WebSocket, WebSocketServer } from "ws";
import type { AuthPayload, ClientMessage, ErrorCode, ServerMessage } from "../src/lib/protocol";
import { ALLOWED_ORIGINS } from "../src/server/origins.ts";
import { findSession, readCookie, SESSION_COOKIE } from "../src/server/sessions.ts";
import {
  NAME_MAX,
  SESSION_LIMIT,
  addSession,
  armIdle,
  clearIdle,
  closeAccount,
  countFor,
  dropSession,
  listSessions,
  nameTaken,
  ownedSession,
  pushScrollback,
  scrollbackSnapshot,
  uniqueName,
  type LiveSession,
} from "./live-sessions.mts";

const { Client, utils } = ssh2;

const PORT = Number(process.env.PSWRSH_GATEWAY_PORT ?? 3101);
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const HIGH_WATER_BYTES = 1024 * 1024;
const LOW_WATER_BYTES = 256 * 1024;
const LIMIT_MESSAGE = `연결은 계정당 ${SESSION_LIMIT}개까지 열 수 있습니다. 연결 목록에서 쓰지 않는 연결을 끊고 다시 여세요.`;
const MAX_BODY_BYTES = 4096;

function loginUser(req: IncomingMessage) {
  try {
    return findSession(readCookie(req.headers.cookie, SESSION_COOKIE));
  } catch {
    return null;
  }
}

function fingerprintOf(key: Buffer): { algorithm: string; fingerprint: string } {
  const nameLength = key.readUInt32BE(0);
  const digest = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  return {
    algorithm: key.subarray(4, 4 + nameLength).toString("ascii"),
    fingerprint: `SHA256:${digest}`,
  };
}

function describeError(err: Error & { level?: string; code?: string }): { code: ErrorCode; message: string } {
  if (err.level === "client-authentication") {
    return { code: "auth", message: "서버가 인증을 거부했습니다." };
  }
  if (err.level === "client-timeout") {
    return { code: "timeout", message: "서버 응답이 없습니다." };
  }
  switch (err.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return { code: "network", message: "호스트 이름을 찾을 수 없습니다." };
    case "ECONNREFUSED":
      return { code: "network", message: "서버가 연결을 거부했습니다." };
    case "ETIMEDOUT":
      return { code: "timeout", message: "연결 시간이 초과되었습니다." };
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return { code: "network", message: "서버에 닿을 수 없습니다." };
    case "ECONNRESET":
      return { code: "network", message: "서버가 연결을 끊었습니다." };
  }
  if (err.level === "client-socket") {
    return { code: "network", message: "네트워크 오류로 연결하지 못했습니다." };
  }
  return { code: "protocol", message: "SSH 협상에 실패했습니다." };
}

function sendJson(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function handleSocket(ws: WebSocket, accountId: number) {
  let started = false;
  let finished = false;
  let username = "";
  let cols = 80;
  let rows = 24;
  let auth: AuthPayload | null = null;
  let verifyHost: ((ok: boolean) => void) | null = null;
  let finishKbd: ((answers: string[]) => void) | null = null;
  let conn: InstanceType<typeof Client> | null = null;
  let stream: ClientChannel | null = null;
  let connectTimer: NodeJS.Timeout | undefined;
  // Unacknowledged bytes per viewer. SSH pauses while any viewer is too far behind.
  const unacked = new Map<WebSocket, number>();
  let paused = false;
  let live: LiveSession | null = null;
  // A later socket can adopt an existing session. This socket follows `bound`.
  let bound: LiveSession | null = null;

  const current = () => bound ?? live;

  const finish = (message: ServerMessage) => {
    if (finished) return;
    finished = true;
    clearTimeout(connectTimer);
    // Before the session is ready only the opening socket is listening.
    const sockets = live && live.viewers.size > 0 ? [...live.viewers] : [ws];
    for (const socket of sockets) sendJson(socket, message);
    if (live) {
      clearIdle(live);
      live.viewers.clear();
      dropSession(live.id);
    }
    unacked.clear();
    stream = null;
    conn?.destroy();
    for (const socket of sockets) socket.close();
  };

  const resumeIfCaughtUp = () => {
    if (!paused || !stream) return;
    for (const bytes of unacked.values()) if (bytes >= LOW_WATER_BYTES) return;
    paused = false;
    stream.resume();
  };

  const forward = (data: Buffer) => {
    if (!live) return;
    pushScrollback(live, data);
    for (const socket of live.viewers) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      socket.send(data, { binary: true });
      const bytes = (unacked.get(socket) ?? 0) + data.length;
      unacked.set(socket, bytes);
      if (!paused && stream && bytes > HIGH_WATER_BYTES) {
        paused = true;
        stream.pause();
      }
    }
  };

  const kbdMethod = () => ({
    type: "keyboard-interactive" as const,
    username,
    prompt: (
      name: string,
      instructions: string,
      _lang: string,
      prompts: { prompt: string; echo?: boolean }[],
      answer: (answers: string[]) => void,
    ) => {
      if (prompts.length === 0) {
        answer([]);
        return;
      }
      finishKbd = answer;
      // Only the socket that opened the connection answers prompts.
      if (live?.viewers.has(ws)) {
        sendJson(ws, {
          t: "kbd",
          name,
          instructions,
          prompts: prompts.map((prompt) => ({ prompt: prompt.prompt, echo: Boolean(prompt.echo) })),
        });
      }
    },
  });

  let triedPrimary = false;
  let triedKbd = false;
  const authHandler = (methodsLeft: string[] | null, partialSuccess: boolean | null, next: (method: unknown) => void) => {
    if (!auth) return next(false);
    if (!triedPrimary) {
      triedPrimary = true;
      if (auth.type === "password") return next({ type: "password", username, password: auth.password });
      if (auth.type === "key") {
        return next({ type: "publickey", username, key: auth.privateKey, passphrase: auth.passphrase });
      }
      triedKbd = true;
      return next(kbdMethod());
    }
    const primary = auth.type === "password" ? "password" : "publickey";
    const left = methodsLeft ?? [];
    if (!triedKbd && left.includes("keyboard-interactive") && (partialSuccess || !left.includes(primary))) {
      triedKbd = true;
      return next(kbdMethod());
    }
    return next(false);
  };

  const start = (message: Extract<ClientMessage, { t: "connect" }>) => {
    const { host, port } = message;
    if (
      started ||
      typeof host !== "string" ||
      !host ||
      typeof message.username !== "string" ||
      !message.username ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      sendJson(ws, { t: "error", code: "protocol", message: "접속 정보가 올바르지 않습니다." });
      ws.close();
      return;
    }
    if (countFor(accountId) >= SESSION_LIMIT) {
      sendJson(ws, { t: "error", code: "limit", message: LIMIT_MESSAGE });
      ws.close();
      return;
    }
    started = true;
    username = message.username;
    cols = message.cols;
    rows = message.rows;
    const base = typeof message.name === "string" && message.name.trim() ? message.name.trim().slice(0, NAME_MAX) : host;
    const hostId = typeof message.hostId === "string" ? message.hostId.slice(0, 100) : "";
    const name = uniqueName(accountId, base);
    const now = Date.now();
    const session: LiveSession = {
      id: randomUUID(),
      accountId,
      name,
      hostId,
      startedAt: now,
      lastInputAt: now,
      ready: false,
      viewers: new Set([ws]),
      idle: null,
      idleAt: null,
      scrollback: [],
      scrollbackBytes: 0,
      write: (data) => {
        session.lastInputAt = Date.now();
        stream?.write(data);
      },
      resize: (nextCols, nextRows) => {
        cols = nextCols;
        rows = nextRows;
        stream?.setWindow(nextRows, nextCols, 0, 0);
      },
      ack: (socket, bytes) => {
        if (!unacked.has(socket)) return;
        unacked.set(socket, Math.max(0, (unacked.get(socket) ?? 0) - bytes));
        resumeIfCaughtUp();
      },
      // A later device joins; earlier viewers stay attached and keep typing.
      bind: (socket) => {
        session.viewers.add(socket);
        unacked.set(socket, 0);
        clearIdle(session);
        const snapshot = scrollbackSnapshot(session);
        if (snapshot.length > 0) socket.send(snapshot, { binary: true });
        sendJson(socket, { t: "ready", id: session.id, name: session.name });
      },
      detach: (socket) => {
        session.viewers.delete(socket);
        unacked.delete(socket);
        resumeIfCaughtUp();
        if (session.viewers.size === 0) armIdle(session);
      },
      destroy: () => finish({ t: "closed" }),
      rename: (next) => {
        session.name = next;
        for (const socket of session.viewers) sendJson(socket, { t: "renamed", name: next });
      },
    };
    live = session;
    addSession(session);
    connectTimer = setTimeout(() => {
      finish({ t: "error", code: "timeout", message: "연결 시간이 초과되었습니다." });
    }, CONNECT_TIMEOUT_MS);
    const sock = new Socket();
    sock.setNoDelay(true);
    sock.connect(port, host);
    conn = new Client();
    conn.on("banner", (text: string) => {
      forward(Buffer.from(text.replace(/\r?\n/g, "\r\n")));
    });
    conn.on("ready", () => {
      conn?.shell({ term: "xterm-256color", cols, rows }, (err, channel) => {
        if (err || !live) {
          finish({ t: "error", code: "protocol", message: "터미널을 열지 못했습니다." });
          return;
        }
        stream = channel;
        live.ready = true;
        auth = null;
        unacked.set(ws, 0);
        for (const socket of live.viewers) sendJson(socket, { t: "ready", id: live.id, name: live.name });
        channel.on("data", forward);
        channel.stderr.on("data", forward);
        channel.on("close", () => finish({ t: "closed" }));
      });
    });
    conn.on("error", (err: Error) => {
      finish({ t: "error", ...describeError(err) });
    });
    conn.on("close", () => finish({ t: "closed" }));
    conn.connect({
      sock,
      host,
      port,
      username,
      readyTimeout: 0,
      keepaliveInterval: 30_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
        clearTimeout(connectTimer);
        verifyHost = verify;
        if (live?.viewers.has(ws)) sendJson(ws, { t: "hostkey", ...fingerprintOf(key) });
      },
      authHandler: authHandler as never,
    });
  };

  const trust = (payload: AuthPayload) => {
    if (!verifyHost) return;
    if (payload.type === "key") {
      const parsed = utils.parseKey(payload.privateKey, payload.passphrase);
      if (parsed instanceof Error) {
        const message = /passphrase|decrypt/i.test(parsed.message)
          ? "키 패스프레이즈가 없거나 맞지 않습니다."
          : "개인키를 읽을 수 없습니다.";
        finish({ t: "error", code: "key", message });
        return;
      }
    }
    auth = payload;
    const verify = verifyHost;
    verifyHost = null;
    verify(true);
  };

  const adopt = (id: string) => {
    if (started) return;
    started = true;
    const found = typeof id === "string" ? ownedSession(accountId, id) : null;
    if (!found?.ready) {
      sendJson(ws, { t: "error", code: "not-found", message: "연결을 찾지 못했습니다." });
      ws.close();
      return;
    }
    bound = found;
    found.bind(ws);
  };

  const release = () => {
    const target = current();
    if (!target || !target.viewers.has(ws)) return;
    if (!target.ready) target.destroy();
    else target.detach(ws);
  };

  ws.on("message", (raw, isBinary) => {
    const data = raw as Buffer;
    if (isBinary) {
      const target = current();
      if (target?.ready && target.viewers.has(ws)) target.write(data);
      return;
    }
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString("utf8")) as ClientMessage;
    } catch {
      return;
    }
    if (message.t === "attach") {
      adopt(message.id);
      return;
    }
    if (message.t === "detach") {
      release();
      return;
    }
    const adopted = bound && bound !== live ? bound : null;
    if (adopted) {
      if (message.t === "resize" && Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
        adopted.resize(message.cols, message.rows);
      } else if (message.t === "ack" && Number.isInteger(message.bytes)) {
        adopted.ack(ws, message.bytes);
      }
      return;
    }
    switch (message.t) {
      case "connect":
        start(message);
        break;
      case "trust":
        trust(message.auth);
        break;
      case "kbd":
        if (finishKbd && Array.isArray(message.answers)) {
          const answer = finishKbd;
          finishKbd = null;
          answer(message.answers);
        }
        break;
      case "resize":
        if (live && Number.isInteger(message.cols) && Number.isInteger(message.rows)) live.resize(message.cols, message.rows);
        break;
      case "ack":
        if (live && Number.isInteger(message.bytes)) live.ack(ws, message.bytes);
        break;
    }
  });

  ws.on("error", () => ws.terminate());
  ws.on("close", () => {
    if (finished) return;
    release();
  });
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Answer 400 instead of cutting the connection; drain and drop the rest.
        chunks.length = 0;
        req.removeAllListeners("data");
        req.resume();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

/** Changes must come from the app's own pages, not another site riding the cookie. */
/** Path segment to session id; a malformed %-escape is no id (decodeURIComponent throws). */
function decodeId(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  return typeof origin === "string" && ALLOWED_ORIGINS.has(origin);
}

async function renameSession(req: IncomingMessage, res: ServerResponse, session: LiveSession) {
  if (!sameOrigin(req)) {
    writeJson(res, 403, { error: "bad_origin" });
    return;
  }
  const raw = await readBody(req);
  let name: unknown;
  try {
    name = raw === null ? undefined : (JSON.parse(raw) as { name?: unknown }).name;
  } catch {
    name = undefined;
  }
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > NAME_MAX) {
    writeJson(res, 400, { error: "bad_name", message: `이름은 1~${NAME_MAX}자로 적어 주세요.` });
    return;
  }
  if (nameTaken(session.accountId, trimmed, session.id)) {
    writeJson(res, 409, { error: "name_taken", message: "같은 이름의 연결이 이미 있습니다." });
    return;
  }
  session.rename(trimmed);
  writeJson(res, 200, { ok: true, name: trimmed });
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const user = loginUser(req);
  if (!user) {
    writeJson(res, 401, { error: "login_required" });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/sessions") {
    writeJson(res, 200, { sessions: listSessions(user.id), limit: SESSION_LIMIT });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/sessions/close-all") {
    closeAccount(user.id);
    writeJson(res, 200, { ok: true });
    return;
  }
  const match = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (req.method === "PATCH" && match) {
    const id = decodeId(match[1]);
    const session = id === null ? null : ownedSession(user.id, id);
    if (!session) {
      writeJson(res, 404, { error: "not_found" });
      return;
    }
    void renameSession(req, res, session);
    return;
  }
  if (req.method === "DELETE" && match) {
    const id = decodeId(match[1]);
    const session = id === null ? null : ownedSession(user.id, id);
    if (!session) {
      writeJson(res, 404, { error: "not_found" });
      return;
    }
    session.destroy();
    writeJson(res, 200, { ok: true });
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: MAX_FRAME_BYTES,
  verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) =>
    origin !== undefined && ALLOWED_ORIGINS.has(origin) && loginUser(req) !== null,
});

wss.on("connection", (socket, req) => {
  const user = loginUser(req);
  if (!user) {
    socket.close();
    return;
  }
  handleSocket(socket, user.id);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[gateway] listening on 127.0.0.1:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => process.exit(0));
}
