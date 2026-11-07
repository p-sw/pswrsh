// The logged-in account's terminal style, shared by every terminal on the page.
// The style lives in the account (server). It is fetched when the app opens and again
// when a tab comes back to the foreground, and a save on the settings page updates
// this page and the other tabs of the browser right away.
import { DEFAULT_STYLE, parseStyle, type TerminalStyle } from "@/lib/terminal-style";

const CHANNEL = "pswrsh-terminal-style";

let current: TerminalStyle = DEFAULT_STYLE;
const listeners = new Set<() => void>();
let firstLoad: Promise<void> | null = null;
let inFlight: Promise<void> | null = null;

export function getTerminalStyle() {
  return current;
}

export function subscribeTerminalStyle(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apply(style: TerminalStyle) {
  if (JSON.stringify(style) === JSON.stringify(current)) return;
  current = style;
  for (const listener of listeners) listener();
}

/** After a save: this page and the browser's other tabs switch now. */
export function setTerminalStyle(style: TerminalStyle) {
  apply(style);
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(style);
  channel.close();
}

/** Fetches the account's style again. Concurrent calls share one request. */
export function refreshTerminalStyle() {
  inFlight ??= fetch("/api/settings", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => {
      const style = parseStyle(body?.settings?.terminalStyle);
      if (style) apply(style);
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Resolves once the account's style has been fetched at least once on this page. */
export function terminalStyleReady() {
  firstLoad ??= refreshTerminalStyle();
  return firstLoad;
}

/** Keeps the style current while the app is open. Returns the cleanup. */
export function watchTerminalStyle() {
  void refreshTerminalStyle();
  const onVisible = () => {
    if (document.visibilityState === "visible") void refreshTerminalStyle();
  };
  document.addEventListener("visibilitychange", onVisible);
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  if (channel) {
    channel.onmessage = (message: MessageEvent<unknown>) => {
      const style = parseStyle(message.data);
      if (style) apply(style);
    };
  }
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    channel?.close();
  };
}
