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
/** The arrow axis switches only once the other axis is this many times longer. */
const AXIS_SWITCH_RATIO = 1.2;
/**
 * Once the finger has moved this far from the hold point, lifting it no longer copies or
 * pastes, even if it came back. Measured as the farthest distance reached during the hold.
 */
export const HOLD_CANCEL_PX = 12;
/**
 * Arrow stages by distance from the hold point along the main axis. Before the first
 * stage nothing is sent; from each stage on, arrows repeat at its rate.
 */
export const ARROW_STAGES = [
  { startPx: 24, perSecond: 4 },
  { startPx: 72, perSecond: 10 },
  { startPx: 140, perSecond: 20 },
] as const;
/**
 * Movement after the hold before the arrow panel shows the progress toward stage 1. The
 * same distance cancels the copy or paste, so the panel shows exactly when lifting no
 * longer copies.
 */
export const ARROW_PREVIEW_PX = HOLD_CANCEL_PX;

export type ArrowDirection = "up" | "down" | "left" | "right";

/** 0 before the first stage, then 1..ARROW_STAGES.length. */
export type ArrowStage = number;

export type ArrowState = {
  /** True from the panel showing until the finger lifts. */
  active: boolean;
  /** Where the finger points along the main axis. Null near the hold point. */
  direction: ArrowDirection | null;
  stage: ArrowStage;
  /** 0..1 toward the next stage; 1 at the last stage. */
  progress: number;
};

/** Stage and progress toward the next stage for a main-axis distance. */
export function arrowStageAt(distance: number): { stage: ArrowStage; progress: number } {
  let stage = 0;
  while (stage < ARROW_STAGES.length && distance >= ARROW_STAGES[stage].startPx) stage += 1;
  if (stage === ARROW_STAGES.length) return { stage, progress: 1 };
  const from = stage === 0 ? 0 : ARROW_STAGES[stage - 1].startPx;
  const to = ARROW_STAGES[stage].startPx;
  return { stage, progress: Math.min(1, Math.max(0, (distance - from) / (to - from))) };
}

type Point = { clientX: number; clientY: number };

type Handlers = {
  /** Sends one arrow key press through xterm's keyboard handling. */
  onArrow: (direction: ArrowDirection) => void;
  /** Called while the finger lifts, so clipboard writes still count as a user gesture. */
  onCopy: (text: string) => void;
  /** Called while the finger lifts over a blank cell, so the clipboard read counts as a user gesture. */
  onPaste: () => void;
  /**
   * The arrow drag: active from the finger moving after the hold until it lifts. Keys
   * are sent only while the stage is 1 or more.
   */
  onArrowState?: (state: ArrowState) => void;
};

