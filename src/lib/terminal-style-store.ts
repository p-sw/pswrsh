// The logged-in account's terminal style, loaded once per page and shared by every terminal.
import { DEFAULT_STYLE, parseStyle, type TerminalStyle } from "@/lib/terminal-style";

let current: TerminalStyle = DEFAULT_STYLE;
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

export function getTerminalStyle() {
  return current;
}

export function subscribeTerminalStyle(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTerminalStyle(style: TerminalStyle) {
  current = style;
  for (const listener of listeners) listener();
}

export function loadTerminalStyle() {
  loading ??= fetch("/api/settings")
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => {
      const style = parseStyle(body?.settings?.terminalStyle);
      if (style) setTerminalStyle(style);
    })
    .catch(() => undefined);
  return loading;
}
