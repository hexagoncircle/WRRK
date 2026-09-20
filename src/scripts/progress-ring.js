/**
 * Floor for each phase when both are present. Must stay above `--ring-gap` so
 * `--arc-length` (percent − gap) never collapses to an invisible stroke.
 */
const MIN_PHASE_PERCENT = 8;

/**
 * Work/rest arc lengths as percents of the full ring (sum to 100 when both > 0).
 * When both phases are present, each arc is floored so extreme ratios still leave
 * a visible segment. Pass 0 for one side for intentional single-phase layout.
 * @param {number} workSeconds
 * @param {number} restSeconds
 * @returns {{ workPercent: number, restPercent: number }}
 */
export function phasePercents(workSeconds, restSeconds) {
  const work = Math.max(0, Number(workSeconds) || 0);
  const rest = Math.max(0, Number(restSeconds) || 0);
  const total = work + rest;
  if (total <= 0) return { workPercent: 0, restPercent: 0 };
  // Last-round / work-only (or rest-only) — no min floor.
  if (work === 0) return { workPercent: 0, restPercent: 100 };
  if (rest === 0) return { workPercent: 100, restPercent: 0 };

  let workPercent = (work / total) * 100;
  let restPercent = (rest / total) * 100;

  if (workPercent < MIN_PHASE_PERCENT) {
    workPercent = MIN_PHASE_PERCENT;
    restPercent = 100 - MIN_PHASE_PERCENT;
  } else if (restPercent < MIN_PHASE_PERCENT) {
    restPercent = MIN_PHASE_PERCENT;
    workPercent = 100 - MIN_PHASE_PERCENT;
  }

  return { workPercent, restPercent };
}
