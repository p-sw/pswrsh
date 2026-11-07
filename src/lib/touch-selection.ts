// Touch gestures for xterm on phones.
// - Moving within HOLD_MS of touching: scrollback. A finger moving down shows earlier output.
// - Holding still for HOLD_MS: hold. Lifting in place over text selects the word under
//   the finger and copies it; over a blank cell it pastes the clipboard. Dragging instead
//   sends arrow keys along the main axis.
//
// xterm 6 drives its viewport with VS Code's SmoothScrollableElement, which only listens
// to mouse wheel events, so touch never scrolls it. Scrolling goes through
// term.scrollLines, which moves the local view and sends nothing to the server.
// Word selection is handed to xterm's own selection, as with a double click.
import type { Terminal } from "@xterm/xterm";

/** Starting values. Tune on real phones. */
export const HOLD_MS = 400;
/** Movement before HOLD_MS that turns the touch into a scroll. */
const MOVE_TOLERANCE_PX = 10;
/** Distance from the hold point along the main axis before arrows start. */
export const ARROW_START_PX = 12;
/** Beyond this distance arrows repeat fast. */
export const ARROW_FAST_PX = 40;
export const ARROW_SLOW_PER_SECOND = 4;
export const ARROW_FAST_PER_SECOND = 15;

export type ArrowDirection = "up" | "down" | "left" | "right";

type Point = { clientX: number; clientY: number };

type Handlers = {
  /** Sends one arrow key press through xterm's keyboard handling. */
  onArrow: (direction: ArrowDirection) => void;
  /** Called while the finger lifts, so clipboard writes still count as a user gesture. */
  onCopy: (text: string) => void;
  /** Called while the finger lifts over a blank cell, so the clipboard read counts as a user gesture. */
  onPaste: () => void;
  /**
   * The arrow drag: active from the first arrow until the finger lifts, with the
   * direction being sent (null while the finger is back near the hold point).
   */
  onArrowState?: (state: { active: boolean; direction: ArrowDirection | null }) => void;
};

