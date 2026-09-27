const ITERATIONS = 2;
const DEFAULT_DURATION = 0.1;
const FLASH_MS = 100;

/** One figure-8 lap (middle visited twice). */
const FIGURE8 = [
  "top",
  "top-right",
  "middle",
  "bottom-left",
  "bottom",
  "bottom-right",
  "middle",
  "top-left",
];

/** Settle order per glyph; segment sets must match Digit.astro `[data-digit]` rules. */
const SETTLE_ORDER = {
  0: ["top", "top-right", "top-left", "bottom-right", "bottom-left", "bottom"],
  1: ["top-right", "bottom-right"],
  2: ["top", "top-right", "middle", "bottom-left", "bottom"],
  3: ["top", "top-right", "middle", "bottom-right", "bottom"],
  4: ["top-left", "top-right", "middle", "bottom-right"],
  5: ["top", "top-left", "middle", "bottom-right", "bottom"],
  6: ["top", "top-left", "middle", "bottom-left", "bottom", "bottom-right"],
  7: ["top", "top-right", "bottom-right"],
  8: ["top", "top-right", "top-left", "middle", "bottom-right", "bottom-left", "bottom"],
  9: ["top", "top-right", "top-left", "middle", "bottom-right"],
};

/** @type {{ stop: () => void } | null} */
let activeControls = null;

/**
 * `live` cues are side effects (blips). A seek or a catch-up gap skips them
 * and only replays the picture.
 * @typedef {{ at: number, run: () => void, live?: boolean }} Cue
 */

/** @type {Element[] | null} */
let activeDigits = null;

/**
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function themeColors(el) {
  const style = getComputedStyle(el);
  return {
    fg: style.getPropertyValue("--color-fg").trim(),
    subtle: style.getPropertyValue("--color-fg-subtle").trim(),
  };
}

function setFills(digits, fill) {
  for (const digit of digits) {
    for (const path of digit.querySelectorAll("path")) {
      if (fill == null) path.style.removeProperty("fill");
      else path.style.fill = fill;
    }
  }
}

function setFill(el, fill) {
  el.style.fill = fill;
}

/**
 * @param {HTMLElement | Element} el
 * @param {string} fill
 * @param {number} at
 * @returns {Cue}
 */
function fillAt(el, fill, at) {
  return { at, run: () => setFill(el, fill) };
}

/** A hidden tab freezes rAF, then one frame covers the gap. Skip blips past this. */
const CATCH_UP_S = 0.5;

/**
 * Fire `events` at absolute times and resolve when `durationSeconds` elapses.
 * pause/play/time match the countdown clock: pause cancels the frame loop,
 * and setting time rebuilds the picture without replaying blips.
 * stop() rejects so cancelDigitDance clears fills the same way a finished dance does.
 * @param {Cue[]} events
 * @param {number} durationSeconds
 * @param {(() => void) | undefined} [restore] rewind point for `time`
 */
