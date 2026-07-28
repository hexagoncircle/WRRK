/**
 * Format a non-negative duration as MM:SS (no hours).
 *
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatMMSS(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.ceil(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
