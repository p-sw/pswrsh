"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { AlertTriangle, Loader2, Pencil, RotateCw } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { haptic } from "@/lib/haptics";
import { ARROW_STAGES, type ArrowDirection, type ArrowState, attachTouchSelection } from "@/lib/touch-selection";
import "@/lib/terminal-fonts";
import { boldWeightOf, fontOf, SYSTEM_FONT_STACK, type TerminalStyle, themeOf } from "@/lib/terminal-style";
import { getTerminalStyle, subscribeTerminalStyle, terminalStyleReady } from "@/lib/terminal-style-store";
import type { SessionState, SshSession } from "@/lib/session";

const DESKTOP_FONT_SIZE = 13;
const MOBILE_FONT_SIZE = 15;

/** xterm options for a style. A missing web font falls back to the system stack. */
function terminalOptions(style: TerminalStyle, isDesktop: boolean) {
  const font = fontOf(style.font);
  return {
    fontFamily: font.id === "system" ? SYSTEM_FONT_STACK : `${font.family}, ${SYSTEM_FONT_STACK}`,
    fontSize: style.size ?? (isDesktop ? DESKTOP_FONT_SIZE : MOBILE_FONT_SIZE),
    fontWeight: style.weight,
    fontWeightBold: boldWeightOf(font, style.weight),
    theme: themeOf(style.theme).theme,
  };
}
/**
 * Resolves when the style's web font files (regular and bold) are loaded. xterm measures
 * the cell size from the font when its options change, so measuring before the file
 * arrives leaves the fallback font's size in place.
 */
function fontReady(style: TerminalStyle, isDesktop: boolean): Promise<void> {
  const font = fontOf(style.font);
  if (font.id === "system" || typeof document === "undefined") return Promise.resolve();
  const { fontSize, fontWeight, fontWeightBold } = terminalOptions(style, isDesktop);
  return Promise.all([
    document.fonts.load(`${fontWeight} ${fontSize}px ${font.family}`),
    document.fonts.load(`${fontWeightBold} ${fontSize}px ${font.family}`),
  ]).then(
    () => undefined,
    () => undefined,
  );
}

/** How long the arrow panel stays after the finger lifts. */
const ARROW_PANEL_LINGER_MS = 600;

