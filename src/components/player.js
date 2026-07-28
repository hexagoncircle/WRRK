import { Temporal } from "@js-temporal/polyfill";
import { STATUS, TimerEngine } from "../scripts/engine.js";
import { formatMSS } from "../scripts/format.js";
import { NotificationController } from "../scripts/notifications.js";
import { WakeLockController } from "../scripts/wake-lock.js";

/** @typedef {import('../scripts/model.js').TimerConfig} TimerConfig */

const LABEL = {
  start: "Start",
  resume: "Resume",
  pause: "Pause",
  done: "Done",
  idle: "Waiting",
  prepare: "Get ready",
  paused: "Paused",
  complete: "Complete",
};

/**
 * @param {number} round
 * @param {number} total
 */
function getRoundText(round, total) {
  return `Round ${round}/${total}`;
}

/**
 * @param {string} label
 * @param {string} time
 */
function getTitleText(label, time) {
  return label ? `${label}: ${time}` : time;
}

/**
 * Progressive enhancement for the timer player.
 * @param {HTMLElement} root
 * @param {{
 *   getConfig: () => TimerConfig,
 *   onRunningChange?: (running: boolean) => void,
 * }} options
 */
export function enhancePlayer(root, options) {
  const timeEl = root.querySelector(".time");
  const roundEl = root.querySelector(".round");
  const phaseEl = root.querySelector(".phase");
  const playPauseButton = root.querySelector(".play-pause");
  const resetButton = root.querySelector(".reset");

  if (
    !(timeEl instanceof HTMLElement) ||
    !(roundEl instanceof HTMLElement) ||
    !(phaseEl instanceof HTMLElement) ||
    !(playPauseButton instanceof HTMLButtonElement) ||
    !(resetButton instanceof HTMLButtonElement)
  ) {
    return null;
  }

  /** @type {TimerEngine | null} */
  let engine = null;
  /** @type {TimerConfig} */
  let currentConfig = options.getConfig();
  const wakeLock = new WakeLockController();
  const notifications = new NotificationController();
  /** @type {string | null} */
  let lastNotifiedKey = null;

  const defaultTitle = document.title;

  const syncRootAttrs = () => {
    root.dataset.status = engine?.status ?? STATUS.idle;

    const phaseType = engine?.currentPhase?.type;
    if (phaseType === "work" || phaseType === "rest") {
      root.dataset.phase = phaseType;
    } else {
      delete root.dataset.phase;
    }
  };

  const emitRunningChange = () => {
    const running = Boolean(
      engine && (engine.status === STATUS.running || engine.status === STATUS.preparing),
    );
    syncRootAttrs();
    options.onRunningChange?.(running);
  };

  /**
   * Surface the countdown and phase type in the tab title while the tab is
   * backgrounded, so a hidden timer stays glanceable. Restore the original
   * title whenever the tab is visible or the timer isn't actively counting.
   */
  const refreshTitle = () => {
    const active =
      engine && (engine.status === STATUS.running || engine.status === STATUS.preparing);
    if (!document.hidden || !active || !engine.phaseEndInstant) {
      if (document.title !== defaultTitle) document.title = defaultTitle;
      return;
    }

    const secondsLeft = Temporal.Now.instant().until(engine.phaseEndInstant).total("seconds");
    const time = formatMSS(secondsLeft);
    const label = phaseEl.textContent ?? "";
    document.title = getTitleText(label, time);
  };

  const setIdleDisplay = () => {
    timeEl.textContent = formatMSS(currentConfig.workSeconds);
    roundEl.textContent = getRoundText(1, currentConfig.rounds);
    phaseEl.textContent = LABEL.idle;
    playPauseButton.textContent = LABEL.start;
    playPauseButton.disabled = false;
    resetButton.disabled = false;
    emitRunningChange();
  };

  /**
   * @param {TimerConfig} config
   */
  const loadConfig = (config) => {
    currentConfig = config;
    engine?.reset();
    void wakeLock.release();
    engine = new TimerEngine(config);
    lastNotifiedKey = null;
    bindEngine(engine);
    setIdleDisplay();
  };

  /**
   * Soft-reset to idle with the latest config (used after edits while paused).
   * @param {TimerConfig} [config]
   */
  const softReset = (config = options.getConfig()) => {
    loadConfig(config);
  };

  /**
   * @param {TimerEngine} nextEngine
   */
  const bindEngine = (nextEngine) => {
    nextEngine.addEventListener("phase-change", (event) => {
      const detail = /** @type {CustomEvent} */ (event).detail;
      renderPhase(detail);
      maybeNotify(detail);
      emitRunningChange();
    });

    nextEngine.addEventListener("tick", (event) => {
      const detail = /** @type {CustomEvent} */ (event).detail;
      const nextTime = formatMSS(detail.remainingSeconds);
      // Worker ticks ~4×/sec for deadline accuracy; only mutate the DOM when
      // the displayed M:SS string actually changes. Round/phase are set on
      // phase-change (and pause/complete), not on every tick.
      if (timeEl.textContent !== nextTime) {
        timeEl.textContent = nextTime;
      }
      refreshTitle();
    });

    nextEngine.addEventListener("pause", () => {
      playPauseButton.textContent = LABEL.resume;
      phaseEl.textContent = LABEL.paused;
      void wakeLock.release();
      emitRunningChange();
      refreshTitle();
    });

    nextEngine.addEventListener("complete", () => {
      timeEl.textContent = LABEL.done;
      phaseEl.textContent = LABEL.complete;
      roundEl.textContent = getRoundText(currentConfig.rounds, currentConfig.rounds);
      playPauseButton.textContent = LABEL.start;
      playPauseButton.disabled = false;
      void wakeLock.release();
      notifications.notifyPhase("complete");
      emitRunningChange();
      refreshTitle();
    });

    nextEngine.addEventListener("reset", () => {
      lastNotifiedKey = null;
      setIdleDisplay();
      void wakeLock.release();
      refreshTitle();
    });
  };

  /**
   * @param {{
   *   status: string,
   *   phase: import('../scripts/model.js').Phase | null,
   *   round: number | null,
   *   totalRounds: number,
   * }} detail
   */
  const renderPhase = (detail) => {
    if (detail.status === STATUS.preparing) {
      phaseEl.textContent = LABEL.prepare;
      roundEl.textContent = getRoundText(1, detail.totalRounds);
      playPauseButton.textContent = LABEL.pause;
      playPauseButton.disabled = false;
      refreshTitle();
      return;
    }

    if (!detail.phase) return;

    phaseEl.textContent = detail.phase.type;
    roundEl.textContent = getRoundText(detail.round, detail.totalRounds);
    playPauseButton.textContent = LABEL.pause;
    playPauseButton.disabled = false;
    refreshTitle();
  };

  /**
   * @param {{
   *   status: string,
   *   phase: import('../scripts/model.js').Phase | null,
   *   round: number | null,
   *   totalRounds: number,
   * }} detail
   */
  const maybeNotify = (detail) => {
    if (detail.status === STATUS.preparing) {
      const key = "prepare";
      if (lastNotifiedKey === key) return;
      lastNotifiedKey = key;
      notifications.notifyPhase("prepare");
      return;
    }

    if (!detail.phase) return;
    const key = `${detail.phase.type}:${detail.round}:${detail.phase.type === "work" ? "w" : "r"}`;
    if (lastNotifiedKey === key) return;
    lastNotifiedKey = key;
    notifications.notifyPhase(detail.phase.type, {
      round: detail.round,
      totalRounds: detail.totalRounds,
    });
  };

  const startPlayback = async () => {
    if (!engine) return;
    if (engine.status === STATUS.running || engine.status === STATUS.preparing) return;

    // Fresh start after complete: rebuild engine from current config.
    if (engine.status === STATUS.complete) {
      loadConfig(options.getConfig());
    }

    await notifications.ensurePermission();
    engine.start();
    await wakeLock.request();
    playPauseButton.textContent = LABEL.pause;
    playPauseButton.disabled = false;
    emitRunningChange();
  };

  playPauseButton.addEventListener("click", async () => {
    if (!engine) return;

    if (engine.status === STATUS.running || engine.status === STATUS.preparing) {
      engine.pause();
      return;
    }

    await startPlayback();
  });

  resetButton.addEventListener("click", () => {
    softReset(options.getConfig());
  });

  document.addEventListener("visibilitychange", refreshTitle);

  loadConfig(currentConfig);

  return {
    softReset,
    loadConfig,
    start: startPlayback,
    /**
     * @returns {boolean}
     */
    isRunning: () =>
      Boolean(engine && (engine.status === STATUS.running || engine.status === STATUS.preparing)),
    /**
     * @returns {boolean}
     */
    isPaused: () => engine?.status === STATUS.paused,
  };
}
