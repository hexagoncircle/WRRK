import { Temporal } from "@js-temporal/polyfill";
import { TimerEngine } from "./engine.js";
import { formatMMSS } from "./format.js";
import { NotificationController } from "./notifications.js";
import { WakeLockController } from "./wake-lock.js";

/** @typedef {import('./model.js').TimerSet} TimerSet */

/**
 * Progressive enhancement for the timer player.
 * @param {HTMLElement} root
 */
export function enhancePlayer(root) {
  const timeEl = root.querySelector("[data-player-time]");
  const roundEl = root.querySelector("[data-player-round]");
  const phaseEl = root.querySelector("[data-player-phase]");
  const playPauseButton = root.querySelector("[data-player-play-pause]");
  const resetButton = root.querySelector("[data-player-reset]");

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
  /** @type {TimerSet | null} */
  let currentSet = null;
  const wakeLock = new WakeLockController();
  const notifications = new NotificationController();
  /** @type {string | null} */
  let lastNotifiedKey = null;

  const defaultTitle = document.title;

  /**
   * Surface the countdown and phase type in the tab title while the tab is
   * backgrounded, so a hidden timer stays glanceable. Restore the original
   * title whenever the tab is visible or the timer isn't actively counting.
   */
  const refreshTitle = () => {
    const active = engine && (engine.status === "running" || engine.status === "preparing");
    if (!document.hidden || !active || !engine.phaseEndInstant) {
      if (document.title !== defaultTitle) document.title = defaultTitle;
      return;
    }

    const secondsLeft = Temporal.Now.instant().until(engine.phaseEndInstant).total("seconds");
    const time = formatMMSS(secondsLeft);
    const label = phaseEl.textContent ?? "";
    document.title = label ? `${label}: ${time}` : time;
  };

  const setIdleDisplay = () => {
    timeEl.textContent = "—";
    roundEl.textContent = "";
    phaseEl.textContent = currentSet ? currentSet.name : "No set loaded";
    playPauseButton.textContent = "Play";
    playPauseButton.disabled = !currentSet;
    resetButton.disabled = !currentSet;
  };

  /**
   * @param {TimerSet} set
   */
  const loadSet = (set) => {
    engine?.reset();
    void wakeLock.release();
    engine = new TimerEngine(set);
    currentSet = set;
    lastNotifiedKey = null;
    delete phaseEl.dataset.phaseType;
    bindEngine(engine);
    setIdleDisplay();
  };

  /**
   * Stop playback and unload the set, e.g. when leaving play mode.
   */
  const stop = () => {
    engine?.reset();
    engine = null;
    currentSet = null;
    lastNotifiedKey = null;
    void wakeLock.release();
    delete phaseEl.dataset.phaseType;
    setIdleDisplay();
    refreshTitle();
  };

  /**
   * @param {TimerEngine} nextEngine
   */
  const bindEngine = (nextEngine) => {
    nextEngine.addEventListener("phase-change", (event) => {
      const detail = /** @type {CustomEvent} */ (event).detail;
      renderPhase(detail);
      maybeNotify(detail);
    });

    nextEngine.addEventListener("tick", (event) => {
      const detail = /** @type {CustomEvent} */ (event).detail;
      timeEl.textContent = formatMMSS(detail.remainingSeconds);
      if (detail.status === "preparing") {
        phaseEl.textContent = "Get ready";
        roundEl.textContent = "";
      }
      refreshTitle();
    });

    nextEngine.addEventListener("pause", () => {
      playPauseButton.textContent = "Play";
      void wakeLock.release();
      refreshTitle();
    });

    nextEngine.addEventListener("complete", () => {
      timeEl.textContent = "Done";
      phaseEl.textContent = "Complete";
      roundEl.textContent = currentSet ? `Round ${currentSet.rounds}/${currentSet.rounds}` : "";
      playPauseButton.textContent = "Play";
      playPauseButton.disabled = true;
      void wakeLock.release();
      notifications.notifyPhase("complete");
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
   *   phase: import('./model.js').Phase | null,
   *   round: number | null,
   *   totalRounds: number,
   * }} detail
   */
  const renderPhase = (detail) => {
    if (detail.status === "preparing") {
      phaseEl.textContent = "Get ready";
      roundEl.textContent = "";
      playPauseButton.textContent = "Pause";
      playPauseButton.disabled = false;
      refreshTitle();
      return;
    }

    if (!detail.phase) return;

    phaseEl.textContent = detail.phase.type === "work" ? "Work" : "Rest";
    phaseEl.dataset.phaseType = detail.phase.type;
    roundEl.textContent = `Round ${detail.round}/${detail.totalRounds}`;
    playPauseButton.textContent = "Pause";
    playPauseButton.disabled = false;
    refreshTitle();
  };

  /**
   * @param {{
   *   status: string,
   *   phase: import('./model.js').Phase | null,
   *   round: number | null,
   *   totalRounds: number,
   * }} detail
   */
  const maybeNotify = (detail) => {
    if (detail.status === "preparing") {
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
    if (!engine || !currentSet) return;
    if (engine.status === "running" || engine.status === "preparing") return;

    await notifications.ensurePermission();
    engine.start();
    await wakeLock.request();
    playPauseButton.textContent = "Pause";
    playPauseButton.disabled = false;
  };

  playPauseButton.addEventListener("click", async () => {
    if (!engine || !currentSet) return;

    if (engine.status === "running" || engine.status === "preparing") {
      engine.pause();
      return;
    }

    await startPlayback();
  });

  resetButton.addEventListener("click", () => {
    engine?.reset();
  });

  document.addEventListener("visibilitychange", refreshTitle);

  setIdleDisplay();

  return {
    loadSet,
    start: startPlayback,
    stop,
  };
}