function playTimeline(events, durationSeconds, restore) {
  const pending = [...events].sort((a, b) => a.at - b.at);
  let index = 0;
  let raf = 0;
  let stopped = false;
  let paused = false;
  let finished = false;
  let elapsed = 0;
  let origin = performance.now();

  /** @type {(value?: void) => void} */
  let resolve;
  /** @type {(reason?: unknown) => void} */
  let reject;
  const done = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  /**
   * @param {number} t
   * @param {boolean} live
   */
  const applyUntil = (t, live) => {
    while (index < pending.length && pending[index].at <= t) {
      const event = pending[index];
      index += 1;
      if (live || !event.live) event.run();
      if (stopped) return;
    }
  };

  const finish = () => {
    if (finished || stopped) return;
    finished = true;
    cancelAnimationFrame(raf);
    resolve();
  };

  const arm = () => {
    origin = performance.now() - elapsed * 1000;
    raf = requestAnimationFrame(frame);
  };

  /** @param {number} now */
  const frame = (now) => {
    if (stopped || paused || finished) return;
    const next = (now - origin) / 1000;
    if (next - elapsed > CATCH_UP_S) {
      elapsed = Math.min(next, durationSeconds);
      applyUntil(elapsed, false);
      if (stopped) return;
      origin = now - elapsed * 1000;
      if (elapsed >= durationSeconds) {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
      return;
    }
    elapsed = next;
    applyUntil(elapsed, true);
    if (stopped) return;
    if (elapsed >= durationSeconds) {
      finish();
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  /** @param {number} seconds */
  const seek = (seconds) => {
    if (stopped || finished) return;
    const t = Math.min(Math.max(seconds, 0), durationSeconds);
    cancelAnimationFrame(raf);
    restore?.();
    index = 0;
    elapsed = t;
    applyUntil(t, false);
    if (stopped || finished) return;
    if (t >= durationSeconds) {
      finish();
      return;
    }
    if (!paused) arm();
  };

  arm();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      reject(new DOMException("The digit dance was canceled.", "AbortError"));
    },
    pause() {
      if (stopped || finished || paused) return;
      paused = true;
      cancelAnimationFrame(raf);
      elapsed = Math.min(Math.max(0, (performance.now() - origin) / 1000), durationSeconds);
    },
    play() {
      if (stopped || finished || !paused) return;
      paused = false;
      arm();
    },
    /** @param {number} seconds */
    set time(seconds) {
      seek(seconds);
    },
    get time() {
      if (paused || finished || stopped) return elapsed;
      return Math.min(Math.max(0, (performance.now() - origin) / 1000), durationSeconds);
    },
    /**
     * @param {((value: void) => void) | null | undefined} onFulfilled
     * @param {((reason: unknown) => void) | null | undefined} onRejected
     */
    then(onFulfilled, onRejected) {
      return done.then(onFulfilled, onRejected);
    },
  };
}

function settleOrder(digitValue) {
  return SETTLE_ORDER[digitValue] ?? SETTLE_ORDER[0];
}

/** Scale chase so one full figure-8 fits in `budgetSeconds` (or use default tempo). */
function danceTimings(budgetSeconds = null) {
  const steps = ITERATIONS * FIGURE8.length;
  const factor = (steps - 1) / 2 + 1;
  const duration = budgetSeconds != null ? budgetSeconds / factor : DEFAULT_DURATION;
  return { duration, step: duration * 0.5, steps };
}

function buildFigure8Sequence(digit, { fg, subtle, duration, step, steps, at }) {
  /** @type {Cue[]} */
  const sequence = [{ at, run: () => setFills([digit], subtle) }];

  for (let i = 0; i < steps; i++) {
    const el = digit.querySelector(`.${FIGURE8[i % FIGURE8.length]}`);
    if (!el) continue;
    const t = at + i * step;
    sequence.push(fillAt(el, fg, t));
    sequence.push(fillAt(el, subtle, t + duration));
  }

  return { sequence, end: at + (steps - 1) * step + duration };
}

function buildSettleSequence(digit, { fg, subtle, step, at, digitValue }) {
  const settle = settleOrder(digitValue);
  /** @type {Cue[]} */
  const sequence = [];

  for (let i = 0; i < settle.length; i++) {
    const el = digit.querySelector(`.${settle[i]}`);
    if (!el) continue;
    sequence.push(fillAt(el, fg, at + i * step));
  }

  return { sequence, end: at + settle.length * step };
}

function buildDigitDanceSequence(digit, { fg, subtle }) {
  const value = digit.dataset.digit ?? "0";
  const { duration, step, steps } = danceTimings();

  const chased = buildFigure8Sequence(digit, { fg, subtle, duration, step, steps, at: 0 });
  const settled = buildSettleSequence(digit, {
    fg,
    subtle,
    step,
    at: chased.end,
    digitValue: value,
  });

  return {
    sequence: [...chased.sequence, ...settled.sequence],
    end: settled.end,
  };
}

function trackControls(controls, digits) {
  activeControls = controls;
  activeDigits = digits;

  const clear = () => {
    if (activeControls === controls) activeControls = null;
    if (activeDigits === digits) {
      setFills(digits, null);
      activeDigits = null;
    }
  };

  controls.then(clear, clear);
  return controls;
}

/**
 * Brief subtle flash, then snap to CSS glyph fills (reduced motion).
 * @param {Element[]} digits
 */
function playDigitFlash(digits) {
  cancelDigitDance();

  const { subtle } = themeColors(digits[0]);
  const flashSeconds = FLASH_MS / 1000;
  setFills(digits, subtle);

  return trackControls(
    playTimeline([{ at: flashSeconds, run: () => setFills(digits, null) }], flashSeconds),
    digits,
  );
}

/**
 * Reduced-motion countdown beats: snap the ones glyph, brief fill flash, no chase.
 * @param {Cue[]} sequence
 * @param {{ ones: Element, list: Element[], subtle: string, count: number, beatSeconds: number, prepSeconds: number, total: number, onBeat?: (n: number) => void }} opts
 */
function appendCountdownFlash(sequence, { ones, list, subtle, count, beatSeconds, prepSeconds, total, onBeat }) {
  const flashAt = FLASH_MS / 1000;

  for (let beat = 0; beat < count; beat++) {
    const t = prepSeconds + beat * beatSeconds;
    const n = count - beat;

    sequence.push({
      at: t,
      run: () => {
        ones.dataset.digit = String(n);
        setFills(list, subtle);
      },
    });
    sequence.push({ at: t, live: true, run: () => onBeat?.(n) });

    sequence.push({
      at: t + flashAt,
      run: () => setFills([ones], null),
    });
  }

  sequence.push({
    at: total,
    run: () => setFills(list, null),
  });
}

/**
 * Full-motion countdown: prep chase, settle ones on first beat, chase the rest.
 * @param {Cue[]} sequence
 * @param {{ ones: Element, list: Element[], fg: string, subtle: string, count: number, beatSeconds: number, prepSeconds: number, onBeat?: (n: number) => void }} opts
 */
function appendCountdownChase(sequence, { ones, list, fg, subtle, count, beatSeconds, prepSeconds, onBeat }) {
  const dancers = list.slice(0, -1);
  const firstValue = String(count);
  const chase = danceTimings(beatSeconds);
  const prepBeats = Math.max(0, Math.round(prepSeconds / beatSeconds));

  const chaseAt = (digit, at) => {
    sequence.push(
      ...buildFigure8Sequence(digit, {
        fg,
        subtle,
        duration: chase.duration,
        step: chase.step,
        steps: chase.steps,
        at,
      }).sequence,
    );
  };

  for (let beat = 0; beat < prepBeats; beat++) {
    const t = beat * beatSeconds;
    for (const d of list) chaseAt(d, t);
  }

  for (let beat = 0; beat < count; beat++) {
    const t = prepSeconds + beat * beatSeconds;
    const n = count - beat;

    if (beat === 0) {
      sequence.push({
        at: t,
        run: () => {
          ones.dataset.digit = firstValue;
          setFills([ones], subtle);
        },
      });
      sequence.push({ at: t, live: true, run: () => onBeat?.(n) });

      const settled = buildSettleSequence(ones, {
        fg,
        subtle,
        step: chase.step,
        at: t,
        digitValue: firstValue,
      });
      sequence.push(...settled.sequence);
      sequence.push({
        at: settled.end,
        run: () => setFills([ones], null),
      });
    } else {
      sequence.push({
        at: t,
        run: () => {
          ones.dataset.digit = String(n);
          setFills([ones], null);
        },
      });
      sequence.push({ at: t, live: true, run: () => onBeat?.(n) });
    }

    for (const d of dancers) chaseAt(d, t);
  }
}

export function cancelDigitDance() {
  const digits = activeDigits;
  const controls = activeControls;
  activeControls = null;
  activeDigits = null;
  controls?.stop();
  if (digits) setFills(digits, null);
}

/** Figure-8 chase, then settle into each digit's glyph. */
export function playDigitDance(digits) {
  const list = [...digits];
  if (list.length === 0) return null;

  if (prefersReducedMotion()) return playDigitFlash(list);

  cancelDigitDance();

  const { fg, subtle } = themeColors(list[0]);
  setFills(list, subtle);

  /** @type {Cue[]} */
  const sequence = [];
  let maxEnd = 0;

  for (const d of list) {
    const { sequence: segments, end } = buildDigitDanceSequence(d, { fg, subtle });
    sequence.push(...segments);
    if (end > maxEnd) maxEnd = end;
  }

  sequence.push({
    at: maxEnd,
    run: () => setFills(list, null),
  });

  return trackControls(playTimeline(sequence, maxEnd), list);
}

/**
 * Prep chase in lockstep. As countdown begins, the ones digit staggers into
 * `count` (with the first blip / "Get ready"). Later beats snap ones count→1
 * while other digits keep chasing. Reduced motion skips the chase and flashes
 * each beat instead.
 */
export function playCountdown(
  digits,
  { count = 3, beatSeconds = 1, prepSeconds = 0, onBeat } = {},
) {
  const list = [...digits];
  if (list.length === 0) return null;

  cancelDigitDance();

  const ones = list[list.length - 1];
  const { fg, subtle } = themeColors(list[0]);
  const total = prepSeconds + count * beatSeconds;
  /** @type {Cue[]} */
  const sequence = [];

  const restore = () => {
    for (const d of list) d.dataset.digit = "";
    setFills(list, subtle);
  };
  restore();

  if (prefersReducedMotion()) {
    appendCountdownFlash(sequence, {
      ones,
      list,
      subtle,
      count,
      beatSeconds,
      prepSeconds,
      total,
      onBeat,
    });
  } else {
    appendCountdownChase(sequence, {
      ones,
      list,
      fg,
      subtle,
      count,
      beatSeconds,
      prepSeconds,
      onBeat,
    });
  }

  return trackControls(playTimeline(sequence, total, restore), list);
}
