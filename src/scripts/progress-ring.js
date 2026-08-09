/** Must match `--duration` on [data-phase] groups in ProgressRing.astro */
const TRANSITION_SECONDS = 0.4;

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

/**
 * Dual-phase progress ring. Geometry percents live on the shell; ticks only
 * update --progress-work / --progress-rest on each [data-phase] group.
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
   * @param {string} prop
   * @param {number} value
   * @param {{ instant?: boolean, durationSeconds?: number }} [opts]
   */
  function setPhaseProgress(
    el,
    prop,
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
    el.style.setProperty(prop, String(value));
    if (instant) {
      el.getBoundingClientRect();
      el.style.removeProperty("transition");
    }
  }

  function paint(workProgress, restProgress, { instant = false } = {}) {
    setPhaseProgress($work, "--progress-work", workProgress, { instant });
    setPhaseProgress($rest, "--progress-rest", restProgress, { instant });
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

    const actual = progressAt(elapsed, duration);
    const leadSec = settle ? 0 : Math.min(TRANSITION_SECONDS, remaining);
    const led = progressAt(Math.min(duration, elapsed + leadSec), duration);
    const transitionSec = settle
      ? TRANSITION_SECONDS
      : Math.min(TRANSITION_SECONDS, remaining);

    const actualWork = phase === "work" ? actual : phase === "rest" ? 100 : 0;
    const ledWork = phase === "work" ? led : phase === "rest" ? 100 : 0;
    const actualRest = phase === "rest" ? actual : 0;
    const ledRest = phase === "rest" ? led : 0;

    const workInstant = settle || ledWork < prevWork - 0.001;
    const restInstant = settle || ledRest < prevRest - 0.001;

    setPhaseProgress($work, "--progress-work", workInstant ? actualWork : ledWork, {
      instant: workInstant,
      durationSeconds: transitionSec,
    });
    setPhaseProgress($rest, "--progress-rest", restInstant ? actualRest : ledRest, {
      instant: restInstant,
      durationSeconds: transitionSec,
    });
    prevWork = workInstant ? actualWork : ledWork;
    prevRest = restInstant ? actualRest : ledRest;
  }

  function reset() {
    paint(0, 0, { instant: true });
  }

  return { setTotals, setProgress, reset };
}
