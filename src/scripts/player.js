import { Temporal } from "@js-temporal/polyfill";
import { cancelDigitDance, playDigitDance, playPrepareCountdown } from "./digit-dance.js";
import { STATUS, TimerEngine } from "./engine.js";
import { formatDurationAttr, formatMSS } from "./format.js";
import { LABEL } from "./labels.js";
import { READY_COUNT } from "./model.js";
import { NotificationController } from "./notifications.js";
import { createCounterRing } from "./counter-ring.js";
import { createPhaseLabel } from "./phase-label.js";
import { createProgressRing } from "./progress-ring.js";
import {
  playBlip,
  playRestSound,
  playPauseSound,
  playResumeSound,
  playWorkSound,
  playCompletedSound,
  unlock as unlockAudio,
} from "./sounds.js";
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

/**
 * Progressive enhancement for the timer player.
 * @param {HTMLElement} root
 * @param {{
 *   getConfig: () => TimerConfig,
 *   attrsRoot?: HTMLElement,
 *   onRunningChange?: (running: boolean) => void,
 * }} options
 */
export function enhancePlayer(root, options) {
  const attrsRoot = options.attrsRoot ?? root;
  const $time = root.querySelector(".time");
  const $digits = root.querySelectorAll("[data-digit]");
  const $roundLabel = root.querySelector(".round-label");
  const $roundCurrent = root.querySelector(".round-current");
  const $phase = root.querySelector(".phase");
  const phaseLabel = createPhaseLabel(/** @type {HTMLElement} */ ($phase));
  const $playback = root.querySelector(".playback");
  const $playbackLabel = $playback.querySelector(".label");
  const $reset = root.querySelector(".reset");

  const $progressRing = root.querySelector(".progress-ring");
  const progressRing =
    $progressRing instanceof HTMLElement ? createProgressRing($progressRing) : null;

  const $counterRing = root.querySelector(".counter-ring");
  const counterRing = $counterRing instanceof HTMLElement ? createCounterRing($counterRing) : null;

  /** @type {{ stop: () => void, pause: () => void, play: () => void, time: number } | null} */
  let prepareTimeline = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let completeTimer = null;

  const clearCompleteTimer = () => {
    if (completeTimer == null) return;
    clearTimeout(completeTimer);
    completeTimer = null;
  };

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

  /** @param {number} n */
  const setPrepareLabel = (n) => {
    $time.dateTime = `PT${n}S`;
    $time.setAttribute("aria-label", String(n));
  };

  /** @param {number} current */
  const setRound = (current) => {
    const pending = !current;
    $roundLabel.hidden = pending;
    $roundCurrent.textContent = pending ? "––" : String(current);
  };

  /** @type {TimerEngine | null} */
  let engine = null;
  /** @type {TimerConfig} */
  let currentConfig = options.getConfig();
  const wakeLock = new WakeLockController();
  const notifications = new NotificationController();
  /** @type {string | null} */
  let lastNotifiedKey = null;
  /** @type {number | null} */
  let lastBlippedSecond = null;
  const defaultTitle = document.title;

  /** @param {number} sec */
  const blipCountdown = (sec) => {
    if (sec < 1 || sec > 3) return;
    // 3 → right, 2 → left, 1 → right
    const pan = sec % 2 === 0 ? -0.75 : 0.75;
    playBlip({ pan });
  };

  const syncRingTotals = () => {
    progressRing?.setTotals(currentConfig.workSeconds, currentConfig.restSeconds);
  };

  /**
   * Last round has no rest — work arc fills the circle (minus top gap).
   * @param {Phase | null | undefined} phase
   */
  const syncRingGeometryForPhase = (phase) => {
    if (!progressRing || !phase) return;
    const lastRound = phase.round === phase.totalRounds;
    progressRing.setTotals(currentConfig.workSeconds, lastRound ? 0 : currentConfig.restSeconds, {
      fill: false,
    });
  };

  /**
   * @param {Phase | null | undefined} phase
   * @param {number} remainingSeconds
   * @param {{ settle?: boolean }} [opts]
   */
  const syncRingProgress = (phase, remainingSeconds, { settle = false } = {}) => {
    if (!progressRing) return;
    if (!phase || (phase.type !== "work" && phase.type !== "rest")) {
      progressRing.reset();
      return;
    }
    progressRing.setProgress(
      {
        phase: phase.type,
        remainingSeconds,
        durationSeconds: phase.durationSeconds,
      },
      { settle },
    );
  };

  /** @type {'work' | 'rest' | null} */
  let lastPhaseType = null;

  /**
   * @param {Phase | null | undefined} phase
   */
  const rememberPhaseType = (phase) => {
    lastPhaseType = phase?.type === "work" || phase?.type === "rest" ? phase.type : null;
  };

  const syncCounterIdle = () => {
    counterRing?.setCount(currentConfig.rounds);
    counterRing?.showAll();
  };

  const isActive = () =>
    Boolean(engine && (engine.status === STATUS.running || engine.status === STATUS.preparing));

  const syncRootAttrs = () => {
    attrsRoot.dataset.status = engine?.status ?? STATUS.idle;

    const phaseType = engine?.currentPhase?.type;
    if (phaseType === "work" || phaseType === "rest") {
      attrsRoot.dataset.phase = phaseType;
    } else {
      delete attrsRoot.dataset.phase;
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
    const idle = (engine?.status ?? STATUS.idle) === STATUS.idle;
    options.onRunningChange?.(!idle);
  };

  const stopPrepareTimeline = () => {
    prepareTimeline = null;
    cancelDigitDance();
  };

  const syncPrepareTimeline = () => {
    if (!prepareTimeline || !engine?.phaseEndInstant) return;
    if (engine.status !== STATUS.preparing) return;
    const left = Temporal.Now.instant().until(engine.phaseEndInstant).total("seconds");
    prepareTimeline.time = Math.max(0, READY_COUNT - left);
  };

  const startPrepareTimeline = () => {
    stopPrepareTimeline();
    prepareTimeline = playPrepareCountdown($digits, {
      count: READY_COUNT,
      beatSeconds: 1,
      onBeat: (n) => {
        setPrepareLabel(n);
        blipCountdown(n);
      },
    });
  };

  /** Show countdown in the tab title while the tab is hidden. */
  const refreshTitle = () => {
    if (!document.hidden || !isActive() || !engine?.phaseEndInstant) {
      if (document.title !== defaultTitle) document.title = defaultTitle;
      return;
    }

    const secondsLeft = Temporal.Now.instant().until(engine.phaseEndInstant).total("seconds");
    const label = phaseLabel.getText();
    document.title = label ? `${label}: ${formatMSS(secondsLeft)}` : formatMSS(secondsLeft);
  };

  const setIdleDisplay = () => {
    stopPrepareTimeline();
    setTime(currentConfig.workSeconds);
    setRound(0);
    phaseLabel.set(LABEL.idle);
    setPlaybackLabel(LABEL.start);
    $playback.disabled = false;
    $reset.disabled = false;
    syncRingTotals();
    syncCounterIdle();
    emitRunningChange();
  };

  const lightUpDigits = () => playDigitDance($digits);

  /**
   * @param {TimerConfig} [config]
   * @param {{ lightUp?: boolean }} [options]
   */
  const applyConfig = (config = options.getConfig(), { lightUp = false } = {}) => {
    clearCompleteTimer();
    currentConfig = config;
    engine?.reset();
    engine = new TimerEngine(config);
    lastNotifiedKey = null;
    lastBlippedSecond = null;
    bindEngine(engine);
    setIdleDisplay();
    if (lightUp) lightUpDigits();
  };

  /**
   * @param {TimerEngine} nextEngine
   */
  const bindEngine = (nextEngine) => {
    nextEngine.addEventListener("phase-change", (event) => {
      const detail = /** @type {CustomEvent<PhaseDetail>} */ (event).detail;
      // Schedule audio before DOM/Motion work so render jank can't delay the attack.
      if (
        detail.status === STATUS.running &&
        detail.phase &&
        (detail.phase.type === "work" || detail.phase.type === "rest")
      ) {
        if (detail.phase.type === "rest") {
          playRestSound();
        } else {
          playWorkSound();
        }
      }
      lastBlippedSecond = null;
      renderPhase(detail, {
        startPrepare: detail.status === STATUS.preparing,
      });
      rememberPhaseType(detail.phase);
      maybeNotify(detail);
      emitRunningChange();
    });

    nextEngine.addEventListener("tick", (event) => {
      const detail = /** @type {CustomEvent<{
        remainingSeconds: number,
        status: string,
        phase: Phase | null,
      }>} */ (event).detail;
      if (detail.status !== STATUS.preparing) {
        setTime(detail.remainingSeconds);
        syncRingProgress(detail.phase, detail.remainingSeconds);

        const phase = detail.phase;

        if (
          detail.status === STATUS.running &&
          phase &&
          (phase.type === "work" || phase.type === "rest")
        ) {
          const sec = Math.ceil(detail.remainingSeconds);
          if (sec !== lastBlippedSecond && sec >= 1 && sec <= 3) {
            lastBlippedSecond = sec;
            blipCountdown(sec);
          }
        }
      }

      refreshTitle();
    });

    nextEngine.addEventListener("resume", (event) => {
      const detail = /** @type {CustomEvent<PhaseDetail>} */ (event).detail;
      // Keep the ring where pause left it; the next tick continues from there.
      renderPhase(detail, { syncRing: false });
      if (detail.status === STATUS.preparing) {
        if (!prepareTimeline) startPrepareTimeline();
        syncPrepareTimeline();
        prepareTimeline?.play();
      }
      playResumeSound();
      emitRunningChange();
    });

    nextEngine.addEventListener("pause", () => {
      prepareTimeline?.pause();
      setPlaybackLabel(LABEL.resume);
      phaseLabel.set(LABEL.paused);
      playPauseSound();
      // Snap off the led-ahead target so the ring does not keep easing after freeze.
      if (nextEngine.currentPhase && nextEngine.remaining) {
        syncRingProgress(nextEngine.currentPhase, nextEngine.remaining.total("seconds"), {
          settle: true,
        });
      }
      emitRunningChange();
      refreshTitle();
    });

    nextEngine.addEventListener("complete", async () => {
      const wasFinalWork = lastPhaseType === "work";
      lastPhaseType = null;
      stopPrepareTimeline();
      setTime(0);
      phaseLabel.set(LABEL.complete);
      playCompletedSound();
      setRound(0);
      setPlaybackLabel(LABEL.start);
      $playback.disabled = true;
      counterRing?.showAll(currentConfig.rounds);
      notifications.notifyPhase("complete");
      emitRunningChange();
      refreshTitle();

      clearCompleteTimer();
      completeTimer = setTimeout(() => {
        completeTimer = null;
        applyConfig(undefined, { lightUp: true });
      }, 3000);

      // Full rings + CSS pulse on [data-status="complete"] (no between-round clear).
      if (wasFinalWork) {
        progressRing?.setTotals(currentConfig.workSeconds, currentConfig.restSeconds);
      }
    });

    nextEngine.addEventListener("reset", () => {
      lastNotifiedKey = null;
      lastBlippedSecond = null;
      lastPhaseType = null;
      refreshTitle();
    });
  };

  /**
   * @param {PhaseDetail} detail
   * @param {{ startPrepare?: boolean, syncRing?: boolean }} [opts]
   */
  const renderPhase = (detail, { startPrepare = false, syncRing = true } = {}) => {
    if (detail.status === STATUS.preparing) {
      phaseLabel.set(LABEL.prepare);
      if (startPrepare) startPrepareTimeline();
      if (syncRing) progressRing?.reset();
      counterRing?.clear();
    } else if (detail.phase) {
      stopPrepareTimeline();
      const type = detail.phase.type;
      const tone = type === "work" || type === "rest" ? type : null;
      phaseLabel.set(LABEL[type] ?? type, { tone });
      setRound(detail.round ?? 1);
      counterRing?.setActive(detail.round ?? 1, detail.totalRounds);
      if (syncRing) {
        syncRingGeometryForPhase(detail.phase);
        syncRingProgress(detail.phase, detail.phase.durationSeconds);
      }
    } else {
      return;
    }

    setPlaybackLabel(LABEL.pause);
    $playback.disabled = detail.status === STATUS.preparing;
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

    // Kick off resume in the click gesture, then wait so prepare isn't racing a cold context.
    const audioReady = unlockAudio();
    await notifications.ensurePermission();
    await audioReady;
    engine.start();
  };

  $playback.addEventListener("click", async () => {
    if (!engine || $playback.disabled) return;

    if (isActive()) {
      engine.pause();
      return;
    }

    await startPlayback();
  });

  $reset.addEventListener("click", () => {
    applyConfig(undefined, { lightUp: true });
  });

  document.addEventListener("visibilitychange", () => {
    refreshTitle();
    if (!document.hidden) syncPrepareTimeline();
  });

  applyConfig(currentConfig, { lightUp: true });

  return {
    softReset: applyConfig,
  };
}
