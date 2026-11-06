// A throwaway SSH server on loopback. It records what a real server would see:
// auth attempts, PTY size and the exact bytes typed into the shell.
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import ssh2 from "ssh2";
import type { AuthContext, AuthenticationType, Connection, ServerChannel } from "ssh2";

const { Server, utils } = ssh2;

export type AuthAttempt = {
  method: string;
  username: string;
  password?: string;
  publicKey?: string;
  answers?: string[];
};

export type Verdict = { accept: true } | { accept: false; methods: string[] };
export type Policy = (attempt: AuthAttempt) => Verdict;

export const acceptAll: Policy = () => ({ accept: true });
export const rejectAll =
  (...methods: string[]): Policy =>
  () => ({ accept: false, methods });

/** ssh2's generator now and then emits a key its own parser refuses; such a key is no use as a fixture. */
export function newKeyPair(options?: { passphrase: string }) {
  for (;;) {
    const pair = options
      ? utils.generateKeyPairSync("ed25519", { passphrase: options.passphrase, cipher: "aes256-ctr", rounds: 16 })
      : utils.generateKeyPairSync("ed25519");
    if (!(utils.parseKey(pair.private, options?.passphrase) instanceof Error)) return pair;
  }
}

/** Computed from the key itself, not through the gateway under test. */
export function fingerprintOf(publicKey: string) {
  const blob = Buffer.from(publicKey.trim().split(/\s+/)[1], "base64");
  return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
}

export function publicKeyBlob(publicKey: string) {
  return publicKey.trim().split(/\s+/)[1];
}

export class DummySsh {
  readonly hostKey: { private: string; public: string };
  readonly fingerprint: string;
  port = 0;
  policy: Policy;
  shellOutput: string;
  connections = 0;
  open = 0;
  shells = 0;
  authAttempts: AuthAttempt[] = [];
  input = Buffer.alloc(0);
  size: { cols: number; rows: number } | null = null;
  private stream: ServerChannel | null = null;
  private clients = new Set<Connection>();
  private server: InstanceType<typeof Server>;

  constructor(options: { policy?: Policy; hostKey?: { private: string; public: string }; shellOutput?: string } = {}) {
    this.hostKey = options.hostKey ?? newKeyPair();
    this.fingerprint = fingerprintOf(this.hostKey.public);
    this.policy = options.policy ?? acceptAll;
    this.shellOutput = options.shellOutput ?? "dummy-shell\r\n";
    this.server = new Server({ hostKeys: [this.hostKey.private] }, (client) => this.onClient(client));
  }

  async start(port = 0) {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => resolve());
    });
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop() {
    for (const client of this.clients) client.end();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  write(text: string) {
    this.stream?.write(text);
  }

  takeInputHex() {
    const hex = this.input.toString("hex");
    this.input = Buffer.alloc(0);
    return hex;
  }

  inputHex() {
    return this.input.toString("hex");
  }

  private onClient(client: Connection) {
    this.connections++;
    this.open++;
    this.clients.add(client);
    client.on("authentication", (ctx: AuthContext) => this.onAuth(ctx));
    client.on("ready", () => {
      client.on("session", (acceptSession) => {
        const session = acceptSession();
        session.on("pty", (accept, _reject, info) => {
          this.size = { cols: info.cols, rows: info.rows };
          accept?.();
        });
        session.on("window-change", (accept, _reject, info) => {
          this.size = { cols: info.cols, rows: info.rows };
          accept?.();
        });
        session.on("shell", (accept) => {
          const stream = accept();
          this.stream = stream;
          this.shells++;
          stream.on("data", (data: Buffer) => {
            this.input = Buffer.concat([this.input, data]);
          });
          stream.write(this.shellOutput);
        });
      });
    });
    client.on("error", () => {});
    client.on("close", () => {
      this.open--;
      this.clients.delete(client);
    });
  }

  private onAuth(ctx: AuthContext) {
    const attempt: AuthAttempt = { method: ctx.method, username: ctx.username };
    const finish = () => {
      const verdict = this.policy(attempt);
      if (verdict.accept) ctx.accept();
      else ctx.reject(verdict.methods as AuthenticationType[]);
    };
    if (ctx.method === "password") {
      attempt.password = ctx.password;
    } else if (ctx.method === "publickey") {
      attempt.publicKey = ctx.key.data.toString("base64");
    } else if (ctx.method === "keyboard-interactive") {
      this.authAttempts.push(attempt);
      ctx.prompt([{ prompt: "fake-code", echo: false }], "fake-kbd-title", "fake-kbd-instructions", (answers) => {
        attempt.answers = answers;
        finish();
      });
      return;
    }
    this.authAttempts.push(attempt);
    finish();
  }
}
