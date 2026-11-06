"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { AlertTriangle, Loader2, Pencil, RotateCw } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { attachTouchSelection } from "@/lib/touch-selection";
import type { SessionState, SshSession } from "@/lib/session";

const DESKTOP_FONT_SIZE = 13;
const MOBILE_FONT_SIZE = 15;
const FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';
export const TERMINAL_BACKGROUND = "#09090b";
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function latin1Bytes(text: string) {
  return Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
}

export function statusLabel(state: SessionState) {
  switch (state.status) {
    case "connecting":
    case "verifying":
      return "연결 중…";
    case "authenticating":
      return "인증 중…";
    case "connected":
      return "연결됨";
    case "auth-failed":
      return "인증 실패";
    case "disconnected":
      return "연결 끊김";
    case "failed":
      return "연결 실패";
  }
}

type Props = {
  session: SshSession;
  active: boolean;
  onEditHost: () => void;
};

export function TerminalPane({ session, active, onEditHost }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const isDesktop = useIsDesktop();
  const state = useSyncExternalStore(session.subscribe, session.getState);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: FONT_FAMILY,
      fontSize: window.matchMedia("(min-width: 768px)").matches ? DESKTOP_FONT_SIZE : MOBILE_FONT_SIZE,
      scrollback: 5000,
      theme: { background: TERMINAL_BACKGROUND, foreground: "#f4f4f5", cursor: "#f4f4f5" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    termRef.current = term;
    fitRef.current = fit;

    // Clipboard keys. Copying and pasting go through the browser's own copy and paste
    // events, which xterm handles. Only Ctrl+Shift+Insert reads the clipboard itself.
    term.attachCustomKeyEventHandler((event) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (IS_MAC) {
        return !(event.metaKey && !event.ctrlKey && !event.altKey && (key === "c" || key === "v"));
      }
      if (!event.ctrlKey || event.altKey || event.metaKey) return true;
      if (!event.shiftKey) {
        // Ctrl+C copies a selection; without one it stays ^C for the shell.
        if (key === "c") return !term.hasSelection();
        if (key === "v") return false;
        if (key === "Insert") {
          if (event.type === "keydown" && term.hasSelection()) {
            event.preventDefault();
            void navigator.clipboard.writeText(term.getSelection()).catch(() => {
              toast.error("브라우저가 클립보드 쓰기를 막았습니다.");
            });
          }
          return false;
        }
        return true;
      }
      if (key === "Insert") {
        if (event.type === "keydown") {
          event.preventDefault();
          navigator.clipboard.readText().then(
            (text) => text && session.paste(text),
            () => toast.error("브라우저가 클립보드 읽기를 막았습니다."),
          );
        }
        return false;
      }
      return key !== "v";
    });

    const inputs = [
      term.onData((data) => session.sendTerminalData(data)),
      term.onBinary((data) => session.sendInput(latin1Bytes(data))),
      term.onResize(({ cols, rows }) => session.resize(cols, rows)),
    ];

    const detachTouchSelection = attachTouchSelection(element, term, {
      onArrow: (direction) => session.sendSpecialKey(direction),
      onCopy: (text) => {
        navigator.clipboard.writeText(text).then(
          () => toast.success("복사했습니다."),
          () => toast.error("브라우저가 클립보드 쓰기를 막았습니다."),
        );
      },
      onPaste: () => {
        navigator.clipboard.readText().then(
          (text) => text && session.paste(text),
          () => toast.error("브라우저가 클립보드 읽기를 막았습니다."),
        );
      },
    });

    const fitIfVisible = () => {
      if (element.offsetWidth > 0 && element.offsetHeight > 0) fit.fit();
    };
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitIfVisible);
    });
    observer.observe(element);

    // Deferred so a Strict Mode remount does not open two connections.
    const startTimer = setTimeout(() => {
      fitIfVisible();
      session.attach(term);
    }, 0);

    return () => {
      clearTimeout(startTimer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      detachTouchSelection();
      for (const input of inputs) input.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    const term = termRef.current;
    const element = container.current;
    if (!term || !element) return;
    term.options.fontSize = isDesktop ? DESKTOP_FONT_SIZE : MOBILE_FONT_SIZE;
    if (element.offsetWidth > 0) fitRef.current?.fit();
  }, [isDesktop]);

  // On phones the keyboard opens only when the user taps the terminal.
  useEffect(() => {
    if (active && isDesktop && state.status === "connected") termRef.current?.focus();
  }, [active, isDesktop, state.status]);

  const connecting = state.status === "connecting" || state.status === "verifying" || state.status === "authenticating";
  const ended = state.status === "auth-failed" || state.status === "failed" || state.status === "disconnected";

  return (
    <div className="relative h-full min-h-0 w-full" style={{ backgroundColor: TERMINAL_BACKGROUND }}>
      <div className="absolute inset-0 p-2">
        <div ref={container} className="h-full w-full [-webkit-touch-callout:none]" />
      </div>
      {connecting && (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
          <div role="status" className="flex items-center gap-2 rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {statusLabel(state)}
          </div>
        </div>
      )}
      {ended && (
        <div className="absolute inset-x-0 top-4 flex justify-center px-4">
          <div role="alert" className="flex w-full max-w-sm flex-col gap-3 rounded-md border bg-popover p-4 shadow-md">
            <div className="flex items-start gap-2">
              <AlertTriangle
                className={state.status === "disconnected" ? "mt-0.5 size-4 shrink-0 text-muted-foreground" : "mt-0.5 size-4 shrink-0 text-destructive"}
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{statusLabel(state)}</p>
                {state.message && <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {state.status === "auth-failed" && (
                <Button variant="outline" className="h-10" onClick={onEditHost}>
                  <Pencil />
                  호스트 수정
                </Button>
              )}
              <Button className="h-10" onClick={() => session.connect()}>
                <RotateCw />
                다시 연결
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