/** Width the fit addon keeps free for a scrollbar (its default when overviewRuler is unset). */
const SCROLLBAR_RESERVE_PX = 14;

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
  const style = useSyncExternalStore(subscribeTerminalStyle, getTerminalStyle, getTerminalStyle);
  const background = themeOf(style.theme).theme.background;
  const [arrowPanel, setArrowPanel] = useState<ArrowState | null>(null);
  const arrowPanelTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    // The terminal opens once the account's style and its font are ready, so the first
    // screen already uses them and the cell size is measured with the right font.
    let cleanup: (() => void) | null = null;
    let disposed = false;
    void terminalStyleReady()
      .then(() => fontReady(getTerminalStyle(), window.matchMedia("(min-width: 768px)").matches))
      .then(() => {
        if (!disposed) cleanup = open(element);
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [session]);

  function open(element: HTMLDivElement) {
    const term = new Terminal({
      cursorBlink: true,
      ...terminalOptions(getTerminalStyle(), window.matchMedia("(min-width: 768px)").matches),
      scrollback: 5000,
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
      onArrow: (direction) => {
        haptic();
        session.sendSpecialKey(direction);
      },
      onTab: () => {
        haptic();
        session.sendSpecialKey("tab");
      },
      onArrowState: (arrowState) => {
        clearTimeout(arrowPanelTimer.current);
        if (arrowState.active) setArrowPanel(arrowState);
        else arrowPanelTimer.current = setTimeout(() => setArrowPanel(null), ARROW_PANEL_LINGER_MS);
      },
      onCopy: (text) => {
        navigator.clipboard.writeText(text).catch(() => toast.error("브라우저가 클립보드 쓰기를 막았습니다."));
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
      clearTimeout(arrowPanelTimer.current);
      cancelAnimationFrame(frame);
      observer.disconnect();
      detachTouchSelection();
      for (const input of inputs) input.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }

  useEffect(() => {
    const term = termRef.current;
    const element = container.current;
    if (!term || !element) return;
    const options = terminalOptions(style, isDesktop);
    let cancelled = false;
    // Measure glyphs only after the web font is loaded, or the cell size comes out wrong.
    void fontReady(style, isDesktop).then(() => {
      if (cancelled || termRef.current !== term) return;
      term.options = options;
      if (element.offsetWidth > 0) fitRef.current?.fit();
    });
    return () => {
      cancelled = true;
    };
  }, [isDesktop, style]);

  // On phones the keyboard opens only when the user taps the terminal.
  useEffect(() => {
    if (active && isDesktop && state.status === "connected") termRef.current?.focus();
  }, [active, isDesktop, state.status]);

  const connecting = state.status === "connecting" || state.status === "verifying" || state.status === "authenticating";
  const ended = state.status === "auth-failed" || state.status === "failed" || state.status === "disconnected";

  return (
    <div className="relative h-full min-h-0 w-full" style={{ backgroundColor: background }}>
      {/* The scrollbar is hidden (globals.css), but the fit addon still reserves its width.
          The terminal runs that far past the right edge, clipped, so no empty strip remains. */}
      <div className="absolute inset-0 overflow-hidden p-2">
        <div
          ref={container}
          className="pswrsh-terminal h-full [-webkit-touch-callout:none]"
          style={{ width: `calc(100% + ${SCROLLBAR_RESERVE_PX}px)` }}
        />
      </div>
      {arrowPanel && <ArrowPanel state={arrowPanel} />}
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

const ARROWS: { direction: ArrowDirection; cell: string; label: string; rotate: number; fill: string }[] = [
  { direction: "up", cell: "col-start-2 row-start-1", label: "위", rotate: -90, fill: "inset-x-0 bottom-0" },
  { direction: "left", cell: "col-start-1 row-start-2", label: "왼쪽", rotate: 180, fill: "inset-y-0 right-0" },
  { direction: "right", cell: "col-start-3 row-start-2", label: "오른쪽", rotate: 0, fill: "inset-y-0 left-0" },
  { direction: "down", cell: "col-start-2 row-start-3", label: "아래", rotate: 90, fill: "inset-x-0 top-0" },
];

/** Left x of each chevron by count. The icon points right before it is rotated. */
const CHEVRON_X: Record<number, number[]> = { 1: [9], 2: [6, 12], 3: [3.5, 9.5, 15.5] };

/** Tail-less chevrons, one to three, inside one icon box. */
function Chevrons({ count, rotate }: { count: number; rotate: number }) {
  const xs = CHEVRON_X[count] ?? CHEVRON_X[1];
  const half = count === 3 ? 5 : 6;
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      style={{ transform: "rotate(" + rotate + "deg)" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-chevrons={count}
    >
      {xs.map((x) => (
        <polyline key={x} points={x + "," + (12 - half) + " " + (x + half) + ",12 " + x + "," + (12 + half)} />
      ))}
    </svg>
  );
}

/**
 * Top-right panel during a hold-and-drag. The pointed direction shows its stage as
 * one to three chevrons, and its background fills toward the next stage.
 */
function ArrowPanel({ state }: { state: ArrowState }) {
  const { direction, stage, progress } = state;
  const sending = stage > 0 ? direction : null;
  const current = ARROWS.find((a) => a.direction === sending);
  const percent = Math.round(progress * 100);
  return (
    <div
      role="status"
      aria-label={current ? "방향키 " + current.label + " " + stage + "단계" : "방향키"}
      data-testid="arrow-panel"
      data-direction={sending ?? ""}
      data-pointing={direction ?? ""}
      data-stage={stage}
      data-progress={percent}
      className="pointer-events-none absolute right-3 top-3 grid grid-cols-3 grid-rows-3 gap-0.5 rounded-xl bg-black/35 p-1.5"
    >
      {ARROWS.map(({ direction: d, cell, rotate, fill }) => {
        const pointed = d === direction;
        const vertical = d === "up" || d === "down";
        return (
          <div
            key={d}
            data-active={d === sending}
            data-stage={pointed ? stage : 0}
            className={cn(
              cell,
              "relative flex size-7 items-center justify-center overflow-hidden rounded-md",
              pointed ? "bg-white/20 text-white" : "bg-white/10 text-white/45",
            )}
          >
            {pointed && (
              <div
                data-testid="arrow-progress"
                className={cn("absolute bg-white/85", fill)}
                style={vertical ? { height: percent + "%" } : { width: percent + "%" }}
              />
            )}
            {/* Difference blend keeps the chevrons readable over the filled part. */}
            <span className={cn("relative flex", pointed && "mix-blend-difference")}>
              <Chevrons count={pointed ? Math.min(Math.max(stage, 1), ARROW_STAGES.length) : 1} rotate={rotate} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
