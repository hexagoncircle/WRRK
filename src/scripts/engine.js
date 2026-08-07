import { Temporal } from "@js-temporal/polyfill";
import { COUNTDOWN_SECONDS, PREPARE_SECONDS, toPhases } from "./model.js";

/** @typedef {import('./model.js').TimerConfig} TimerConfig */
/** @typedef {import('./model.js').Phase} Phase */

export const STATUS = {
  running: "running",
  preparing: "preparing",
  countdown: "countdown",
  complete: "complete",
  paused: "paused",
  idle: "idle",
};

/** @typedef {typeof STATUS[keyof typeof STATUS]} EngineStatus */

/** Statuses that own a phase deadline and can be paused. */
const TIMED = new Set([STATUS.running, STATUS.preparing, STATUS.countdown]);

/**
 * Drift-free interval engine.
 * Deadlines use absolute Temporal instants so hidden-tab throttling can catch up.
 * Ticks are driven by timer-worker.js (steady cadence while the tab is hidden).
 */
export class TimerEngine extends EventTarget {
  /**
   * @param {TimerConfig} config
   */
  constructor(config) {
    super();
    this.config = config;
    /** @type {Phase[]} */
    this.phases = toPhases(config);
    /** @type {number} */
    this.phaseIndex = -1;
    /** @type {EngineStatus} */
    this.status = STATUS.idle;
    /** @type {Temporal.Duration | null} */
    this.remaining = null;
    /** @type {Temporal.Instant | null} */
    this.phaseEndInstant = null;
    /** @type {typeof STATUS.preparing | typeof STATUS.countdown | typeof STATUS.running | null} */
    this._pausedFrom = null;
    /** @type {Worker | null} */
    this._worker = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._boundaryTimer = null;
  }

  /** @returns {Phase | null} */
  get currentPhase() {
    if (this.phaseIndex < 0 || this.phaseIndex >= this.phases.length) return null;
    return this.phases[this.phaseIndex];
  }

  start() {
    if (TIMED.has(this.status)) return;
    if (this.status === STATUS.complete) return;

    if (this.status === STATUS.paused) {
      this.status = this._pausedFrom ?? STATUS.running;
      this._pausedFrom = null;
      this._scheduleEnd(this.remaining ?? Temporal.Duration.from({ seconds: 0 }));
      this.remaining = null;
      this.dispatchEvent(new CustomEvent("resume", { detail: this._phaseDetail() }));
    } else {
      this.phaseIndex = -1;
      this.status = STATUS.preparing;
      this._scheduleEnd(Temporal.Duration.from({ seconds: PREPARE_SECONDS }));
      this._emitPhaseChange();
    }

    this._startTicking();
  }

  pause() {
    if (!TIMED.has(this.status)) return;
    if (!this.phaseEndInstant) return;

    const left = Temporal.Now.instant().until(this.phaseEndInstant);
    this.remaining = left.total("seconds") < 0 ? Temporal.Duration.from({ seconds: 0 }) : left;
    this._pausedFrom = this.status;
    this.status = STATUS.paused;
    this._stopTicking();
    this.dispatchEvent(new CustomEvent("pause"));
  }

  reset() {
    this._disposeWorker();
    this.phaseIndex = -1;
    this.status = STATUS.idle;
    this.remaining = null;
    this.phaseEndInstant = null;
    this._pausedFrom = null;
    this.dispatchEvent(new CustomEvent("reset"));
  }

  _clearBoundaryTimer() {
    if (this._boundaryTimer != null) {
      clearTimeout(this._boundaryTimer);
      this._boundaryTimer = null;
    }
  }

