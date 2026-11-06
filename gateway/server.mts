// SSH gateway: one WebSocket maps to one SSH connection and PTY.
// Never log or persist message contents: they can carry credentials.
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { Socket } from "node:net";
import ssh2 from "ssh2";
import type { ClientChannel } from "ssh2";
import { WebSocket, WebSocketServer } from "ws";
import type { AuthPayload, ClientMessage, ErrorCode, ServerMessage } from "../src/lib/protocol";
import { findSession, readCookie, SESSION_COOKIE } from "../src/server/sessions.ts";

const { Client, utils } = ssh2;

const PORT = Number(process.env.PSWRSH_GATEWAY_PORT ?? 3101);
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
// Flow control: pause the SSH stream while the browser has too many unrendered bytes.
const HIGH_WATER_BYTES = 1024 * 1024;
const LOW_WATER_BYTES = 256 * 1024;

const APP_PORT = process.env.PORT ?? "3000";
// The temporary Cloudflare Tunnel serves this app at ssh.psw.kr.
const PUBLIC_ORIGIN = "https://ssh.psw.kr";
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${APP_PORT}`, `http://localhost:${APP_PORT}`, PUBLIC_ORIGIN]);

/** The WebSocket needs a valid account session cookie, not only an allowed Origin. */
function hasLoginSession(req: IncomingMessage) {
  try {
    return findSession(readCookie(req.headers.cookie, SESSION_COOKIE)) !== null;
  } catch {
    return false;
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

function handleSocket(ws: WebSocket) {
  const conn = new Client();
  let started = false;
  let finished = false;
  let username = "";
  let cols = 80;
  let rows = 24;
  let auth: AuthPayload | null = null;
  let verifyHost: ((ok: boolean) => void) | null = null;
  let finishKbd: ((answers: string[]) => void) | null = null;
  let stream: ClientChannel | null = null;
  let connectTimer: NodeJS.Timeout | undefined;
  let unacked = 0;
  let paused = false;

  const send = (message: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  const finish = (message: ServerMessage) => {
    if (finished) return;
    finished = true;
    clearTimeout(connectTimer);
    send(message);
    ws.close();
    conn.destroy();
  };

  const forward = (data: Buffer) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(data, { binary: true });
    unacked += data.length;
    if (!paused && stream && unacked > HIGH_WATER_BYTES) {
      paused = true;
      stream.pause();
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
      send({
        t: "kbd",
        name,
        instructions,
        prompts: prompts.map((p) => ({ prompt: p.prompt, echo: Boolean(p.echo) })),
      });
    },
  });

  // Tries the method the host is configured with. keyboard-interactive is a
  // fallback only when the server asks for a second factor or does not offer
  // that method, so a wrong password fails right away instead of prompting.
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
      finish({ t: "error", code: "protocol", message: "접속 정보가 올바르지 않습니다." });
      return;
    }
    started = true;
    username = message.username;
    cols = message.cols;
    rows = message.rows;
    connectTimer = setTimeout(() => {
      finish({ t: "error", code: "timeout", message: "연결 시간이 초과되었습니다." });
    }, CONNECT_TIMEOUT_MS);
    // ssh2 writes one packet in several small chunks. With Nagle on, the later chunk
    // waits for a delayed ACK, which added about 40 ms to every keystroke echo.
    const sock = new Socket();
    sock.setNoDelay(true);
    sock.connect(port, host);
    conn.connect({
      sock,
      host,
      port,
      username,
      // The handshake waits for people (host key, prompts), so it has no timeout
      // of its own. connectTimer covers the part before the host key arrives.
      readyTimeout: 0,
      keepaliveInterval: 30_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
        clearTimeout(connectTimer);
        verifyHost = verify;
        send({ t: "hostkey", ...fingerprintOf(key) });
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

  conn.on("banner", (text: string) => {
    forward(Buffer.from(text.replace(/\r?\n/g, "\r\n")));
  });

  conn.on("ready", () => {
    send({ t: "ready" });
    conn.shell({ term: "xterm-256color", cols, rows }, (err, channel) => {
      if (err) {
        finish({ t: "error", code: "protocol", message: "터미널을 열지 못했습니다." });
        return;
      }
      stream = channel;
      channel.on("data", forward);
      channel.stderr.on("data", forward);
      channel.on("close", () => finish({ t: "closed" }));
    });
  });

  conn.on("error", (err: Error) => {
    finish({ t: "error", ...describeError(err) });
  });
  conn.on("close", () => finish({ t: "closed" }));

  ws.on("message", (raw, isBinary) => {
    const data = raw as Buffer;
    if (isBinary) {
      stream?.write(data);
      return;
    }
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString("utf8"));
    } catch {
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
        if (Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
          cols = message.cols;
          rows = message.rows;
          stream?.setWindow(rows, cols, 0, 0);
        }
        break;
      case "ack":
        unacked = Math.max(0, unacked - message.bytes);
        if (paused && unacked < LOW_WATER_BYTES) {
          paused = false;
          stream?.resume();
        }
        break;
    }
  });

  ws.on("error", () => ws.terminate());
  ws.on("close", () => {
    finished = true;
    clearTimeout(connectTimer);
    conn.destroy();
  });
}

const server = createServer((_req, res) => {
  res.writeHead(404).end();
});

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: MAX_FRAME_BYTES,
  // Only this app. Other websites, and other web apps on this machine, count as external.
  verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) =>
    origin !== undefined && ALLOWED_ORIGINS.has(origin) && hasLoginSession(req),
});
wss.on("connection", handleSocket);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[gateway] listening on 127.0.0.1:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => process.exit(0));
}
