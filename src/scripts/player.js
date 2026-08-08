import { Temporal } from "@js-temporal/polyfill";
import {
  cancelDigitDance,
  playCountdown,
  playDigitDance,
} from "./digit-dance.js";
import { STATUS, TimerEngine } from "./engine.js";
import { formatDurationAttr, formatMSS } from "./format.js";
import { LABEL } from "./labels.js";
import {
  COUNTDOWN_SECONDS,
  PREPARE_SECONDS,
  totalWorkoutSeconds,
} from "./model.js";
import { NotificationController } from "./notifications.js";
import { createCounterRing } from "./counter-ring.js";
import { createPhaseLabel } from "./phase-label.js";
import { createProgressRing } from "./progress-ring.js";
import { play } from "./sounds.js";
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
    $progressRing instanceof HTMLElement
      ? createProgressRing($progressRing)
      : null;

  const $counterRing = root.querySelector(".counter-ring");
  const counterRing =
    $counterRing instanceof HTMLElement
      ? createCounterRing($counterRing)
      : null;

  /** @type {{ stop: () => void, pause: () => void, play: () => void, time: number } | null} */
  let countdownTimeline = null;
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
  const setCountdownLabel = (n) => {
    $time.dateTime = `PT${n}S`;
    $time.setAttribute("aria-label", String(n));
  };

  /** @param {number} current */
  const setRound = (current) => {
    const pending = !current;
    $roundLabel.hidden = pending;
    $roundCurrent.textContent = pending ? "––" : String(current);
  };

  const setIdleRound = () => {
    $roundLabel.hidden = true;
    $roundCurrent.textContent = formatMSS(totalWorkoutSeconds(currentConfig));
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
    play("blip", { pan: (2 - sec) * 0.25 });
  };

  const syncRingTotals = () => {
    progressRing?.setTotals(
      currentConfig.workSeconds,
      currentConfig.restSeconds,
    );
  };

  /**
   * Last round has no rest — work arc fills the circle (minus top gap).
   * @param {Phase | null | undefined} phase
   */
  const syncRingGeometryForPhase = (phase) => {
    if (!progressRing || !phase) return;
    const lastRound = phase.round === phase.totalRounds;
    progressRing.setTotals(
      currentConfig.workSeconds,
      lastRound ? 0 : currentConfig.restSeconds,
      {
        fill: false,
      },
    );
  };

  /**
   * @param {Phase | null | undefined} phase
   * @param {number} remainingSeconds
   * @param {{ settle?: boolean }} [opts]
   */
  const syncRingProgress = (
    phase,
    remainingSeconds,
    { settle = false } = {},
  ) => {
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
    lastPhaseType =
      phase?.type === "work" || phase?.type === "rest" ? phase.type : null;
  };

  const syncCounterIdle = () => {
    counterRing?.setCount(currentConfig.rounds);
    counterRing?.showAll();
  };

  const isStartup = (status = engine?.status) =>
    status === STATUS.preparing || status === STATUS.countdown;

  const isActive = () =>
    Boolean(engine && (engine.status === STATUS.running || isStartup()));

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
      wakeLock.request();
    } else {
      wakeLock.release();
    }
  };

  const emitRunningChange = () => {
    syncRootAttrs();
    syncWakeLock();
    const idle = (engine?.status ?? STATUS.idle) === STATUS.idle;
    options.onRunningChange?.(!idle);
  };

  const stopCountdownTimeline = () => {
    countdownTimeline = null;
    cancelDigitDance();
  };

  const syncCountdownTimeline = () => {
    if (!countdownTimeline || !engine?.phaseEndInstant) return;
    if (!isStartup()) return;
    const left = Temporal.Now.instant()
      .until(engine.phaseEndInstant)
      .total("seconds");
    if (engine.status === STATUS.preparing) {
      countdownTimeline.time = Math.max(0, PREPARE_SECONDS - left);
    } else if (engine.status === STATUS.countdown) {
      countdownTimeline.time = Math.max(
        0,
        PREPARE_SECONDS + COUNTDOWN_SECONDS - left,
      );
    }
  };

  const startCountdownTimeline = () => {
    stopCountdownTimeline();
    $time.setAttribute("aria-label", LABEL.prepare);
    countdownTimeline = playCountdown($digits, {
      count: COUNTDOWN_SECONDS,
      prepSeconds: PREPARE_SECONDS,
      beatSeconds: 1,
      onBeat: (n) => {
        setCountdownLabel(n);
        blipCountdown(n);
      },
    });
  };

  const refreshTitle = () => {
    if (!document.hidden || !isActive() || !engine?.phaseEndInstant) {
      if (document.title !== defaultTitle) document.title = defaultTitle;
      return;
    }

    const secondsLeft = Temporal.Now.instant()
      .until(engine.phaseEndInstant)
      .total("seconds");
    const label = phaseLabel.getText();
    document.title = label
      ? `${label}: ${formatMSS(secondsLeft)}`
      : formatMSS(secondsLeft);
  };

  const setIdleDisplay = () => {
    stopCountdownTimeline();
    setTime(currentConfig.workSeconds);
    setIdleRound();
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
  const applyConfig = (
    config = options.getConfig(),
    { lightUp = false } = {},
  ) => {
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
      if (
        detail.status === STATUS.running &&
        detail.phase &&
        (detail.phase.type === "work" || detail.phase.type === "rest")
      ) {
        play(detail.phase.type === "rest" ? "rest" : "work");
      }
      lastBlippedSecond = null;
      renderPhase(detail, {
        startCountdown: detail.status === STATUS.preparing,
      });
      rememberPhaseType(detail.phase);
      maybeNotify(detail);
      emitRunningChange();
    });

    nextEngine.addEventListener("press", (event) => {
      const detail = /** @type {CustomEvent<{
        remainingSeconds: number,
        status: string,
        phase: Phase | null,
      }>} */ (event).detail;
      if (!isStartup(detail.status)) {
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
      play("resume");
      const detail = /** @type {CustomEvent<PhaseDetail>} */ (event).detail;
      renderPhase(detail, { syncRing: false });
      if (isStartup(detail.status)) {
        if (!countdownTimeline) startCountdownTimeline();
        syncCountdownTimeline();
        countdownTimeline?.play();
      }
      emitRunningChange();
    });

    nextEngine.addEventListener("pause", () => {
      play("pause");
      countdownTimeline?.pause();
      setPlaybackLabel(LABEL.resume);
      phaseLabel.set(LABEL.paused);
      if (nextEngine.currentPhase && nextEngine.remaining) {
        syncRingProgress(
          nextEngine.currentPhase,
          nextEngine.remaining.total("seconds"),
          {
            settle: true,
          },
        );
      }
      emitRunningChange();
      refreshTitle();
    });

    nextEngine.addEventListener("complete", async () => {
      const wasFinalWork = lastPhaseType === "work";
      lastPhaseType = null;
      play("completed");
      stopCountdownTimeline();
      setTime(0);
      phaseLabel.set(LABEL.complete);
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

      if (wasFinalWork) {
        progressRing?.setTotals(
          currentConfig.workSeconds,
          currentConfig.restSeconds,
        );
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
   * @param {{ startCountdown?: boolean, syncRing?: boolean }} [opts]
   */
  const renderPhase = (
    detail,
    { startCountdown = false, syncRing = true } = {},
  ) => {
    if (detail.status === STATUS.preparing) {
      phaseLabel.set(LABEL.prepare);
      setRound(0);
      if (startCountdown) startCountdownTimeline();
      if (syncRing) progressRing?.reset();
      counterRing?.clear();
    } else if (detail.status === STATUS.countdown) {
      phaseLabel.set(LABEL.set, { animate: false });
      setRound(0);
      if (syncRing) progressRing?.reset();
      counterRing?.clear();
    } else if (detail.phase) {
      stopCountdownTimeline();
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
    $playback.disabled = isStartup(detail.status);
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

    if (detail.status === STATUS.countdown) return;

    if (!detail.phase) return;
    const key = `${detail.phase.type}:${detail.round}`;
    if (lastNotifiedKey === key) return;
    lastNotifiedKey = key;
    notifications.notifyPhase(detail.phase.type, {
      round: detail.round,
      totalRounds: detail.totalRounds,
    });
  };

  const startPlayback = () => {
    if (!engine || isActive()) return;
    engine.start();
  };

  $playback.addEventListener("click", () => {
    if (!engine || $playback.disabled) return;

    if (isActive()) {
      engine.pause();
      return;
    }

    // Sound only in this turn. Engine/Motion/notifications run after so they
    // can't stall AudioContext startup on the main thread.
    // Request wake lock in the same turn as the tap for reliability.
    if (engine.status === STATUS.idle) play("start");
    void wakeLock.request();
    setTimeout(() => {
      startPlayback();
      notifications.ensurePermission();
    }, 0);
  });

  $reset.addEventListener("click", () => {
    play("reset");
    applyConfig(undefined, { lightUp: true });
  });

  document.addEventListener("visibilitychange", () => {
    refreshTitle();
    if (!document.hidden) syncCountdownTimeline();
  });

  applyConfig(currentConfig, { lightUp: true });

  return {
    softReset: applyConfig,
  };
}