  /**
   * @param {Temporal.Duration} [overrideRemaining]
   * @param {Temporal.Instant} [fromInstant]
   */
  _scheduleEnd(overrideRemaining, fromInstant = Temporal.Now.instant()) {
    const base =
      overrideRemaining ??
      Temporal.Duration.from({ seconds: this.currentPhase?.durationSeconds ?? 0 });
    this.phaseEndInstant = fromInstant.add(base);
    this._clearBoundaryTimer();
    const ms = Math.max(0, fromInstant.until(this.phaseEndInstant).total("milliseconds"));
    this._boundaryTimer = setTimeout(() => {
      this._boundaryTimer = null;
      this._tick();
    }, ms);
  }

  /**
   * @param {Temporal.Instant} fromInstant
   * @param {{ silent?: boolean }} [options]
   */
  _advancePhase(fromInstant, options = {}) {
    this.phaseIndex += 1;
    this.remaining = null;

    if (this.phaseIndex >= this.phases.length) {
      this.status = STATUS.complete;
      this.phaseEndInstant = null;
      this._clearBoundaryTimer();
      this._disposeWorker();
      this.dispatchEvent(new CustomEvent("complete"));
      return;
    }

    this.status = STATUS.running;
    const phase = this.currentPhase;
    this._scheduleEnd(Temporal.Duration.from({ seconds: phase.durationSeconds }), fromInstant);
    if (!options.silent) this._emitPhaseChange();
  }

  /**
   * Advance preparing → countdown, or countdown → first work phase.
   * @param {Temporal.Instant} fromInstant
   * @param {{ silent?: boolean }} [options]
   */
  _advanceStartup(fromInstant, options = {}) {
    if (this.status === STATUS.preparing) {
      this.status = STATUS.countdown;
      this._scheduleEnd(Temporal.Duration.from({ seconds: COUNTDOWN_SECONDS }), fromInstant);
      if (!options.silent) this._emitPhaseChange();
      return;
    }

    this._advancePhase(fromInstant, options);
  }

  _phaseDetail() {
    const startup = this.status === STATUS.preparing || this.status === STATUS.countdown;
    const phase = startup ? null : this.currentPhase;

    return {
      status: this.status,
      phase,
      round: phase?.round ?? null,
      totalRounds: this.config.rounds,
    };
  }

  _emitPhaseChange() {
    this.dispatchEvent(new CustomEvent("phase-change", { detail: this._phaseDetail() }));
  }

  _tick() {
    if (!TIMED.has(this.status)) return;
    if (!this.phaseEndInstant) return;

    const now = Temporal.Now.instant();
    let advanced = false;

    while (
      TIMED.has(this.status) &&
      this.phaseEndInstant &&
      now.until(this.phaseEndInstant).total("seconds") <= 0
    ) {
      const endedAt = this.phaseEndInstant;
      if (this.status === STATUS.preparing || this.status === STATUS.countdown) {
        this._advanceStartup(endedAt, { silent: true });
      } else {
        this._advancePhase(endedAt, { silent: true });
      }
      advanced = true;
      if (this.status === STATUS.complete) return;
    }

    if (advanced && TIMED.has(this.status)) {
      this._emitPhaseChange();
    }

    if (!TIMED.has(this.status)) return;
    if (!this.phaseEndInstant) return;

    this.dispatchEvent(
      new CustomEvent("press", {
        detail: {
          remainingSeconds: now.until(this.phaseEndInstant).total("seconds"),
          status: this.status,
          phase: this.currentPhase,
        },
      }),
    );
  }

  _onWorkerMessage = (event) => {
    if (event.data?.type !== "press") return;
    this._tick();
  };

  _startTicking() {
    if (!this._worker) {
      this._worker = new Worker(new URL("./timer-worker.js", import.meta.url), { type: "module" });
      this._worker.addEventListener("message", this._onWorkerMessage);
    }
    this._worker.postMessage({ type: "start", interval: 250 });
    this._tick();
  }

  _stopTicking() {
    this._clearBoundaryTimer();
    this._worker?.postMessage({ type: "stop" });
  }

  _disposeWorker() {
    this._clearBoundaryTimer();
    if (this._worker) {
      this._worker.postMessage({ type: "stop" });
      this._worker.terminate();
      this._worker = null;
    }
  }
}
