import { Temporal } from "@js-temporal/polyfill";
import { READY_COUNT, toPhases } from "./model.js";

/** @typedef {import('./model.js').TimerConfig} TimerConfig */
/** @typedef {import('./model.js').Phase} Phase */

export const STATUS = {
  running: "running",
  preparing: "preparing",
  complete: "complete",
  paused: "paused",
  idle: "idle",
};

/** @typedef {typeof STATUS[keyof typeof STATUS]} EngineStatus */

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
    /** @type {typeof STATUS.preparing | typeof STATUS.running | null} */
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
    if (this.status === STATUS.running || this.status === STATUS.preparing) return;
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
      this._scheduleEnd(Temporal.Duration.from({ seconds: READY_COUNT }));
      this._emitPhaseChange();
    }

    this._startTicking();
  }

  pause() {
    if (this.status !== STATUS.running && this.status !== STATUS.preparing) return;
    if (!this.phaseEndInstant) return;

    const left = Temporal.Now.instant().until(this.phaseEndInstant);
    this.remaining =
      left.total("seconds") < 0 ? Temporal.Duration.from({ seconds: 0 }) : left;
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
    const base = overrideRemaining ?? Temporal.Duration.from({ seconds: this.currentPhase?.durationSeconds ?? 0 });
    this.phaseEndInstant = fromInstant.add(base);
    // Wake exactly at the deadline — worker ticks alone can lag by up to one interval.
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
    this._scheduleEnd(
      Temporal.Duration.from({ seconds: phase.durationSeconds }),
      fromInstant,
    );
    if (!options.silent) this._emitPhaseChange();
  }

  _phaseDetail() {
    const preparing = this.status === STATUS.preparing;
    const phase = preparing ? null : this.currentPhase;

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
    if (this.status !== STATUS.running && this.status !== STATUS.preparing) return;
    if (!this.phaseEndInstant) return;

    const now = Temporal.Now.instant();
    let advanced = false;

    // Catch up through any phases that ended while the tab was throttled.
    while (
      (this.status === STATUS.running || this.status === STATUS.preparing) &&
      this.phaseEndInstant &&
      now.until(this.phaseEndInstant).total("seconds") <= 0
    ) {
      const endedAt = this.phaseEndInstant;
      // Stay silent while skipping expired phases; announce the phase we land on.
      this._advancePhase(endedAt, { silent: true });
      advanced = true;
      if (this.status === STATUS.complete) return;
    }

    if (advanced && (this.status === STATUS.running || this.status === STATUS.preparing)) {
      this._emitPhaseChange();
    }

    if (this.status !== STATUS.running && this.status !== STATUS.preparing) return;
    if (!this.phaseEndInstant) return;

    this.dispatchEvent(
      new CustomEvent("tick", {
        detail: {
          remainingSeconds: now.until(this.phaseEndInstant).total("seconds"),
          status: this.status,
          phase: this.currentPhase,
        },
      }),
    );
  }

  _onWorkerMessage = (event) => {
    if (event.data?.type !== "tick") return;
    this._tick();
  };

  _startTicking() {
    if (!this._worker) {
      this._worker = new Worker(new URL("./timer-worker.js", import.meta.url), { type: "module" });
      this._worker.addEventListener("message", this._onWorkerMessage);
    }
    this._worker.postMessage({ type: "start", interval: 250 });
    // Render an immediate frame instead of waiting for the first message.
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
