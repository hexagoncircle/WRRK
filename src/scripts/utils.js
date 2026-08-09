/**
 * Clamp to an inclusive integer range.
 * Coerces with Number(); non-finite values become `lo`.
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
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
