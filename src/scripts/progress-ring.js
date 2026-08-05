import { normalize, phasePercents } from "./utils.js";

/**
 * Dual-phase progress ring driven by CSS custom properties.
 * Geometry percents are set on the ring shell; ticks only update
 * --progress-work / --progress-rest (0–100) on each [data-phase] group.
 * Phase seam rotation is derived in CSS from --ring-gap + work percent.
 *
 * Ticks arrive faster (~250ms) than the CSS transition (400ms). Targeting the
 * *current* progress would leave each fill unfinished when the next tick
 * retargets, so the ring always lags. Instead we lead by the transition
 * duration: aim at where progress will be when the transition ends, so a
 * linear fill stays time-aligned even as ticks interrupt mid-flight.
 *
 * @param {HTMLElement} root Element with .progress-ring (ring shell)
 */

/** Must match `--duration` on [data-phase] groups in ProgressRing.astro */
const TRANSITION_SECONDS = 0.4;

export function createProgressRing(root) {
  const $workGroup = root.querySelector('[data-phase="work"]');
  const $restGroup = root.querySelector('[data-phase="rest"]');

  let prevWorkProgress = 0;
  let prevRestProgress = 0;

  /**
   * @param {SVGGElement | null} el
   * @param {number} seconds
   */
  function setTransitionDuration(el, seconds) {
    if (!el) return;
    if (seconds >= TRANSITION_SECONDS - 0.001) {
      el.style.removeProperty("--duration");
      return;
    }
    el.style.setProperty("--duration", `${Math.max(0, seconds)}s`);
  }

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
    const apply = () => {
      setTransitionDuration(el, durationSeconds);
      el.style.setProperty(prop, String(value));
    };
    if (instant) {
      el.style.transition = "none";
      apply();
      void el.getBoundingClientRect();
      el.style.removeProperty("transition");
      return;
    }
    apply();
  }

  /**
   * @param {number} workProgress
   * @param {number} restProgress
   * @param {{ instant?: boolean }} [opts]
   */
  function paintProgress(workProgress, restProgress, { instant = false } = {}) {
    setPhaseProgress($workGroup, "--progress-work", workProgress, { instant });
    setPhaseProgress($restGroup, "--progress-rest", restProgress, { instant });
    prevWorkProgress = workProgress;
    prevRestProgress = restProgress;
  }

  /** Paint fills at full progress (idle / pre-workout). */
  function showFull() {
    paintProgress(100, 100, { instant: true });
  }

  /**
   * Resize phase geometry from work/rest durations.
   * Pass restSeconds=0 for last-round (work-only) layout — rest arc hides and
   * work fills the circle minus the top --ring-gap for round linecaps.
   * @param {number} workSeconds
   * @param {number} restSeconds
   * @param {{ fill?: boolean }} [opts] When fill is true (default), show fills full (idle).
   */
  function setTotals(workSeconds, restSeconds, { fill = true } = {}) {
    const { workPercent, restPercent } = phasePercents(workSeconds, restSeconds);

    root.style.setProperty("--progress-work-percent", String(workPercent));
    root.style.setProperty("--progress-rest-percent", String(restPercent));

    if (fill) showFull();
  }

  /**
   * Map elapsed time within a phase to a 0–100 fill amount.
   * @param {number} elapsed
   * @param {number} duration
   */
  function progressAt(elapsed, duration) {
    if (duration === 0) return 0;
    return Math.min(100, Math.max(0, normalize(elapsed, 0, duration, 0, 100)));
  }

  /**
   * Update fill arcs from the active phase countdown.
   * @param {{
   *   phase: 'work' | 'rest' | null,
   *   remainingSeconds: number,
   *   durationSeconds: number,
   * }} state
   * @param {{ settle?: boolean }} [opts] When true, snap to the true (non-led)
   *   progress — used on pause so the ring does not keep easing past freeze.
   */
  function setProgress({ phase, remainingSeconds, durationSeconds }, { settle = false } = {}) {
    const duration = Math.max(0, Number(durationSeconds) || 0);
    const remaining = Math.max(0, Number(remainingSeconds) || 0);
    const elapsed = duration === 0 ? 0 : duration - remaining;

    const actual = progressAt(elapsed, duration);
    // Lead by the CSS transition so the fill arrives when real time does.
    const leadSec = settle ? 0 : Math.min(TRANSITION_SECONDS, remaining);
    const led = progressAt(Math.min(duration, elapsed + leadSec), duration);
    const transitionSec = settle
      ? TRANSITION_SECONDS
      : Math.min(TRANSITION_SECONDS, Math.max(remaining, 0));

    let actualWork = 0;
    let actualRest = 0;
    let ledWork = 0;
    let ledRest = 0;

    if (phase === "work") {
      actualWork = actual;
      ledWork = led;
    } else if (phase === "rest") {
      actualWork = 100;
      ledWork = 100;
      actualRest = actual;
      ledRest = led;
    }

    // Snap when settling or regressing; otherwise aim ahead of real time.
    const workInstant = settle || ledWork < prevWorkProgress - 0.001;
    const restInstant = settle || ledRest < prevRestProgress - 0.001;

    setPhaseProgress($workGroup, "--progress-work", workInstant ? actualWork : ledWork, {
      instant: workInstant,
      durationSeconds: transitionSec,
    });
    setPhaseProgress($restGroup, "--progress-rest", restInstant ? actualRest : ledRest, {
      instant: restInstant,
      durationSeconds: transitionSec,
    });
    prevWorkProgress = workInstant ? actualWork : ledWork;
    prevRestProgress = restInstant ? actualRest : ledRest;
  }

  /** Clears fills to 0 instantly while keeping current totals. */
  function reset() {
    paintProgress(0, 0, { instant: true });
  }

  return { setTotals, setProgress, reset };
}
