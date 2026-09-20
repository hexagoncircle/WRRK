/**
 * Clamp to an inclusive integer range.
 * Coerces with Number(); non-finite values become `lo`. Truncates toward zero.
 * @param {unknown} value
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

/**
 * Clamp to an inclusive numeric range without truncating.
 * Non-finite values become `lo`.
 * @param {unknown} value
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clampNumber(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Format minutes and seconds as M:SS (unpadded minutes, zero-padded seconds).
 * Does not normalize seconds ≥ 60 — callers decide.
 * @param {number} minutes
 * @param {number} seconds
 * @returns {string}
 */
export function formatClock(minutes, seconds) {
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Ceil to a non-negative whole-second count for display.
 * @param {number} totalSeconds
 * @returns {[number, number]} `[minutes, seconds]`
 */
function splitDuration(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.ceil(totalSeconds)) : 0;
  return [Math.floor(safe / 60), safe % 60];
}

/**
 * Format a non-negative duration as M:SS (unpadded minutes).
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatMSS(totalSeconds) {
  const [minutes, seconds] = splitDuration(totalSeconds);
  return formatClock(minutes, seconds);
}

/**
 * ISO 8601 duration attribute for a non-negative whole-second count (PT#M#S).
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatDurationAttr(totalSeconds) {
  const [minutes, seconds] = splitDuration(totalSeconds);
  return `PT${minutes}M${seconds}S`;
}

/**
 * Cancelable timeout handle. Clear is idempotent.
 * @returns {{ set: (fn: () => void, ms: number) => void, clear: () => void }}
 */
export function createTimeout() {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let id = null;

  return {
    /**
     * @param {() => void} fn
     * @param {number} ms
     */
    set(fn, ms) {
      if (id != null) clearTimeout(id);
      id = setTimeout(() => {
        id = null;
        fn();
      }, ms);
    },
    clear() {
      if (id == null) return;
      clearTimeout(id);
      id = null;
    },
  };
}
