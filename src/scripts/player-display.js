import { formatDurationAttr, formatMSS } from "./utils.js";
import { LABEL } from "./labels.js";
import { totalWorkoutSeconds } from "./model.js";

/** @typedef {import('./model.js').TimerConfig} TimerConfig */

/**
 * DOM writers for the timer player's clock, round, and transport labels.
 * @param {{
 *   time: HTMLElement & { dateTime?: string },
 *   digits: NodeListOf<Element> | Element[],
 *   roundLabel: HTMLElement,
 *   roundCurrent: HTMLElement,
 *   playback: HTMLElement,
 *   playbackLabel: HTMLElement,
 * }} els
 */
export function createPlayerDisplay(els) {
  const { time, digits, roundLabel, roundCurrent, playback, playbackLabel } = els;

  /** @param {string} text */
  const setPlaybackLabel = (text) => {
    playbackLabel.textContent = text;
    playback.dataset.action = text === LABEL.pause ? "pause" : "play";
  };

  /**
   * Map a whole-second countdown onto the digit SVGs (M:SS, max 9:59).
   * @param {number} seconds
   */
  const setTime = (seconds) => {
    const label = formatMSS(seconds);
    const [mins, secs] = label.split(":");
    const values = [mins, secs[0], secs[1]];

    [...digits].forEach((el, i) => {
      if (!(el instanceof Element)) return;
      const digit = values[i] ?? "0";
      if (el.dataset.digit !== digit) {
        el.dataset.digit = digit;
      }
    });

    time.dateTime = formatDurationAttr(seconds);
    time.setAttribute("aria-label", label);
  };

  /** @param {number} n */
  const setCountdownLabel = (n) => {
    time.dateTime = `PT${n}S`;
    time.setAttribute("aria-label", String(n));
  };

  /** @param {number | null} current */
  const setRound = (current) => {
    const pending = current == null;
    roundLabel.hidden = pending;
    roundCurrent.textContent = pending ? "––" : String(current);
  };

  /** @param {TimerConfig} config */
  const setIdleRound = (config) => {
    roundLabel.hidden = true;
    roundCurrent.textContent = formatMSS(totalWorkoutSeconds(config));
  };

  return { setPlaybackLabel, setTime, setCountdownLabel, setRound, setIdleRound };
}
