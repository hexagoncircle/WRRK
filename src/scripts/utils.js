/**
 * @param {number} value
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(value, lo, hi) {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(value)));
}

/**
 * Linear remap from one numeric range into another.
 * @param {number} number
 * @param {number} currentScaleMin
 * @param {number} currentScaleMax
 * @param {number} [newScaleMin=0]
 * @param {number} [newScaleMax=1]
 */
export const normalize = (
  number,
  currentScaleMin,
  currentScaleMax,
  newScaleMin = 0,
  newScaleMax = 1,
) => {
  const t = (number - currentScaleMin) / (currentScaleMax - currentScaleMin);
  return (newScaleMax - newScaleMin) * t + newScaleMin;
};

/**
 * Work/rest arc lengths as percents of the full ring (sum to 100 when both > 0).
 * @param {number} workSeconds
 * @param {number} restSeconds
 * @returns {{ workPercent: number, restPercent: number }}
 */
export function phasePercents(workSeconds, restSeconds) {
  const work = Math.max(0, Number(workSeconds) || 0);
  const rest = Math.max(0, Number(restSeconds) || 0);
  const total = work + rest;
  return {
    workPercent: total > 0 ? (work / total) * 100 : 0,
    restPercent: total > 0 ? (rest / total) * 100 : 0,
  };
}
