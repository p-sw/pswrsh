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

export function haptic() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(HAPTIC_VIBRATE_MS);
      return;
    }
    const label = switchLabel();
    if (!label) return;
    // Clicking the label must not take focus from the terminal and close the keyboard.
    const focused = document.activeElement;
    label.click();
    if (focused instanceof HTMLElement && document.activeElement !== focused) {
      focused.focus({ preventScroll: true });
    }
  } catch {
    // No haptics here.
  }
}
