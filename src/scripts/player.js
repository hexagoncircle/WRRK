import { Temporal } from "@js-temporal/polyfill";
import { STATUS, TimerEngine } from "./engine.js";
import { formatMSS } from "./format.js";
import { NotificationController } from "./notifications.js";
import { WakeLockController } from "./wake-lock.js";

/** @typedef {import('./model.js').TimerConfig} TimerConfig */
/** @typedef {import('./model.js').Phase} Phase */

/**
 * @typedef {{
 *   status: string,
 *   phase: Phase | null,
 *   round: number | null,
 *   totalRounds: number,
 * }} PhaseDetail
 */

const LABEL = {
  start: "Start",
  resume: "Resume",
  pause: "Pause",
  idle: "Setup",
  prepare: "Get ready",
  paused: "Paused",
  complete: "Complete",
  work: "Work",
  rest: "Rest",
};

/**
 * ISO 8601 duration attribute for a non-negative whole-second count (PT#M#S).
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatDurationAttr(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.ceil(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `PT${minutes}M${seconds}S`;
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
  const $time = root.querySelector(".time");
  const $digits = root.querySelectorAll("[data-digit]");
  const $roundOutput = root.querySelector(".round-output");
  const $roundCurrent = root.querySelector(".round-current");
  const $roundTotal = root.querySelector(".round-total");
  const $phase = root.querySelector(".phase");
  const $playback = root.querySelector(".playback");
  const $playbackLabel = $playback.querySelector(".label");
  const $reset = root.querySelector(".reset");

  /** @param {string} text */
  const setPlaybackLabel = (text) => {
    $playbackLabel.textContent = text;
    $playback.dataset.action = text === LABEL.pause ? "pause" : "play";
  };

  /**
   * Map a whole-second countdown onto the digit SVGs (M:SS, max 9:59).
   * @param {number} seconds
   */
  const setTime = (seconds) => {
    const label = formatMSS(seconds);
    const [mins, secs] = label.split(":");
    const values = [mins, secs[0], secs[1]];

    $digits.forEach((el, i) => {
      const digit = values[i] ?? "0";
      if (el.dataset.digit !== digit) {
        el.dataset.digit = digit;
      }
    });

    $time.dateTime = formatDurationAttr(seconds);
    $time.setAttribute("aria-label", label);
  };

  /**
   * @param {number} current
   * @param {number} total
   */
  const setRound = (current, total) => {
    $roundCurrent.textContent = String(current);
    $roundTotal.textContent = String(total);
    $roundOutput.setAttribute("aria-label", `${current} of ${total}`);
  };

  /** @type {TimerEngine | null} */
  let engine = null;
  /** @type {TimerConfig} */
  let currentConfig = options.getConfig();
  const wakeLock = new WakeLockController();
  const notifications = new NotificationController();
  /** @type {string | null} */
  let lastNotifiedKey = null;
  const defaultTitle = document.title;

  const isActive = () =>
    Boolean(engine && (engine.status === STATUS.running || engine.status === STATUS.preparing));

  const syncRootAttrs = () => {
    root.dataset.status = engine?.status ?? STATUS.idle;

    const phaseType = engine?.currentPhase?.type;
    if (phaseType === "work" || phaseType === "rest") {
      root.dataset.phase = phaseType;
    } else {
      delete root.dataset.phase;
    }
  };

  const syncWakeLock = () => {
    if (isActive()) {
      void wakeLock.request();
    } else {
      void wakeLock.release();
    }
  };

  const emitRunningChange = () => {
    syncRootAttrs();
    syncWakeLock();
    options.onRunningChange?.(isActive());
  };

  /** Show countdown in the tab title while the tab is hidden. */
  const refreshTitle = () => {
    if (!document.hidden || !isActive() || !engine?.phaseEndInstant) {
      if (document.title !== defaultTitle) document.title = defaultTitle;
      return;
    }

    const secondsLeft = Temporal.Now.instant().until(engine.phaseEndInstant).total("seconds");
    const label = $phase.textContent ?? "";
    document.title = label ? `${label}: ${formatMSS(secondsLeft)}` : formatMSS(secondsLeft);
  };

  const setIdleDisplay = () => {
    setTime(currentConfig.workSeconds);
    setRound(1, currentConfig.rounds);
    $phase.textContent = LABEL.idle;
    setPlaybackLabel(LABEL.start);
    $playback.disabled = false;
    $reset.disabled = false;
    emitRunningChange();
  };

  /**
   * @param {TimerConfig} [config]
   */
  const loadConfig = (config = options.getConfig()) => {
    currentConfig = config;
    engine?.reset();
    engine = new TimerEngine(config);
    lastNotifiedKey = null;
    bindEngine(engine);
    setIdleDisplay();
  };

  /**
   * @param {TimerEngine} nextEngine
   */
  const bindEngine = (nextEngine) => {
    nextEngine.addEventListener("phase-change", (event) => {
      const detail = /** @type {CustomEvent<PhaseDetail>} */ (event).detail;
      renderPhase(detail);
      maybeNotify(detail);
      emitRunningChange();
    });

    nextEngine.addEventListener("tick", (event) => {
      const detail = /** @type {CustomEvent<{ remainingSeconds: number }>} */ (event).detail;
      setTime(detail.remainingSeconds);
      refreshTitle();
    });

    nextEngine.addEventListener("resume", (event) => {
      renderPhase(/** @type {CustomEvent<PhaseDetail>} */ (event).detail);
      emitRunningChange();
    });

    nextEngine.addEventListener("pause", () => {
      setPlaybackLabel(LABEL.resume);
      $phase.textContent = LABEL.paused;
      emitRunningChange();
      refreshTitle();
    });

    nextEngine.addEventListener("complete", () => {
      setTime(0);
      $phase.textContent = LABEL.complete;
      setRound(currentConfig.rounds, currentConfig.rounds);
      setPlaybackLabel(LABEL.start);
      $playback.disabled = false;
      notifications.notifyPhase("complete");
      emitRunningChange();
      refreshTitle();
    });

    nextEngine.addEventListener("reset", () => {
      lastNotifiedKey = null;
      setIdleDisplay();
      refreshTitle();
    });
  };

  /**
   * @param {PhaseDetail} detail
   */
  const renderPhase = (detail) => {
    if (detail.status === STATUS.preparing) {
      $phase.textContent = LABEL.prepare;
      setRound(1, detail.totalRounds);
    } else if (detail.phase) {
      $phase.textContent = LABEL[detail.phase.type] ?? detail.phase.type;
      setRound(detail.round ?? 1, detail.totalRounds);
    } else {
      return;
    }

    setPlaybackLabel(LABEL.pause);
    $playback.disabled = false;
    refreshTitle();
  };

  /**
   * @param {PhaseDetail} detail
   */
  const maybeNotify = (detail) => {
    if (detail.status === STATUS.preparing) {
      if (lastNotifiedKey === "prepare") return;
      lastNotifiedKey = "prepare";
      notifications.notifyPhase("prepare");
      return;
    }

    if (!detail.phase) return;
    const key = `${detail.phase.type}:${detail.round}`;
    if (lastNotifiedKey === key) return;
    lastNotifiedKey = key;
    notifications.notifyPhase(detail.phase.type, {
      round: detail.round,
      totalRounds: detail.totalRounds,
    });
  };

  const startPlayback = async () => {
    if (!engine || isActive()) return;

    if (engine.status === STATUS.complete) {
      loadConfig();
    }

    await notifications.ensurePermission();
    engine.start();
  };

  $playback.addEventListener("click", async () => {
    if (!engine) return;

    if (isActive()) {
      engine.pause();
      return;
    }

    await startPlayback();
  });

  $reset.addEventListener("click", () => {
    loadConfig();
  });

  document.addEventListener("visibilitychange", refreshTitle);

  loadConfig(currentConfig);

  return {
    softReset: loadConfig,
    loadConfig,
    start: startPlayback,
    isRunning: isActive,
    isPaused: () => engine?.status === STATUS.paused,
  };
}
