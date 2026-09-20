import { COUNTDOWN_SECONDS, PREPARE_SECONDS, toPhases } from "./model.js";
import { PRESS_WORKER_SOURCE } from "./timer-worker.js";
import { createTimeout } from "./utils.js";

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
 * Deadlines use absolute Date.now() milliseconds so hidden-tab throttling can catch up.
 * Ticks are driven by an inlined classic worker (steady cadence while the tab is hidden).
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
    /** Remaining seconds while paused. */
    /** @type {number | null} */
    this.remaining = null;
    /** Epoch ms when the current timed segment ends. */
    /** @type {number | null} */
    this.phaseEndMs = null;
    /** @type {typeof STATUS.preparing | typeof STATUS.countdown | typeof STATUS.running | null} */
    this._pausedFrom = null;
    /** @type {Worker | null} */
    this._worker = null;
    /** @type {string | null} */
    this._workerUrl = null;
    this._boundaryTimer = createTimeout();
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
      this._scheduleEnd(this.remaining ?? 0);
      this.remaining = null;
      this.dispatchEvent(new CustomEvent("resume", { detail: this._phaseDetail() }));
    } else {
      this.phaseIndex = -1;
      this.status = STATUS.preparing;
      this._scheduleEnd(PREPARE_SECONDS);
      this._emitPhaseChange();
    }

    this._startTicking();
  }

  pause() {
    if (!TIMED.has(this.status)) return;
    if (this.phaseEndMs == null) return;

    const leftMs = this.phaseEndMs - Date.now();
    this.remaining = leftMs < 0 ? 0 : leftMs / 1000;
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
    this.phaseEndMs = null;
    this._pausedFrom = null;
    this.dispatchEvent(new CustomEvent("reset"));
  }

  /**
   * @param {number} [overrideRemainingSeconds]
   * @param {number} [fromMs]
   */
  _scheduleEnd(overrideRemainingSeconds, fromMs = Date.now()) {
    const seconds =
      overrideRemainingSeconds ?? this.currentPhase?.durationSeconds ?? 0;
    this.phaseEndMs = fromMs + seconds * 1000;
    const ms = Math.max(0, this.phaseEndMs - fromMs);
    this._boundaryTimer.set(() => this._tick(), ms);
  }

  /**
   * @param {number} fromMs
   * @param {{ silent?: boolean }} [options]
   */
  _advancePhase(fromMs, options = {}) {
    this.phaseIndex += 1;
    this.remaining = null;

    if (this.phaseIndex >= this.phases.length) {
      this.status = STATUS.complete;
      this.phaseEndMs = null;
      this._boundaryTimer.clear();
      this._disposeWorker();
      this.dispatchEvent(new CustomEvent("complete"));
      return;
    }

    this.status = STATUS.running;
    const phase = this.currentPhase;
    this._scheduleEnd(phase.durationSeconds, fromMs);
    if (!options.silent) this._emitPhaseChange();
  }

  /**
   * Advance preparing → countdown, or countdown → first work phase.
   * @param {number} fromMs
   * @param {{ silent?: boolean }} [options]
   */
  _advanceStartup(fromMs, options = {}) {
    if (this.status === STATUS.preparing) {
      this.status = STATUS.countdown;
      this._scheduleEnd(COUNTDOWN_SECONDS, fromMs);
      if (!options.silent) this._emitPhaseChange();
      return;
    }

    this._advancePhase(fromMs, options);
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
    if (this.phaseEndMs == null) return;

    const now = Date.now();
    let advanced = false;

    while (TIMED.has(this.status) && this.phaseEndMs != null && now >= this.phaseEndMs) {
      const endedAt = this.phaseEndMs;
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
    if (this.phaseEndMs == null) return;

    this.dispatchEvent(
      new CustomEvent("press", {
        detail: {
          remainingSeconds: (this.phaseEndMs - now) / 1000,
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
      const url = URL.createObjectURL(new Blob([PRESS_WORKER_SOURCE], { type: "text/javascript" }));
      this._workerUrl = url;
      this._worker = new Worker(url);
      this._worker.addEventListener("message", this._onWorkerMessage);
    }
    this._worker.postMessage({ type: "start", interval: 250 });
    this._tick();
  }

  _stopTicking() {
    this._boundaryTimer.clear();
    this._worker?.postMessage({ type: "stop" });
  }

  _disposeWorker() {
    this._boundaryTimer.clear();
    if (this._worker) {
      this._worker.postMessage({ type: "stop" });
      this._worker.terminate();
      this._worker = null;
    }
    if (this._workerUrl) {
      URL.revokeObjectURL(this._workerUrl);
      this._workerUrl = null;
    }
  }
}
