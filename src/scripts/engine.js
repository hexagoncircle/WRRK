import { Temporal } from "@js-temporal/polyfill";
import { PREPARE_SECONDS, toPhases } from "./model.js";

/** @typedef {import('./model.js').TimerSet} TimerSet */
/** @typedef {import('./model.js').Phase} Phase */

/**
 * Drift-free interval engine.
 * Deadlines use absolute Temporal instants so hidden-tab throttling can catch up.
 */
export class TimerEngine extends EventTarget {
  /**
   * @param {TimerSet} timerSet
   */
  constructor(timerSet) {
    super();
    this.timerSet = timerSet;
    /** @type {Phase[]} */
    this.phases = toPhases(timerSet);
    /** @type {number} */
    this.phaseIndex = -1;
    /** @type {'idle' | 'preparing' | 'running' | 'paused' | 'complete'} */
    this.status = "idle";
    /** @type {Temporal.Duration | null} */
    this.remaining = null;
    /** @type {Temporal.Instant | null} */
    this.phaseEndInstant = null;
    /** @type {'preparing' | 'running' | null} */
    this._pausedFrom = null;
    /** @type {Worker | null} */
    this._worker = null;
    this._tick = this._tick.bind(this);
  }

  /** @returns {Phase | null} */
  get currentPhase() {
    if (this.phaseIndex < 0 || this.phaseIndex >= this.phases.length) return null;
    return this.phases[this.phaseIndex];
  }

  start() {
    if (this.status === "running" || this.status === "preparing") return;
    if (this.status === "complete") return;

    if (this.status === "paused" && this.remaining) {
      this.status = this._pausedFrom ?? "running";
      this._pausedFrom = null;
      this._scheduleEnd(this.remaining);
      this.remaining = null;
    } else {
      this.phaseIndex = -1;
      this.status = "preparing";
      this._scheduleEnd(Temporal.Duration.from({ seconds: PREPARE_SECONDS }));
      this._emitPhaseChange();
    }

    this._startTicking();
  }

  pause() {
    if (this.status !== "running" && this.status !== "preparing") return;
    if (!this.phaseEndInstant) return;

    this.remaining = Temporal.Now.instant().until(this.phaseEndInstant);
    this._pausedFrom = this.status;
    this.status = "paused";
    this._stopTicking();
    this.dispatchEvent(new CustomEvent("pause"));
  }

  reset() {
    this._disposeWorker();
    this.phaseIndex = -1;
    this.status = "idle";
    this.remaining = null;
    this.phaseEndInstant = null;
    this._pausedFrom = null;
    this.dispatchEvent(new CustomEvent("reset"));
  }

  /**
   * @param {Temporal.Duration} [overrideRemaining]
   * @param {Temporal.Instant} [fromInstant]
   */
  _scheduleEnd(overrideRemaining, fromInstant = Temporal.Now.instant()) {
    const base = overrideRemaining ?? Temporal.Duration.from({ seconds: this.currentPhase?.durationSeconds ?? 0 });
    this.phaseEndInstant = fromInstant.add(base);
  }

  /**
   * @param {Temporal.Instant} fromInstant
   * @param {{ silent?: boolean }} [options]
   */
  _advancePhase(fromInstant, options = {}) {
    this.phaseIndex += 1;
    this.remaining = null;

    if (this.phaseIndex >= this.phases.length) {
      this.status = "complete";
      this.phaseEndInstant = null;
      this._disposeWorker();
      this.dispatchEvent(new CustomEvent("complete"));
      return;
    }

    this.status = "running";
    const phase = this.currentPhase;
    this._scheduleEnd(
      Temporal.Duration.from({ seconds: phase.durationSeconds }),
      fromInstant,
    );
    if (!options.silent) this._emitPhaseChange();
  }

  _emitPhaseChange() {
    if (this.status === "preparing") {
      this.dispatchEvent(
        new CustomEvent("phase-change", {
          detail: {
            status: "preparing",
            phase: null,
            index: -1,
            total: this.phases.length,
            round: null,
            totalRounds: this.timerSet.rounds,
          },
        }),
      );
      return;
    }

    const phase = this.currentPhase;
    this.dispatchEvent(
      new CustomEvent("phase-change", {
        detail: {
          status: this.status,
          phase,
          index: this.phaseIndex,
          total: this.phases.length,
          round: phase?.round ?? null,
          totalRounds: this.timerSet.rounds,
        },
      }),
    );
  }

  /**
   * Recompute against the absolute deadline and emit a tick. Driven by the
   * worker's steady interval; the `event` argument (a MessageEvent) is unused.
   */
  _tick() {
    if (this.status !== "running" && this.status !== "preparing") return;
    if (!this.phaseEndInstant) return;

    const now = Temporal.Now.instant();
    let advanced = false;

    // Catch up through any phases that ended while the tab was throttled.
    while (
      (this.status === "running" || this.status === "preparing") &&
      this.phaseEndInstant &&
      now.until(this.phaseEndInstant).total("seconds") <= 0
    ) {
      const endedAt = this.phaseEndInstant;
      // Stay silent while skipping expired phases; announce the phase we land on.
      this._advancePhase(endedAt, { silent: true });
      advanced = true;
      if (this.status === "complete") return;
    }

    if (advanced && (this.status === "running" || this.status === "preparing")) {
      this._emitPhaseChange();
    }

    if (this.status !== "running" && this.status !== "preparing") return;
    if (!this.phaseEndInstant) return;

    const secondsLeft = now.until(this.phaseEndInstant).total("seconds");
    const phase = this.currentPhase;

    this.dispatchEvent(
      new CustomEvent("tick", {
        detail: {
          remainingSeconds: secondsLeft,
          status: this.status,
          phase,
          round: phase?.round ?? null,
          totalRounds: this.timerSet.rounds,
        },
      }),
    );
  }

  /**
   * Drive ticks from a Web Worker. Worker timers keep firing at a steady
   * cadence even when the tab is hidden, unlike main-thread rAF/setTimeout
   * which browsers heavily throttle for background tabs. Accuracy is unaffected
   * either way because deadlines are absolute Temporal instants.
   */
  _startTicking() {
    if (!this._worker) {
      this._worker = new Worker(new URL("./timer-worker.js", import.meta.url), { type: "module" });
      this._worker.addEventListener("message", this._tick);
    }
    this._worker.postMessage({ type: "start", interval: 250 });
    // Render an immediate frame instead of waiting for the first message.
    this._tick();
  }

  _stopTicking() {
    this._worker?.postMessage({ type: "stop" });
  }

  _disposeWorker() {
    if (this._worker) {
      this._worker.postMessage({ type: "stop" });
      this._worker.terminate();
      this._worker = null;
    }
  }
}
