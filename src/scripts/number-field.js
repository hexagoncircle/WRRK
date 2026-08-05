import { formatMSS } from "./format.js";
import { clamp } from "./utils.js";

/** Encode total seconds as an M SS digit buffer (e.g. 3:45 → 345). */
function secondsToMss(totalSeconds) {
  const safe = Math.max(0, Math.trunc(totalSeconds));
  return Math.floor(safe / 60) * 100 + (safe % 60);
}

function splitMss(mss) {
  const safe = Math.max(0, Math.trunc(mss));
  return [Math.floor(safe / 100), safe % 100];
}

/** Decode an M SS digit buffer to total seconds (e.g. 345 → 225). */
function mssToSeconds(mss) {
  const [minutes, seconds] = splitMss(mss);
  return minutes * 60 + seconds;
}

/** Format digit buffer as M:SS without normalizing seconds (e.g. 569 → "5:69"). */
function formatMssBuffer(mss) {
  const [minutes, seconds] = splitMss(mss);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseDurationInput(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds > 59) return null;
  return minutes * 60 + seconds;
}

/**
 * Keep a focused input visible above the on-screen keyboard.
 * iOS Safari often skips its avoidance scroll when focus handlers mutate
 * value/selection; typing then forces a layout pass. Re-run on visualViewport
 * resize so we catch the keyboard inset after it animates in.
 */
function revealFocusedInput(input) {
  const run = () => {
    if (document.activeElement !== input) return;
    input.scrollIntoView({ block: "center", inline: "nearest" });
  };

  run();
  requestAnimationFrame(run);

  const vv = window.visualViewport;
  if (!vv) return;

  const onViewportResize = () => run();
  vv.addEventListener("resize", onViewportResize);
  input.addEventListener("blur", () => vv.removeEventListener("resize", onViewportResize), {
    once: true,
  });
}

const supportsBeforeInput =
  typeof InputEvent !== "undefined" && "inputType" in InputEvent.prototype;

/**
 * @param {HTMLElement} root
 */
