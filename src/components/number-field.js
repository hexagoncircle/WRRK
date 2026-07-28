import { formatMSS } from "../scripts/format.js";

/**
 * Encode total seconds as an M SS digit buffer (e.g. 3:45 → 345).
 * @param {number} totalSeconds
 * @returns {number}
 */
function secondsToMss(totalSeconds) {
  const safe = Math.max(0, Math.trunc(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return minutes * 100 + seconds;
}

/**
 * Decode an M SS digit buffer to total seconds (e.g. 345 → 225).
 * Seconds may be > 59; callers normalize on commit via formatMSS.
 * @param {number} mss
 * @returns {number}
 */
function mssToSeconds(mss) {
  const safe = Math.max(0, Math.trunc(mss));
  const minutes = Math.floor(safe / 100);
  const seconds = safe % 100;
  return minutes * 60 + seconds;
}

/**
 * Format a digit buffer as M:SS without normalizing seconds (e.g. 569 → "5:69").
 * @param {number} mss
 * @returns {string}
 */
function formatMssBuffer(mss) {
  const safe = Math.max(0, Math.trunc(mss));
  const minutes = Math.floor(safe / 100);
  const seconds = safe % 100;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * @param {number} value
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(value, lo, hi) {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(value)));
}

/**
 * @param {string} text
 * @returns {number | null}
 */
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
 * @param {HTMLInputElement} input
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
  input.addEventListener(
    "blur",
    () => {
      vv.removeEventListener("resize", onViewportResize);
    },
    { once: true },
  );
}

/**
 * Progressive enhancement for a NumberField control.
 * @param {HTMLElement} root
 */
