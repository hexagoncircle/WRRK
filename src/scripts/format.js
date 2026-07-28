/**
 * Format a non-negative duration as M:SS (unpadded minutes).
 *
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatMSS(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.ceil(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