function enhanceNumberField(root) {
  const $input = root.querySelector(".input");
  const $decrement = root.querySelector(".decrement");
  const $increment = root.querySelector(".increment");

  if (
    !($input instanceof HTMLInputElement) ||
    !($decrement instanceof HTMLButtonElement) ||
    !($increment instanceof HTMLButtonElement)
  ) {
    return null;
  }

  const min = Number(root.dataset.min);
  const max = Number(root.dataset.max);
  const step = Number(root.dataset.step ?? 1);
  const isDuration = root.dataset.duration === "true";
  const name = root.dataset.name ?? $input.name;

  let value = isDuration
    ? clamp(parseDurationInput($input.value) ?? min, min, max)
    : clamp(Number.parseInt($input.value, 10), min, max);

  let digitBuffer = secondsToMss(value);
  let draftText = String(value);
  /** Next digit replaces the buffer (select-to-type a new value). */
  let replaceOnNextDigit = false;

  const formatValue = (next) => (isDuration ? formatMSS(next) : String(next));
  const isDisabled = () => root.hasAttribute("data-disabled");
  const isFullySelected = () =>
    $input.selectionStart === 0 && $input.selectionEnd === $input.value.length;
  const inputFocused = () => document.activeElement === $input;

  const syncButtons = (next) => {
    const disabled = isDisabled();
    $decrement.disabled = disabled || next <= min;
    $increment.disabled = disabled || next + step > max;
    $input.disabled = disabled;
  };

  const setValue = (next, { silent = false } = {}) => {
    const clamped = clamp(next, min, max);
    const changed = clamped !== value;
    value = clamped;
    digitBuffer = secondsToMss(value);
    draftText = String(value);
    $input.value = formatValue(value);
    syncButtons(value);

    if (!silent && changed) {
      root.dispatchEvent(
        new CustomEvent("number-field-change", {
          detail: { name, value },
          bubbles: true,
        }),
      );
    }
  };

  /** Empty/invalid drafts keep the previous value. Duration allows unnormalized seconds. */
  const readDraft = () => {
    if (isDuration) return mssToSeconds(digitBuffer);
    const parsed = Number.parseInt(draftText || $input.value, 10);
    return Number.isFinite(parsed) ? parsed : value;
  };

  const armReplace = () => {
    replaceOnNextDigit = true;
    if (isDuration) $input.value = formatMssBuffer(digitBuffer);
  };

  const setDisabled = (disabled) => {
    if (disabled) root.setAttribute("data-disabled", "");
    else root.removeAttribute("data-disabled");
    syncButtons(value);
  };

  /** Commit draft, then step — single change event. */
  const stepBy = (delta) => {
    if (isDisabled()) return;
    setValue(readDraft() + delta);
    if (inputFocused()) armReplace();
  };

  // Keep the input focused (and mobile keyboard open) when using steppers.
  const preserveInputFocus = (event) => {
    event.preventDefault();
  };
  $decrement.addEventListener("pointerdown", preserveInputFocus);
  $increment.addEventListener("pointerdown", preserveInputFocus);
  $decrement.addEventListener("click", () => stepBy(-step));
  $increment.addEventListener("click", () => stepBy(step));

  $input.addEventListener("focus", () => {
    if (isDuration) {
      digitBuffer = secondsToMss(value);
      $input.value = formatMssBuffer(digitBuffer);
    } else {
      draftText = String(value);
      $input.value = draftText;
    }
    replaceOnNextDigit = true;
    requestAnimationFrame(() => {
      if (inputFocused()) revealFocusedInput($input);
    });
  });

  $input.addEventListener("keydown", (event) => {
    if (isDisabled()) return;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.shiftKey ? step * 5 : step;
      stepBy(event.key === "ArrowUp" ? delta : -delta);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setValue(min);
      if (inputFocused()) armReplace();
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setValue(max);
      if (inputFocused()) armReplace();
      return;
    }

    // Blur commits; Escape reverts first so blur is a no-op change.
    if (event.key === "Enter") {
      event.preventDefault();
      $input.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      replaceOnNextDigit = false;
      digitBuffer = secondsToMss(value);
      draftText = String(value);
      $input.value = formatValue(value);
      $input.blur();
    }
  });

  if (isDuration) {
    const renderBuffer = () => {
      $input.value = formatMssBuffer(digitBuffer);
    };

    const pushDigit = (digit) => {
      if (replaceOnNextDigit || isFullySelected()) {
        digitBuffer = digit;
        replaceOnNextDigit = false;
      } else {
        digitBuffer = (digitBuffer % 100) * 10 + digit;
      }
      renderBuffer();
    };

    const popDigit = () => {
      if (replaceOnNextDigit || isFullySelected()) {
        digitBuffer = 0;
        replaceOnNextDigit = false;
      } else {
        digitBuffer = Math.floor(digitBuffer / 10);
      }
      renderBuffer();
    };

    $input.addEventListener("beforeinput", (event) => {
      if (isDisabled()) {
        event.preventDefault();
        return;
      }

      event.preventDefault();

      if (event.inputType === "insertText" && event.data && /^\d$/.test(event.data)) {
        pushDigit(Number(event.data));
        return;
      }

      if (
        event.inputType === "deleteContentBackward" ||
        event.inputType === "deleteContentForward"
      ) {
        popDigit();
      }
    });

    // Fallback when beforeinput is unavailable.
    if (!supportsBeforeInput) {
      $input.addEventListener("keydown", (event) => {
        if (isDisabled()) return;

        if (event.key >= "0" && event.key <= "9") {
          if (event.repeat) return;
          event.preventDefault();
          pushDigit(Number(event.key));
          return;
        }

        if (event.key === "Backspace") {
          event.preventDefault();
          popDigit();
        }
      });
    }

    $input.addEventListener("blur", () => {
      replaceOnNextDigit = false;
      setValue(mssToSeconds(digitBuffer));
    });
  } else {
    $input.addEventListener("beforeinput", (event) => {
      if (isDisabled()) {
        event.preventDefault();
        return;
      }

      if (
        replaceOnNextDigit &&
        event.inputType === "insertText" &&
        event.data &&
        /\d/.test(event.data)
      ) {
        event.preventDefault();
        draftText = event.data.replace(/\D/g, "");
        $input.value = draftText;
        replaceOnNextDigit = false;
        return;
      }

      if (
        replaceOnNextDigit &&
        (event.inputType === "deleteContentBackward" || event.inputType === "deleteContentForward")
      ) {
        event.preventDefault();
        draftText = "";
        $input.value = "";
        replaceOnNextDigit = false;
        return;
      }

      if (event.inputType === "insertText" && event.data && /\D/.test(event.data)) {
        event.preventDefault();
      }
    });

    $input.addEventListener("input", () => {
      draftText = $input.value.replace(/\D/g, "");
      if ($input.value !== draftText) $input.value = draftText;
    });

    $input.addEventListener("blur", () => {
      replaceOnNextDigit = false;
      setValue(readDraft());
    });
  }

  setValue(value, { silent: true });

  return {
    getValue: () => value,
    setValue: (next) => setValue(next, { silent: true }),
    setDisabled,
    get name() {
      return name;
    },
  };
}

/**
 * @param {ParentNode} [scope]
 */
export function enhanceNumberFields(scope = document) {
  const fields = [];
  for (const root of scope.querySelectorAll("[data-number-field]")) {
    if (!(root instanceof HTMLElement)) continue;
    const api = enhanceNumberField(root);
    if (api) fields.push(api);
  }
  return fields;
}