export function attachTouchSelection(element: HTMLElement, term: Terminal, handlers: Handlers) {
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let repeatTimer: ReturnType<typeof setTimeout> | undefined;
  let start: Point | null = null;
  let last: Point | null = null;
  let mode: "idle" | "pending" | "scroll" | "hold" = "idle";
  let holdPoint: Point | null = null;
  /** True once the first arrow key went out. */
  let arrowed = false;
  /** True while the panel is shown for this drag. */
  let previewing = false;
  let overBlank = false;
  /** Direction being sent. Null before stage 1. */
  let direction: ArrowDirection | null = null;
  let stage: ArrowStage = 0;
  /** Axis of this drag. Kept until the other axis clearly wins, so diagonals do not flip it. */
  let axis: "horizontal" | "vertical" | null = null;
  /** When the last arrow key went out, so repeats keep their pace across stage changes. */
  let lastSentAt = 0;
  /** Direction of the last arrow key sent in this hold. */
  let lastSentDirection: ArrowDirection | null = null;
  /**
   * Earliest time the next key may go out, set when the finger comes back past stage 1 in
   * the direction it last sent. 0 when only the stage rate applies.
   */
  let holdBackUntil = 0;
  /** Farthest the finger got from the hold point during this hold. */
  let maxHoldDistance = 0;
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

  const sendArrow = (to: ArrowDirection) => {
    lastSentAt = performance.now();
    lastSentDirection = to;
    holdBackUntil = 0;
    handlers.onArrow(to);
  };

  /**
   * Next repeat at the current stage's rate, counted from the last key sent. Rescheduling
   * on a stage change (or a finger trembling on a stage boundary) keeps the elapsed time
   * instead of starting the wait over.
   */
  const scheduleRepeat = () => {
    stopRepeat();
    if (!direction || stage === 0) return;
    const interval = 1000 / ARROW_STAGES[stage - 1].perSecond;
    const wait = Math.max(0, Math.max(lastSentAt + interval, holdBackUntil) - performance.now());
    repeatTimer = setTimeout(() => {
      if (!direction || stage === 0) return;
      sendArrow(direction);
      scheduleRepeat();
    }, wait);
  };

  const reset = () => {
    if (previewing) handlers.onArrowState?.({ active: false, direction: null, stage: 0, progress: 0 });
    clearTimeout(holdTimer);
    stopRepeat();
    mode = "idle";
    start = last = holdPoint = null;
    arrowed = false;
    previewing = false;
    overBlank = false;
    direction = null;
    stage = 0;
    axis = null;
    lastSentAt = 0;
    lastSentDirection = null;
    holdBackUntil = 0;
    maxHoldDistance = 0;
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
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    maxHoldDistance = Math.max(maxHoldDistance, Math.hypot(dx, dy));
    if (axis === null) {
      if (ax !== ay) axis = ax > ay ? "horizontal" : "vertical";
    } else if (axis === "horizontal" ? ay > ax * AXIS_SWITCH_RATIO : ax > ay * AXIS_SWITCH_RATIO) {
      axis = axis === "horizontal" ? "vertical" : "horizontal";
    }
    const horizontal = axis === "horizontal";
    const distance = horizontal ? Math.abs(dx) : Math.abs(dy);
    const pointing: ArrowDirection | null =
      distance === 0 ? null : horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    const at = arrowStageAt(distance);
    if (!previewing && distance < ARROW_PREVIEW_PX) return;
    previewing = true;
    handlers.onArrowState?.({
      active: true,
      direction: distance < ARROW_PREVIEW_PX ? null : pointing,
      stage: at.stage,
      progress: at.progress,
    });
    if (at.stage === 0 || !pointing) {
      direction = null;
      stage = 0;
      stopRepeat();
      return;
    }
    if (!arrowed) {
      // The drag is for arrows, not for the word picked at the hold.
      arrowed = true;
      term.clearSelection();
    }
    if (pointing !== direction) {
      direction = pointing;
      stage = at.stage;
      // Coming back past stage 1 the way it last sent is not a new direction: it waits out
      // the rest of a stage-1 interval, so a finger trembling on the boundary does not
      // send a burst. A real direction change sends at once.
      const stageOneInterval = 1000 / ARROW_STAGES[0].perSecond;
      const resumeAt = lastSentAt + stageOneInterval;
      if (pointing === lastSentDirection && performance.now() < resumeAt) holdBackUntil = resumeAt;
      else sendArrow(pointing);
      scheduleRepeat();
    } else if (at.stage !== stage) {
      stage = at.stage;
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
    const liftedInPlace =
      wasHold && !arrowed && maxHoldDistance <= HOLD_CANCEL_PX && event.type === "touchend";
    const paste = liftedInPlace && overBlank;
    const copyWord = liftedInPlace && !overBlank;
    // A hold that ends without copying or arrows must not leave the held word highlighted.
    const cancelled = wasHold && !liftedInPlace && !arrowed;
    reset();
    if (!wasHold) return;
    // Without this the browser sends a click, and the click would clear the selection.
    event.preventDefault();
    if (cancelled) term.clearSelection();
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
