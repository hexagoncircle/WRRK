import { animate } from "motion";

const ITERATIONS = 2;
const DEFAULT_DURATION = 0.1;

/** Segment visit order for one figure-8 lap (middle visited twice). */
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

/**
 * Top→bottom settle paths with left/right bias from how each glyph flows.
 * Keep segment sets in sync with Digit.astro `[data-digit]` rules.
 */
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

/** @param {Iterable<Element>} digits @param {string | null} fill */
function setFills(digits, fill) {
  for (const digit of digits) {
    for (const path of digit.querySelectorAll("path")) {
      if (fill == null) path.style.removeProperty("fill");
      else path.style.fill = fill;
    }
  }
}

/** @param {Element} el @param {string} fill */
function setFill(el, fill) {
  el.style.fill = fill;
}

/** Scrub-safe one-shot side effect for Motion sequences. */
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

/**
 * @param {number | null | undefined} budgetSeconds
 * @param {number} [settleCount=0]
 */
function danceTimings(budgetSeconds, settleCount = 0) {
  const steps = ITERATIONS * FIGURE8.length;
  const factor = (steps - 1) / 2 + 1 + settleCount / 2;
  const duration = budgetSeconds != null ? budgetSeconds / factor : DEFAULT_DURATION;
  return { duration, step: duration * 0.5, steps };
}

/**
 * @param {Element} digit
 * @param {{ fg: string, subtle: string, duration: number, step: number, steps: number, at: number }} opts
 * @returns {{ sequence: any[], end: number }}
 */
function buildFigure8Sequence(digit, { fg, subtle, duration, step, steps, at }) {
  /** @type {any[]} */
  const sequence = [];

  sequence.push([
    toggle(
      () => setFills([digit], subtle),
      () => setFills([digit], null),
    ),
    { duration: 0, at },
  ]);

  for (let i = 0; i < steps; i++) {
    const el = digit.querySelector(`.${FIGURE8[i % FIGURE8.length]}`);
    if (!el) continue;
    const t = at + i * step;
    sequence.push(fillAt(el, fg, subtle, t));
    sequence.push(fillAt(el, subtle, fg, t + duration));
  }

  return { sequence, end: at + (steps - 1) * step + duration };
}

/**
 * @param {Element} digit
 * @param {{ fg: string, subtle: string, step: number, at: number, digitValue: string }} opts
 * @returns {{ sequence: any[], end: number }}
 */
function buildSettleSequence(digit, { fg, subtle, step, at, digitValue }) {
  const settle = settleOrder(digitValue);
  /** @type {any[]} */
  const sequence = [];

  for (let i = 0; i < settle.length; i++) {
    const el = digit.querySelector(`.${settle[i]}`);
    if (!el) continue;
    sequence.push(fillAt(el, fg, subtle, at + i * step));
  }

  return { sequence, end: at + settle.length * step };
}

/**
 * Figure-8 chase, then settle into the glyph.
 * @param {Element} digit
 * @param {{
 *   fg: string,
 *   subtle: string,
 *   budgetSeconds?: number | null,
 *   at?: number,
 *   digitValue?: string,
 * }} options
 * @returns {{ sequence: any[], end: number }}
 */
function buildDigitDanceSequence(
  digit,
  { fg, subtle, budgetSeconds = null, at = 0, digitValue },
) {
  const value = digitValue ?? digit.dataset.digit ?? "0";
  const settle = settleOrder(value);
  const { duration, step, steps } = danceTimings(budgetSeconds, settle.length);

  const chased = buildFigure8Sequence(digit, { fg, subtle, duration, step, steps, at });
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

  void controls.then(clear, clear);
  return controls;
}

/** Stop any active dance / prepare timeline and clear inline fills. */
export function cancelDigitDance() {
  const digits = activeDigits;
  const controls = activeControls;
  activeControls = null;
  activeDigits = null;
  controls?.stop();
  if (digits) setFills(digits, null);
}

/**
 * Play figure-8 chase, then stagger-settle into each digit's glyph.
 * @param {Iterable<Element>} digits
 * @param {{ budgetSeconds?: number | null }} [options]
 */
export function playDigitDance(digits, { budgetSeconds = null } = {}) {
  const list = [...digits];
  if (list.length === 0) return null;

  cancelDigitDance();

  const { fg, subtle } = themeColors(list[0]);
  setFills(list, subtle);

  /** @type {any[]} */
  const sequence = [];
  let maxEnd = 0;

  for (const d of list) {
    const { sequence: segments, end } = buildDigitDanceSequence(d, {
      fg,
      subtle,
      budgetSeconds,
      at: 0,
    });
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

  // Anchor timeline length so Motion keeps the full sequence in range.
  sequence.push([() => {}, { duration: maxEnd, at: 0, ease: "linear" }]);

  return trackControls(animate(sequence), list);
}

/**
 * Prepare countdown: ones digit counts 3→2→1 statically; the other digits dance.
 * @param {Iterable<Element>} digits
 * @param {{
 *   count?: number,
 *   beatSeconds?: number,
 *   onBeat?: (n: number) => void,
 * }} [options]
 */
export function playPrepareCountdown(digits, { count = 3, beatSeconds = 1, onBeat } = {}) {
  const list = [...digits];
  if (list.length === 0) return null;

  cancelDigitDance();

  const ones = list[list.length - 1];
  const dancers = list.slice(0, -1);

  for (const d of dancers) d.dataset.digit = "";
  ones.dataset.digit = String(count);

  const { fg, subtle } = themeColors(list[0]);
  setFills(list, subtle);

  const chase = danceTimings(beatSeconds);
  /** @type {any[]} */
  const sequence = [];
  const total = count * beatSeconds;

  for (let beat = 0; beat < count; beat++) {
    const t = beat * beatSeconds;
    const n = count - beat;
    const value = String(n);

    sequence.push([
      toggle(
        () => {
          ones.dataset.digit = value;
          setFills([ones], null);
          onBeat?.(n);
        },
        () => {
          ones.dataset.digit = beat === 0 ? "" : String(n + 1);
          setFills([ones], subtle);
        },
      ),
      { duration: 0, at: t },
    ]);

    for (const d of dancers) {
      sequence.push(
        ...buildFigure8Sequence(d, {
          fg,
          subtle,
          ...chase,
          at: t,
        }).sequence,
      );
    }
  }

  sequence.push([() => {}, { duration: total, at: 0, ease: "linear" }]);

  return trackControls(animate(sequence), list);
}
