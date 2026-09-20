import { cancelDigitDance, playCountdown, playDigitDance } from "./digit-dance.js";
import { STATUS, TimerEngine } from "./engine.js";
import { createTimeout, formatMSS } from "./utils.js";
import { LABEL } from "./labels.js";
import { COUNTDOWN_SECONDS, PREPARE_SECONDS, toPhaseType } from "./model.js";
import { createCounterRing } from "./counter-ring.js";
import { createPhaseLabel } from "./phase-label.js";
import { createPlayerDisplay } from "./player-display.js";
import { createProgressRing } from "./progress-ring.js";
import { play } from "./sounds.js";
import { WakeLockController } from "./wake-lock.js";

const COMPLETE_RESET_MS = 3000;

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

  const { setPlaybackLabel, setTime, setCountdownLabel, setRound, setIdleRound } =
    createPlayerDisplay({
      time: /** @type {HTMLElement & { dateTime?: string }} */ ($time),
      digits: $digits,
      roundLabel: /** @type {HTMLElement} */ ($roundLabel),
      roundCurrent: /** @type {HTMLElement} */ ($roundCurrent),
      playback: /** @type {HTMLElement} */ ($playback),
      playbackLabel: /** @type {HTMLElement} */ ($playbackLabel),
    });

  /** @type {{ stop: () => void, pause: () => void, play: () => void, time: number } | null} */
  let countdownTimeline = null;
  const completeTimer = createTimeout();

  /** @type {TimerEngine | null} */
  let engine = null;
  /** @type {TimerConfig} */
  let currentConfig = options.getConfig();
  const wakeLock = new WakeLockController();
  /** @type {number | null} */
  let lastBlippedSecond = null;
  /** @type {'work' | 'rest' | null} */
  let lastPhaseType = null;
  const defaultTitle = document.title;

  const clearSessionFlags = () => {
    lastBlippedSecond = null;
    lastPhaseType = null;
  };

  /** @param {number} sec */
  const blipCountdown = (sec) => {
    if (sec < 1 || sec > 3) return;
    play("blip", { pan: (2 - sec) * 0.25 });
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
    if (!toPhaseType(phase?.type)) {
      progressRing.reset();
      return;
    }
    progressRing.setProgress(
      {
        phase: /** @type {'work' | 'rest'} */ (phase.type),
        remainingSeconds,
        durationSeconds: phase.durationSeconds,
      },
      { settle },
    );
  };

  const syncCounterIdle = () => {
    counterRing?.setCount(currentConfig.rounds);
    counterRing?.showAll();
  };

  const isStartup = (status = engine?.status) =>
    status === STATUS.preparing || status === STATUS.countdown;

  const isActive = () => Boolean(engine && (engine.status === STATUS.running || isStartup()));

  const syncRootAttrs = () => {
    attrsRoot.dataset.status = engine?.status ?? STATUS.idle;

    const phaseType = toPhaseType(engine?.currentPhase?.type);
    if (phaseType) {
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

  const syncSessionState = () => {
    syncRootAttrs();
    syncWakeLock();
    const idle = (engine?.status ?? STATUS.idle) === STATUS.idle;
    options.onRunningChange?.(!idle);
  };

  const stopCountdownTimeline = () => {
    countdownTimeline = null;
    cancelDigitDance();
  };

  const secondsUntilPhaseEnd = () => {
    if (engine?.phaseEndMs == null) return 0;
    return (engine.phaseEndMs - Date.now()) / 1000;
  };

  const syncCountdownTimeline = () => {
    if (!countdownTimeline || engine?.phaseEndMs == null) return;
    if (!isStartup()) return;
    const left = secondsUntilPhaseEnd();
    if (engine.status === STATUS.preparing) {
      countdownTimeline.time = Math.max(0, PREPARE_SECONDS - left);
    } else if (engine.status === STATUS.countdown) {
      countdownTimeline.time = Math.max(0, PREPARE_SECONDS + COUNTDOWN_SECONDS - left);
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
        // Stagger into `3` starts with "Get ready" and the first blip.
        if (n === COUNTDOWN_SECONDS) {
          phaseLabel.set(LABEL.set, { animate: false });
        }
        setCountdownLabel(n);
        blipCountdown(n);
      },
    });
  };

  const refreshTitle = () => {
    if (!document.hidden || !isActive() || engine?.phaseEndMs == null) {
      if (document.title !== defaultTitle) document.title = defaultTitle;
      return;
    }

    const label = phaseLabel.getText();
    const clock = formatMSS(secondsUntilPhaseEnd());
    document.title = label ? `${label}: ${clock}` : clock;
  };

  const setIdleDisplay = () => {
    stopCountdownTimeline();
    setTime(currentConfig.workSeconds);
    setIdleRound(currentConfig);
    phaseLabel.set(LABEL.idle);
    setPlaybackLabel(LABEL.start);
    $playback.disabled = false;
    $reset.disabled = false;
    syncRingTotals();
    syncCounterIdle();
    syncSessionState();
  };

  const lightUpDigits = () => playDigitDance($digits);

  /**
   * @param {TimerConfig} [config]
   * @param {{ lightUp?: boolean }} [options]
   */
  const applyConfig = (config = options.getConfig(), { lightUp = false } = {}) => {
    completeTimer.clear();
    currentConfig = config;
    engine?.reset();
    engine = new TimerEngine(config);
    clearSessionFlags();
    bindEngine(engine);
    setIdleDisplay();
    if (lightUp) lightUpDigits();
  };

  /**
   * @param {CustomEvent<PhaseDetail>} event
   */
  const onPhaseChange = (event) => {
    const detail = event.detail;
    if (detail.status === STATUS.running && toPhaseType(detail.phase?.type)) {
      play(detail.phase.type);
    }
    lastBlippedSecond = null;
    renderPhase(detail, {
      startCountdown: detail.status === STATUS.preparing,
    });
    lastPhaseType = toPhaseType(detail.phase?.type);
    syncSessionState();
  };

  /**
   * @param {CustomEvent<{
   *   remainingSeconds: number,
   *   status: string,
   *   phase: Phase | null,
   * }>} event
   */
  const onPress = (event) => {
    const detail = event.detail;
    if (!isStartup(detail.status)) {
      setTime(detail.remainingSeconds);
      syncRingProgress(detail.phase, detail.remainingSeconds);

      if (detail.status === STATUS.running && toPhaseType(detail.phase?.type)) {
        const sec = Math.ceil(detail.remainingSeconds);
        if (sec !== lastBlippedSecond) {
          lastBlippedSecond = sec;
          blipCountdown(sec);
        }
      }
    }

    refreshTitle();
  };

  /**
   * @param {TimerEngine} nextEngine
   */
  const bindEngine = (nextEngine) => {
    nextEngine.addEventListener("phase-change", onPhaseChange);

    nextEngine.addEventListener("press", onPress);

    nextEngine.addEventListener("resume", (event) => {
      play("resume");
      const detail = /** @type {CustomEvent<PhaseDetail>} */ (event).detail;
      renderPhase(detail, { syncRing: false });
      if (isStartup(detail.status)) {
        if (!countdownTimeline) startCountdownTimeline();
        syncCountdownTimeline();
        countdownTimeline?.play();
      }
      syncSessionState();
    });

    nextEngine.addEventListener("pause", () => {
      play("pause");
      countdownTimeline?.pause();
      setPlaybackLabel(LABEL.resume);
      phaseLabel.set(LABEL.paused);
      if (nextEngine.currentPhase && nextEngine.remaining != null) {
        syncRingProgress(nextEngine.currentPhase, nextEngine.remaining, {
          settle: true,
        });
      }
      syncSessionState();
      refreshTitle();
    });

    nextEngine.addEventListener("complete", async () => {
      const wasFinalWork = lastPhaseType === "work";
      lastPhaseType = null;
      play("completed");
      stopCountdownTimeline();
      setTime(0);
      phaseLabel.set(LABEL.complete);
      setRound(null);
      setPlaybackLabel(LABEL.start);
      $playback.disabled = true;
      counterRing?.showAll(currentConfig.rounds);
      syncSessionState();
      refreshTitle();

      completeTimer.set(() => {
        applyConfig(undefined, { lightUp: true });
      }, COMPLETE_RESET_MS);

      if (wasFinalWork) {
        progressRing?.setTotals(currentConfig.workSeconds, currentConfig.restSeconds);
      }
    });

    nextEngine.addEventListener("reset", () => {
      clearSessionFlags();
      refreshTitle();
    });
  };

  /**
   * @param {PhaseDetail} detail
   * @param {{ startCountdown?: boolean, syncRing?: boolean }} [opts]
   */
  const renderPhase = (detail, { startCountdown = false, syncRing = true } = {}) => {
    if (isStartup(detail.status)) {
      if (detail.status === STATUS.preparing) {
        phaseLabel.set(LABEL.prepare);
        if (startCountdown) startCountdownTimeline();
      } else {
        phaseLabel.set(LABEL.set, { animate: false });
      }
      setRound(null);
      if (syncRing) progressRing?.reset();
      counterRing?.clear();
    } else if (detail.phase) {
      stopCountdownTimeline();
      const type = detail.phase.type;
      const tone = toPhaseType(detail.phase.type);
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

    // Sound only in this turn. Engine/Motion run after so they can't stall
    // AudioContext startup on the main thread.
    // Request wake lock in the same turn as the tap for reliability.
    if (engine.status === STATUS.idle) play("start");
    void wakeLock.request();
    setTimeout(() => {
      startPlayback();
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
