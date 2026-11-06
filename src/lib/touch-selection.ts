// Touch gestures for xterm. A plain one-finger drag scrolls the scrollback. A long press
// selects the word under the finger; dragging from there selects by character.
//
// xterm 6 drives its viewport with VS Code's SmoothScrollableElement, which only listens
// to mouse wheel events, so touch never scrolls it. Scrolling goes through
// term.scrollLines, which moves the local view and sends nothing to the server.
// Selection events are handed to xterm's own selection, so copying works as with a mouse.
import type { Terminal } from "@xterm/xterm";

const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE_PX = 10;

export function attachTouchSelection(element: HTMLElement, term: Terminal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { clientX: number; clientY: number } | null = null;
  let selecting = false;
  let dragging = false;
  let scrolling = false;
  let lastY = 0;
  let pendingPx = 0;

  const rowHeight = () => {
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
    return screen && term.rows > 0 ? screen.clientHeight / term.rows : 0;
  };

  const fire = (
    target: EventTarget,
    type: string,
    point: { clientX: number; clientY: number },
    detail = 1,
  ) => {
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

  const pressAt = (point: { clientX: number; clientY: number }, detail: number) => {
    const target = term.element;
    if (!target) return;
    const hadFocus = document.activeElement === term.textarea;
    fire(target, "mousedown", point, detail);
    // xterm focuses on mousedown. Selecting must not open the on-screen keyboard.
    if (!hadFocus) term.blur();
  };

  const cancelPress = () => {
    clearTimeout(timer);
    start = null;
  };

  const onTouchStart = (event: TouchEvent) => {
    cancelPress();
    scrolling = false;
    if (event.touches.length !== 1) return;
    const { clientX, clientY } = event.touches[0];
    start = { clientX, clientY };
    timer = setTimeout(() => {
      if (!start) return;
      selecting = true;
      dragging = false;
      pressAt(start, 2);
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!selecting) {
      if (event.touches.length !== 1) {
        cancelPress();
        scrolling = false;
        return;
      }
      if (!scrolling) {
        if (!start || Math.hypot(touch.clientX - start.clientX, touch.clientY - start.clientY) <= MOVE_TOLERANCE_PX) {
          return;
        }
        // Moved before the long press fired: this drag scrolls.
        scrolling = true;
        lastY = touch.clientY;
        pendingPx = 0;
        cancelPress();
      }
      event.preventDefault();
      event.stopPropagation();
      // Finger up shows later output, finger down shows earlier output.
      pendingPx += lastY - touch.clientY;
      lastY = touch.clientY;
      const height = rowHeight();
      if (height > 0) {
        const lines = Math.trunc(pendingPx / height);
        if (lines !== 0) {
          term.scrollLines(lines);
          pendingPx -= lines * height;
        }
      }
      return;
    }
    // The finger is selecting now, so xterm's touch scrolling must not see it.
    event.preventDefault();
    event.stopPropagation();
    if (!dragging && start) {
      if (Math.hypot(touch.clientX - start.clientX, touch.clientY - start.clientY) <= MOVE_TOLERANCE_PX) return;
      dragging = true;
      // Leave word selection and restart by character from where the press began.
      fire(document, "mouseup", start);
      pressAt(start, 1);
    }
    fire(document, "mousemove", touch);
  };

  const finish = (event: TouchEvent) => {
    cancelPress();
    if (scrolling) {
      scrolling = false;
      return;
    }
    if (!selecting) return;
    selecting = false;
    // Without this the browser sends a click, and the click would clear the selection.
    event.preventDefault();
    fire(document, "mouseup", event.changedTouches[0]);
  };

  // The browser's long-press menu would interrupt the touch.
  const onContextMenu = (event: Event) => {
    if (!selecting) return;
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
    cancelPress();
    element.removeEventListener("touchstart", onTouchStart, options);
    element.removeEventListener("touchmove", onTouchMove, options);
    element.removeEventListener("touchend", finish, options);
    element.removeEventListener("touchcancel", finish, options);
    element.removeEventListener("contextmenu", onContextMenu, true);
  };
}
