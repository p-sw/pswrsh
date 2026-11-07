// One browser-side SSH session: a WebSocket to the gateway bound to one xterm.
import type { Terminal } from "@xterm/xterm";
import type { AuthPayload, ClientMessage, KbdPrompt, ServerMessage } from "@/lib/protocol";
import type { Host, SshKey } from "@/lib/vault";
import { notifyLiveSessionsChanged } from "@/lib/live-sessions";

export type SessionStatus =
  | "connecting"
  | "verifying"
  | "authenticating"
  | "connected"
  | "auth-failed"
  | "disconnected"
  | "failed";

export type SessionState = { status: SessionStatus; message?: string };

export type KbdRequest = { name: string; instructions: string; prompts: KbdPrompt[] };

export type SessionDelegate = {
  getHost(hostId: string): Host | undefined;
  getKey(keyId: string): SshKey | undefined;
  checkHostKey(session: SshSession, host: Host, key: { algorithm: string; fingerprint: string }): Promise<boolean>;
  askPassword(session: SshSession, host: Host): Promise<string | null>;
  askKbd(session: SshSession, host: Host, request: KbdRequest): Promise<string[] | null>;
};

export type SpecialKey = "esc" | "tab" | "left" | "up" | "down" | "right";

const ACK_BATCH_BYTES = 64 * 1024;
const ESC = "\x1b";
const ARROW_KEYS = {
  up: { key: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", keyCode: 40 },
  right: { key: "ArrowRight", keyCode: 39 },
  left: { key: "ArrowLeft", keyCode: 37 },
} as const;

const encoder = new TextEncoder();

/** The control byte for Ctrl+char, or null when the key has no control form. */
function controlByte(char: string): string | null {
  if (char === " ") return "\x00";
  if (char === "?") return "\x7f";
  const code = char.toUpperCase().charCodeAt(0);
  // A-Z and @ [ \\ ] ^ _
  return code >= 0x40 && code <= 0x5f ? String.fromCharCode(code & 0x1f) : null;
}

export class SshSession {
  readonly id = crypto.randomUUID();
  readonly hostId: string;
  private delegate: SessionDelegate;
  private term: Terminal | null = null;
  private ws: WebSocket | null = null;
  private generation = 0;
  private dropped = false;
  private pendingAck = 0;
  private started = false;
  private state: SessionState = { status: "connecting" };
  private ctrlArmed = false;
  private listeners = new Set<() => void>();
  /** Gateway session to join. Empty for a new SSH connection. */
  private joinId: string | null;
  /** Id assigned by the gateway once the shell is open. */
  private gatewaySessionId: string | null = null;
  private label: string;

  constructor(hostId: string, delegate: SessionDelegate, options?: { joinId?: string; label?: string }) {
    this.hostId = hostId;
    this.delegate = delegate;
    this.joinId = options?.joinId ?? null;
    this.label = options?.label ?? "";
  }

  getLabel = () => this.label;

  /** The gateway session this tab shows, once known. */
  getGatewayId = () => this.gatewaySessionId ?? this.joinId;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  getCtrlArmed = () => this.ctrlArmed;

  private notify() {
    for (const listener of this.listeners) listener();
  }

  private setState(state: SessionState) {
    this.state = state;
    if (state.status !== "connected") this.ctrlArmed = false;
    this.notify();
  }

  private setCtrlArmed(armed: boolean) {
    if (this.ctrlArmed === armed) return;
    this.ctrlArmed = armed;
    this.notify();
  }

  /** Sticky Ctrl from the phone key bar. Opens the keyboard for the next key. */
  toggleCtrl() {
    this.setCtrlArmed(!this.ctrlArmed);
    if (this.ctrlArmed) this.term?.focus();
  }

  sendSpecialKey(key: SpecialKey) {
    const withCtrl = this.ctrlArmed;
    this.setCtrlArmed(false);
    if (key === "esc" || key === "tab") {
      this.sendInput(encoder.encode(key === "esc" ? ESC : "\t"));
      return;
    }
    // A real key press through xterm, so it picks CSI or SS3 from the terminal's cursor mode.
    // The keyup matters: xterm ignores soft keyboard text while it thinks a key is held.
    const { key: name, keyCode } = ARROW_KEYS[key];
    for (const type of ["keydown", "keyup"]) {
      this.term?.textarea?.dispatchEvent(
        new KeyboardEvent(type, { key: name, code: name, keyCode, ctrlKey: withCtrl, bubbles: true, cancelable: true }),
      );
    }
  }

  /** Terminal input. Applies a pending sticky Ctrl to the next key. */
  sendTerminalData(data: string) {
    // xterm's own replies and reports (DA, focus, mouse) start with ESC; they are not a key press.
    if (this.ctrlArmed && !data.startsWith(ESC)) {
      this.setCtrlArmed(false);
      const [first] = data;
      const control = controlByte(first);
      if (control) data = control + data.slice(first.length);
    }
    this.sendInput(encoder.encode(data));
  }

  /** Binds the terminal. The first call opens the connection. */
  attach(term: Terminal) {
    this.term = term;
    if (!this.started) {
      this.started = true;
      this.connect();
    }
  }

  private send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  connect() {
    const host = this.joinId ? undefined : this.delegate.getHost(this.hostId);
    const term = this.term;
    if ((!host && !this.joinId) || !term) return;
    this.closeSocket();
    term.reset();
    const generation = ++this.generation;
    this.pendingAck = 0;
    this.setState({ status: "connecting" });

    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      if (this.joinId) {
        this.send({ t: "attach", id: this.joinId });
        return;
      }
      if (!host) return;
      this.send({
        t: "connect",
        host: host.hostname,
        port: host.port,
        username: host.username,
        name: host.name,
        hostId: this.hostId,
        cols: term.cols,
        rows: term.rows,
      });
    };

    ws.onmessage = (event) => {
      if (generation !== this.generation) return;
      if (typeof event.data === "string") {
        void this.handleMessage(JSON.parse(event.data) as ServerMessage, generation);
        return;
      }
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      term.write(bytes, () => this.acknowledge(bytes.length));
    };

    ws.onclose = () => {
      if (generation !== this.generation) return;
      const { status } = this.state;
      if (status === "auth-failed" || status === "failed" || status === "disconnected") return;
      this.setState(
        opened
          ? { status: "disconnected" }
          : { status: "failed", message: "SSH 게이트웨이에 연결할 수 없습니다." },
      );
    };
  }

  private acknowledge(bytes: number) {
    this.pendingAck += bytes;
    if (this.pendingAck >= ACK_BATCH_BYTES) {
      this.send({ t: "ack", bytes: this.pendingAck });
      this.pendingAck = 0;
    }
  }

  private async handleMessage(message: ServerMessage, generation: number) {
    const host = this.delegate.getHost(this.hostId);
    const stale = () => generation !== this.generation || this.ws?.readyState !== WebSocket.OPEN;
    if (message.t === "ready") {
      if (message.id) this.gatewaySessionId = message.id;
      notifyLiveSessionsChanged();
      if (message.name) this.label = message.name;
      this.setState({ status: "connected" });
      return;
    }
    if (message.t === "renamed") {
      this.label = message.name;
      this.notify();
      return;
    }
    if (message.t === "error") {
      this.setState({
        status: message.code === "auth" || message.code === "key" ? "auth-failed" : "failed",
        message: message.message,
      });
      return;
    }
    if (message.t === "closed") {
      this.setState({ status: "disconnected" });
      return;
    }
    if (!host) return;
    switch (message.t) {
      case "hostkey": {
        this.setState({ status: "verifying" });
        const accepted = await this.delegate.checkHostKey(this, host, message);
        if (stale()) return;
        if (!accepted) return this.abort("호스트 키를 수락하지 않아 접속을 중단했습니다.");
        const auth = await this.buildAuth(host);
        if (stale()) return;
        if (!auth) return this.abort("인증을 취소했습니다.");
        if ("error" in auth) return this.abort(auth.error);
        this.setState({ status: "authenticating" });
        this.send({ t: "trust", auth });
        return;
      }
      case "kbd": {
        const answers = await this.delegate.askKbd(this, host, message);
        if (stale()) return;
        if (!answers) return this.abort("인증을 취소했습니다.");
        this.send({ t: "kbd", answers });
        return;
      }
    }
  }

  private async buildAuth(host: Host): Promise<AuthPayload | { error: string } | null> {
    const { auth } = host;
    if (auth.type === "interactive") return auth;
    if (auth.type === "key") {
      if (!auth.keyId) return { error: "이 호스트에 연결된 키가 없습니다. 키 관리에서 고르세요." };
      const key = this.delegate.getKey(auth.keyId);
      if (!key?.privateKey) return { error: "이 호스트에 연결된 키를 볼트에서 찾지 못했습니다." };
      // The private key leaves the browser only after the host key was accepted above.
      return { type: "key", privateKey: key.privateKey, passphrase: key.passphrase || undefined };
    }
    const password = auth.password || (await this.delegate.askPassword(this, host));
    return password === null ? null : { type: "password", password };
  }

  private abort(message: string) {
    this.setState({ status: "failed", message });
    this.closeSocket();
  }

  private closeSocket() {
    this.ws?.close();
    this.ws = null;
  }

  sendInput(data: Uint8Array) {
    if (this.state.status === "connected" && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data as Uint8Array<ArrayBuffer>);
    }
  }

  resize(cols: number, rows: number) {
    this.send({ t: "resize", cols, rows });
  }

  paste(text: string) {
    this.setCtrlArmed(false);
    this.term?.paste(text);
    this.term?.focus();
  }

  focus() {
    this.term?.focus();
  }

  /** True after the page hid this tab. The shell drops it when the route is shown again. */
  get released(): boolean {
    return this.dropped;
  }

  /** Leave the page. The gateway keeps the SSH session. */
  dispose() {
    this.dropped = true;
    this.generation++;
    if (this.ws?.readyState === WebSocket.OPEN) this.send({ t: "detach" });
    this.closeSocket();
  }

  /** End this SSH session on the gateway, then drop the socket. */
  async end() {
    const id = this.gatewaySessionId ?? this.joinId;
    this.generation++;
    if (id) {
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
    }
    this.closeSocket();
    // The gateway dropped the session before answering, so a refetch now sees it gone.
    notifyLiveSessionsChanged();
  }
}
