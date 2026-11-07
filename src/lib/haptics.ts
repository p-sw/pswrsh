// A short tap of the phone's haptic motor, for keys sent by touch gestures.
// - Android (Chrome, Samsung Internet): navigator.vibrate. The page needs a past user
//   gesture (sticky activation), which any earlier tap gives.
// - iOS Safari has no vibrate. From iOS 18, toggling an <input type="checkbox" switch>
//   through its label plays the system haptic, so one hidden switch is reused for that.
//   WebKit may only allow it while a user gesture is being handled.
// Anything else does nothing, without errors.

/** Vibration length for one key. */
export const HAPTIC_VIBRATE_MS = 10;

let iosSwitchLabel: HTMLLabelElement | null = null;

function switchLabel(): HTMLLabelElement | null {
  if (iosSwitchLabel?.isConnected) return iosSwitchLabel;
  if (!document.body) return null;
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  iosSwitchLabel = label;
  return label;
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit",
]);

/** True when the element takes typed text, so focus on it keeps the on-screen keyboard open. */
function isTextInput(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !el.disabled && !NON_TEXT_INPUT_TYPES.has(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

export interface HapticOptions {
  /**
   * True when called synchronously while a user event (touchend, click) is handled.
   * iOS only reopens the keyboard after a focus change inside such a handler; a recent
   * keystroke (navigator.userActivation) does not count.
   */
  inGesture: boolean;
}

export function haptic({ inGesture }: HapticOptions) {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(HAPTIC_VIBRATE_MS);
      return;
    }
    // Outside a user event handler (touchmove, the repeat timer) iOS will not reopen the
    // keyboard after focus moves to the switch and back, so skip the haptic while typing.
    if (!inGesture && isTextInput(document.activeElement)) return;
    const label = switchLabel();
    if (!label) return;
    // Clicking the label must not take focus from the terminal and close the keyboard.
    const focused = document.activeElement;
    label.click();
    if (focused instanceof HTMLElement && document.activeElement !== focused) {
      focused.focus({ preventScroll: true });
    }
    // Focus was on body (or could not be restored): do not leave it on the hidden switch.
    const input = label.firstElementChild;
    if (input instanceof HTMLElement && document.activeElement === input) input.blur();
  } catch {
    // No haptics here.
  }
}
