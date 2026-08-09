import { animate } from "motion";

const ITERATIONS = 2;
const DEFAULT_DURATION = 0.1;

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

/** @type {{ stop: () => void, pause: () => void, play: () => void, time: number } | null} */
let activeControls = null;

/** @type {Element[] | null} */
let activeDigits = null;

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

/** Scrub-safe one-shot for Motion sequence callbacks. */
function toggle(onForwards, onBackwards) {
  let done = false;
  return (p) => {
    if (p >= 1 && !done) {
      done = true;
      onForwards();
    } else if (p < 1 && done) {
      done = false;
      onBackwards();
    }
  };
}

function fillAt(el, fill, undoFill, at) {
  return [
    toggle(
      () => setFill(el, fill),
      () => setFill(el, undoFill),
    ),
    { duration: 0, at },
  ];
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
  const sequence = [
    [
      toggle(
        () => setFills([digit], subtle),
        () => setFills([digit], null),
      ),
      { duration: 0, at },
    ],
  ];

  for (let i = 0; i < steps; i++) {
    const el = digit.querySelector(`.${FIGURE8[i % FIGURE8.length]}`);
    if (!el) continue;
    const t = at + i * step;
    sequence.push(fillAt(el, fg, subtle, t));
    sequence.push(fillAt(el, subtle, fg, t + duration));
  }

  return { sequence, end: at + (steps - 1) * step + duration };
}

function buildSettleSequence(digit, { fg, subtle, step, at, digitValue }) {
  const settle = settleOrder(digitValue);
  const sequence = [];

  for (let i = 0; i < settle.length; i++) {
    const el = digit.querySelector(`.${settle[i]}`);
    if (!el) continue;
    sequence.push(fillAt(el, fg, subtle, at + i * step));
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

  cancelDigitDance();

  const { fg, subtle } = themeColors(list[0]);
  setFills(list, subtle);

  const sequence = [];
  let maxEnd = 0;

  for (const d of list) {
    const { sequence: segments, end } = buildDigitDanceSequence(d, { fg, subtle });
    sequence.push(...segments);
    if (end > maxEnd) maxEnd = end;
  }

  sequence.push([
    toggle(
      () => setFills(list, null),
      () => setFills(list, subtle),
    ),
    { duration: 0, at: maxEnd },
  ]);

  sequence.push([() => {}, { duration: maxEnd, at: 0, ease: "linear" }]);

  return trackControls(animate(sequence), list);
}

/**
 * Prep chase in lockstep; on the last prep beat the ones digit settles into
 * `count`. Countdown snaps ones count→1 while other digits keep chasing.
 */
export function playCountdown(
  digits,
  { count = 3, beatSeconds = 1, prepSeconds = 0, onBeat } = {},
) {
  const list = [...digits];
  if (list.length === 0) return null;

  cancelDigitDance();

  const ones = list[list.length - 1];
  const dancers = list.slice(0, -1);
  const firstValue = String(count);

  for (const d of list) d.dataset.digit = "";

  const { fg, subtle } = themeColors(list[0]);
  setFills(list, subtle);

  const sequence = [];
  const total = prepSeconds + count * beatSeconds;
  const chase = danceTimings(beatSeconds);
  const prepBeats = Math.max(0, Math.round(prepSeconds / beatSeconds));
  const settleBeat = prepBeats > 0 ? prepBeats - 1 : -1;

  const chaseAt = (digit, at, steps = chase.steps) => {
    sequence.push(
      ...buildFigure8Sequence(digit, {
        fg,
        subtle,
        duration: chase.duration,
        step: chase.step,
        steps,
        at,
      }).sequence,
    );
  };

  for (let beat = 0; beat < prepBeats; beat++) {
    const t = beat * beatSeconds;

    if (beat === settleBeat) {
      const halfSteps = Math.max(1, Math.floor(chase.steps / 2));
      const halfEnd = t + (halfSteps - 1) * chase.step + chase.duration;

      chaseAt(ones, t, halfSteps);
      for (const d of dancers) chaseAt(d, t);

      sequence.push([
        toggle(
          () => {
            ones.dataset.digit = firstValue;
          },
          () => {
            ones.dataset.digit = "";
            setFills([ones], subtle);
          },
        ),
        { duration: 0, at: halfEnd },
      ]);

      const settled = buildSettleSequence(ones, {
        fg,
        subtle,
        step: chase.step,
        at: halfEnd,
        digitValue: firstValue,
      });
      sequence.push(...settled.sequence);
      sequence.push([
        toggle(
          () => setFills([ones], null),
          () => setFills([ones], subtle),
        ),
        { duration: 0, at: settled.end },
      ]);
      continue;
    }

    for (const d of list) chaseAt(d, t);
  }

  for (let beat = 0; beat < count; beat++) {
    const t = prepSeconds + beat * beatSeconds;
    const n = count - beat;

    sequence.push([
      toggle(
        () => {
          ones.dataset.digit = String(n);
          setFills([ones], null);
          onBeat?.(n);
        },
        () => {
          ones.dataset.digit = beat === 0 ? firstValue : String(n + 1);
          setFills([ones], beat === 0 ? null : subtle);
        },
      ),
      { duration: 0, at: t },
    ]);

    for (const d of dancers) chaseAt(d, t);
  }

  sequence.push([() => {}, { duration: total, at: 0, ease: "linear" }]);

  return trackControls(animate(sequence), list);
}
