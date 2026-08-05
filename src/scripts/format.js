/**
 * Ceil to a non-negative whole-second count.
 * @param {number} totalSeconds
 * @returns {number}
 */
export function normalizeSeconds(totalSeconds) {
  return Number.isFinite(totalSeconds) ? Math.max(0, Math.ceil(totalSeconds)) : 0;
}

/**
 * Format a non-negative duration as M:SS (unpadded minutes).
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatMSS(totalSeconds) {
  const safe = normalizeSeconds(totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * ISO 8601 duration attribute for a non-negative whole-second count (PT#M#S).
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatDurationAttr(totalSeconds) {
  const safe = normalizeSeconds(totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `PT${minutes}M${seconds}S`;
}
