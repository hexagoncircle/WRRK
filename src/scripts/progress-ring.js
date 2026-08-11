/** Must match `--duration` on [data-phase] groups in ProgressRing.astro */
const TRANSITION_SECONDS = 0.4;

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

/**
 * Dual-phase progress ring. Geometry percents live on the shell; ticks only
 * update --phase-progress on each [data-phase] group.
 *
 * Ticks (~250ms) are faster than the CSS transition (400ms), so we lead by
 * TRANSITION_SECONDS: aim where progress will be when the transition ends.
 *
 * @param {HTMLElement} root Element with .progress-ring
 */
export function createProgressRing(root) {
  const $work = root.querySelector('[data-phase="work"]');
  const $rest = root.querySelector('[data-phase="rest"]');

  let prevWork = 0;
  let prevRest = 0;

  /**
   * @param {SVGGElement | null} el
   * @param {number} value
   * @param {{ instant?: boolean, durationSeconds?: number }} [opts]
   */
  function setPhaseProgress(
    el,
    value,
    { instant = false, durationSeconds = TRANSITION_SECONDS } = {},
  ) {
    if (!el) return;

    if (durationSeconds >= TRANSITION_SECONDS - 0.001) {
      el.style.removeProperty("--duration");
    } else {
      el.style.setProperty("--duration", `${Math.max(0, durationSeconds)}s`);
    }

    if (instant) el.style.transition = "none";
    el.style.setProperty("--phase-progress", String(value));
    if (instant) {
      el.getBoundingClientRect();
      el.style.removeProperty("transition");
    }
  }

  function paint(workProgress, restProgress, { instant = false } = {}) {
    setPhaseProgress($work, workProgress, { instant });
    setPhaseProgress($rest, restProgress, { instant });
    prevWork = workProgress;
    prevRest = restProgress;
  }

  /**
   * Resize phase geometry from work/rest durations.
   * Pass restSeconds=0 for last-round (work-only) layout.
   * @param {number} workSeconds
   * @param {number} restSeconds
   * @param {{ fill?: boolean }} [opts] When fill is true (default), snap fills to full.
   */
  function setTotals(workSeconds, restSeconds, { fill = true } = {}) {
    const { workPercent, restPercent } = phasePercents(workSeconds, restSeconds);
    root.style.setProperty("--progress-work-percent", String(workPercent));
    root.style.setProperty("--progress-rest-percent", String(restPercent));
    if (fill) paint(100, 100, { instant: true });
  }

  function progressAt(elapsed, duration) {
    if (duration <= 0) return 0;
    return Math.min(100, Math.max(0, (elapsed / duration) * 100));
  }

  /** Map a single-phase progress value onto work/rest fills. */
  function valuesForPhase(phase, progress) {
    if (phase === "work") return { work: progress, rest: 0 };
    if (phase === "rest") return { work: 100, rest: progress };
    return { work: 0, rest: 0 };
  }

  /**
   * @param {{
   *   phase: 'work' | 'rest' | null,
   *   remainingSeconds: number,
   *   durationSeconds: number,
   * }} state
   * @param {{ settle?: boolean }} [opts] Snap to true progress (e.g. on pause).
   */
  function setProgress(
    { phase, remainingSeconds, durationSeconds },
    { settle = false } = {},
  ) {
    const duration = Math.max(0, Number(durationSeconds) || 0);
    const remaining = Math.max(0, Number(remainingSeconds) || 0);
    const elapsed = duration === 0 ? 0 : duration - remaining;
    const actual = valuesForPhase(phase, progressAt(elapsed, duration));

    if (settle) {
      paint(actual.work, actual.rest, { instant: true });
      return;
    }

    // Lead by transition length so CSS catches up as the next tick arrives.
    const leadSec = Math.min(TRANSITION_SECONDS, remaining);
    const led = valuesForPhase(
      phase,
      progressAt(Math.min(duration, elapsed + leadSec), duration),
    );

    const workInstant = led.work < prevWork - 0.001;
    const restInstant = led.rest < prevRest - 0.001;
    const work = workInstant ? actual.work : led.work;
    const rest = restInstant ? actual.rest : led.rest;

    setPhaseProgress($work, work, { instant: workInstant, durationSeconds: leadSec });
    setPhaseProgress($rest, rest, { instant: restInstant, durationSeconds: leadSec });
    prevWork = work;
    prevRest = rest;
  }

  function reset() {
    paint(0, 0, { instant: true });
  }

  return { setTotals, setProgress, reset };
}