export function enhanceNumberField(root) {
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

  /** @type {number} Committed numeric value (seconds or count). */
  let value = isDuration
    ? clamp(parseDurationInput($input.value) ?? min, min, max)
    : clamp(Number.parseInt($input.value, 10), min, max);

  /** @type {number} M SS digit buffer while editing durations. */
  let digitBuffer = secondsToMss(value);
  /** @type {string} Draft text for non-duration fields while focused. */
  let draftText = String(value);
  /** Next digit replaces the buffer (select-to-type a new duration). */
  let replaceOnNextDigit = false;

  /**
   * @param {number} next
   * @returns {string}
   */
  const formatValue = (next) => (isDuration ? formatMSS(next) : String(next));

  /**
   * @returns {boolean}
   */
  const isFullySelected = () =>
    $input.selectionStart === 0 && $input.selectionEnd === $input.value.length;

  /**
   * @param {number} next
   */
  const syncButtons = (next) => {
    const disabled = root.hasAttribute("data-disabled");
    $decrement.disabled = disabled || next <= min;
    $increment.disabled = disabled || next + step > max;
    $input.disabled = disabled;
  };

  /**
   * Show formatted text in the input without committing.
   * @param {number} next
   */
  const renderInput = (next) => {
    $input.value = formatValue(next);
  };

  /**
   * @param {number} next
   * @param {{ silent?: boolean }} [options]
   */
  const setValue = (next, options = {}) => {
    value = clamp(next, min, max);
    digitBuffer = secondsToMss(value);
    draftText = String(value);
    renderInput(value);
    syncButtons(value);

    if (!options.silent) {
      root.dispatchEvent(
        new CustomEvent("number-field-change", {
          detail: { name, value },
          bubbles: true,
        }),
      );
    }
  };

  /**
   * Read the in-progress draft; empty/invalid rounds keep the previous value.
   * Duration allows unnormalized seconds (e.g. 5:69) and converts on commit.
   * @returns {number}
   */
  const readDraft = () => {
    if (isDuration) return mssToSeconds(digitBuffer);
    const parsed = Number.parseInt(draftText || $input.value, 10);
    return Number.isFinite(parsed) ? parsed : value;
  };

  /**
   * After commit while still editing: next typed digit starts a new value.
   */
  const armReplace = () => {
    replaceOnNextDigit = true;
    if (isDuration) {
      $input.value = formatMssBuffer(digitBuffer);
    }
  };

  /**
   * @returns {number}
   */
  const getValue = () => value;

  /**
   * @param {boolean} disabled
   */
  const setDisabled = (disabled) => {
    if (disabled) root.setAttribute("data-disabled", "");
    else root.removeAttribute("data-disabled");
    syncButtons(value);
  };

  /**
   * Commit draft, then step — single change event.
   * @param {number} delta
   */
  const stepBy = (delta) => {
    if (root.hasAttribute("data-disabled")) return;
    setValue(readDraft() + delta);
    if (document.activeElement === $input) armReplace();
  };

  // Keep the input focused (and mobile keyboard open) when using steppers.
  const preserveInputFocus = (event) => {
    event.preventDefault();
  };
  $decrement.addEventListener("pointerdown", preserveInputFocus);
  $increment.addEventListener("pointerdown", preserveInputFocus);

  $decrement.addEventListener("click", () => stepBy(-step));
  $increment.addEventListener("click", () => stepBy(step));

  $input.addEventListener("keydown", (event) => {
    if (root.hasAttribute("data-disabled")) return;

    // Arrow keys step by 1; Shift+Arrow by 5 (coarser jump, like a larger step).
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.shiftKey ? 5 : 1;
      stepBy(event.key === "ArrowUp" ? delta : -delta);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setValue(min);
      if (document.activeElement === $input) armReplace();
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setValue(max);
      if (document.activeElement === $input) armReplace();
      return;
    }

    if (!isDuration) return;

    if (event.key === "Enter") {
      event.preventDefault();
      setValue(mssToSeconds(digitBuffer));
      replaceOnNextDigit = false;
      $input.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      replaceOnNextDigit = false;
      digitBuffer = secondsToMss(value);
      renderInput(value);
      $input.blur();
    }
  });

  if (isDuration) {
    /**
     * @param {number} digit 0-9
     */
    const pushDigit = (digit) => {
      if (replaceOnNextDigit || isFullySelected()) {
        digitBuffer = digit;
        replaceOnNextDigit = false;
      } else {
        digitBuffer = (digitBuffer % 100) * 10 + digit;
      }
      $input.value = formatMssBuffer(digitBuffer);
    };

    const popDigit = () => {
      if (replaceOnNextDigit || isFullySelected()) {
        digitBuffer = 0;
        replaceOnNextDigit = false;
      } else {
        digitBuffer = Math.floor(digitBuffer / 10);
      }
      $input.value = formatMssBuffer(digitBuffer);
    };

    $input.addEventListener("focus", () => {
      digitBuffer = secondsToMss(value);
      $input.value = formatMssBuffer(digitBuffer);
      replaceOnNextDigit = true;
      requestAnimationFrame(() => {
        if (document.activeElement !== $input) return;
        revealFocusedInput($input);
      });
    });

    $input.addEventListener("beforeinput", (event) => {
      if (root.hasAttribute("data-disabled")) {
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
    $input.addEventListener("keydown", (event) => {
      if (root.hasAttribute("data-disabled")) return;
      if (typeof InputEvent !== "undefined" && "inputType" in InputEvent.prototype) return;

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

    $input.addEventListener("blur", () => {
      replaceOnNextDigit = false;
      setValue(mssToSeconds(digitBuffer));
    });
  } else {
    $input.addEventListener("focus", () => {
      draftText = String(value);
      $input.value = draftText;
      replaceOnNextDigit = true;
      requestAnimationFrame(() => {
        if (document.activeElement !== $input) return;
        revealFocusedInput($input);
      });
    });

    $input.addEventListener("beforeinput", (event) => {
      if (root.hasAttribute("data-disabled")) {
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
        (event.inputType === "deleteContentBackward" ||
          event.inputType === "deleteContentForward")
      ) {
        event.preventDefault();
        draftText = "";
        $input.value = "";
        replaceOnNextDigit = false;
        return;
      }

      // Allow native editing; filter non-digits on insert.
      if (event.inputType === "insertText" && event.data && /\D/.test(event.data)) {
        event.preventDefault();
      }
    });

    $input.addEventListener("input", () => {
      draftText = $input.value.replace(/\D/g, "");
      if ($input.value !== draftText) $input.value = draftText;
    });

    const commitDraft = () => {
      replaceOnNextDigit = false;
      setValue(readDraft());
    };

    $input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitDraft();
        $input.blur();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        replaceOnNextDigit = false;
        draftText = String(value);
        $input.value = draftText;
        $input.blur();
      }
    });

    $input.addEventListener("blur", commitDraft);
  }

  setValue(value, { silent: true });

  return {
    getValue,
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
  /** @type {ReturnType<typeof enhanceNumberField>[]} */
  const fields = [];
  for (const root of scope.querySelectorAll("[data-number-field]")) {
    if (!(root instanceof HTMLElement)) continue;
    const api = enhanceNumberField(root);
    if (api) fields.push(api);
  }
  return fields;
}