export function attachTouchSelection(element: HTMLElement, term: Terminal, handlers: Handlers) {
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let repeatTimer: ReturnType<typeof setTimeout> | undefined;
  let start: Point | null = null;
  let last: Point | null = null;
  let mode: "idle" | "pending" | "scroll" | "hold" = "idle";
  let holdPoint: Point | null = null;
  let arrowed = false;
  let overBlank = false;
  let direction: ArrowDirection | null = null;
  let fast = false;
  let lastY = 0;
  let pendingPx = 0;

  const rowHeight = () => {
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
    return screen && term.rows > 0 ? screen.clientHeight / term.rows : 0;
  };

  const fire = (target: EventTarget, type: string, point: Point, detail = 1) => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        detail,
        button: 0,
        buttons: type === "mouseup" ? 0 : 1,
        clientX: point.clientX,
        clientY: point.clientY,
        // While an app tracks the mouse, xterm selects only with this modifier.
        shiftKey: term.modes.mouseTrackingMode !== "none",
      }),
    );
  };

  /** Whether the buffer cell under the point holds no text (empty or a space). */
  const isBlankAt = (point: Point) => {
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
    if (!screen || term.cols <= 0 || term.rows <= 0) return false;
    const rect = screen.getBoundingClientRect();
    const col = Math.floor(((point.clientX - rect.left) / rect.width) * term.cols);
    const row = Math.floor(((point.clientY - rect.top) / rect.height) * term.rows);
    if (col < 0 || row < 0 || col >= term.cols || row >= term.rows) return false;
    const buffer = term.buffer.active;
    const cell = buffer.getLine(buffer.viewportY + row)?.getCell(col);
    if (!cell) return true;
    // Width 0 is the right half of a wide character, which is text.
    if (cell.getWidth() === 0) return false;
    const chars = cell.getChars();
    return chars === "" || chars === " ";
  };

  /** Double click at the point: xterm selects the word there. */
  const selectWordAt = (point: Point) => {
    const target = term.element;
    if (!target) return;
    const hadFocus = document.activeElement === term.textarea;
    fire(target, "mousedown", point, 2);
    fire(document, "mouseup", point, 2);
    // xterm focuses on mousedown. Selecting must not open the on-screen keyboard.
    if (!hadFocus) term.blur();
  };

  const stopRepeat = () => {
    clearTimeout(repeatTimer);
    repeatTimer = undefined;
  };

  const scheduleRepeat = () => {
    stopRepeat();
    repeatTimer = setTimeout(
      () => {
        if (!direction) return;
        handlers.onArrow(direction);
        scheduleRepeat();
      },
      1000 / (fast ? ARROW_FAST_PER_SECOND : ARROW_SLOW_PER_SECOND),
    );
  };

  const reset = () => {
    if (arrowed) handlers.onArrowState?.({ active: false, direction: null });
    clearTimeout(holdTimer);
    stopRepeat();
    mode = "idle";
    start = last = holdPoint = null;
    arrowed = false;
    overBlank = false;
    direction = null;
    fast = false;
  };

  const onTouchStart = (event: TouchEvent) => {
    reset();
    if (event.touches.length !== 1) return;
    const { clientX, clientY } = event.touches[0];
    start = last = { clientX, clientY };
    mode = "pending";
    holdTimer = setTimeout(() => {
      if (mode !== "pending" || !last) return;
      mode = "hold";
      holdPoint = last;
      overBlank = isBlankAt(holdPoint);
      if (!overBlank) selectWordAt(holdPoint);
    }, HOLD_MS);
  };

  const scrollBy = (clientY: number) => {
    // Finger up shows later output, finger down shows earlier output.
    pendingPx += lastY - clientY;
    lastY = clientY;
    const height = rowHeight();
    if (height <= 0) return;
    const lines = Math.trunc(pendingPx / height);
    if (lines !== 0) {
      term.scrollLines(lines);
      pendingPx -= lines * height;
    }
  };

  const arrowsTo = (touch: Point) => {
    if (!holdPoint) return;
    const dx = touch.clientX - holdPoint.clientX;
    const dy = touch.clientY - holdPoint.clientY;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const distance = horizontal ? Math.abs(dx) : Math.abs(dy);
    if (distance < ARROW_START_PX) {
      if (direction && arrowed) handlers.onArrowState?.({ active: true, direction: null });
      direction = null;
      stopRepeat();
      return;
    }
    const next: ArrowDirection = horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    const nextFast = distance > ARROW_FAST_PX;
    if (!arrowed) {
      // The drag is for arrows, not for the word picked at the hold.
      arrowed = true;
      term.clearSelection();
    }
    if (next !== direction) {
      direction = next;
      fast = nextFast;
      handlers.onArrowState?.({ active: true, direction: next });
      handlers.onArrow(next);
      scheduleRepeat();
    } else if (nextFast !== fast) {
      fast = nextFast;
      scheduleRepeat();
    }
  };

  const onTouchMove = (event: TouchEvent) => {
    if (mode === "idle") return;
    if (event.touches.length !== 1) {
      reset();
      return;
    }
    const touch = event.touches[0];
    const point = { clientX: touch.clientX, clientY: touch.clientY };
    last = point;
    if (mode === "pending") {
      if (!start || Math.hypot(point.clientX - start.clientX, point.clientY - start.clientY) <= MOVE_TOLERANCE_PX) {
        return;
      }
      // Moved before the hold: this drag scrolls.
      clearTimeout(holdTimer);
      mode = "scroll";
      lastY = point.clientY;
      pendingPx = 0;
    }
    // xterm and the page must not see this finger.
    event.preventDefault();
    event.stopPropagation();
    if (mode === "scroll") scrollBy(point.clientY);
    else arrowsTo(point);
  };

  const finish = (event: TouchEvent) => {
    const wasHold = mode === "hold";
    const liftedInPlace = wasHold && !arrowed && event.type === "touchend";
    const paste = liftedInPlace && overBlank;
    const copyWord = liftedInPlace && !overBlank;
    reset();
    if (!wasHold) return;
    // Without this the browser sends a click, and the click would clear the selection.
    event.preventDefault();
    if (paste) handlers.onPaste();
    if (copyWord) {
      const text = term.getSelection();
      if (text) handlers.onCopy(text);
    }
  };

  // The browser's long-press menu would interrupt the hold.
  const onContextMenu = (event: Event) => {
    if (mode !== "hold" && mode !== "pending") return;
    event.preventDefault();
    event.stopPropagation();
  };

  const options = { capture: true, passive: false } as const;
  element.addEventListener("touchstart", onTouchStart, options);
  element.addEventListener("touchmove", onTouchMove, options);
  element.addEventListener("touchend", finish, options);
  element.addEventListener("touchcancel", finish, options);
  element.addEventListener("contextmenu", onContextMenu, true);

  return () => {
    reset();
    element.removeEventListener("touchstart", onTouchStart, options);
    element.removeEventListener("touchmove", onTouchMove, options);
    element.removeEventListener("touchend", finish, options);
    element.removeEventListener("touchcancel", finish, options);
    element.removeEventListener("contextmenu", onContextMenu, true);
  };
}
