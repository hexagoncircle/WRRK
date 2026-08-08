import { readRingGap } from "./utils.js";

const ANNOUNCE_MS = 3000;

/**
 * Segmented rounds counter ring driven by CSS custom properties.
 *
 * @param {HTMLElement} root Element with .counter-ring
 */
export function createCounterRing(root) {
  const $fill = root.querySelector(".counter-fill");
  const $active = root.querySelector(".counter-active");
  const $current = root.querySelector(".current");
  const $total = root.querySelector(".total");

  let count = Math.max(1, Number(root.style.getPropertyValue("--count")) || 1);
  /** @type {number} Last round that triggered the start announce (0 = none) */
  let announcedRound = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let announceTimer = null;

  /**
   * @param {number} n
   */
  function geometry(n) {
    const gap = readRingGap(root);
    const segment = 100 / n;
    const dash = Math.max(segment - gap, 0);
    return { gap, segment, dash };
  }

  /**
   * @param {SVGElement | null} el
   * @param {string} dasharray
   * @param {boolean} visible
   * @param {number} [dashoffset]
   */
  function paintCircle(el, dasharray, visible, dashoffset) {
    if (!(el instanceof SVGElement)) return;
    el.style.setProperty("--fill-dasharray", dasharray);
    if (dashoffset == null) {
      el.style.removeProperty("--fill-dashoffset");
    } else {
      el.style.setProperty("--fill-dashoffset", String(dashoffset));
    }
    el.style.opacity = visible ? "1" : "0";
  }

  /**
   * @param {number} lit How many segments from the start are solid (0..count)
   */
  function paintFill(lit) {
    const { segment, dash, gap } = geometry(count);

    if (lit <= 0) {
      paintCircle($fill, "0 100", false);
      paintCircle($active, "0 100", false);
      return;
    }

    // Prior rounds stay solid; the current round lives on .counter-active so it can pulse.
    const completed = lit - 1;
    if (completed <= 0) {
      paintCircle($fill, "0 100", false);
    } else {
      const pattern = [];
      for (let i = 0; i < completed; i++) {
        pattern.push(dash, gap);
      }
      pattern[pattern.length - 1] = gap + (count - completed) * segment;
      paintCircle($fill, pattern.join(" "), true);
    }

    // Position with dashoffset — a leading "0 ${lead}" dash becomes a round-cap dot.
    const index = lit - 1;
    paintCircle($active, `${dash} ${100 - dash}`, true, -gap / 2 - index * segment);
  }

  function stopAnnounce() {
    if (announceTimer != null) {
      clearTimeout(announceTimer);
      announceTimer = null;
    }
    delete root.dataset.announce;
  }

  /**
   * Show the round number alone, larger, with a 3s pulse.
   * @param {number} round
   */
  function announce(round) {
    if (announcedRound === round) return;

    announcedRound = round;
    stopAnnounce();
    root.dataset.announce = "";
    announceTimer = setTimeout(() => {
      announceTimer = null;
      delete root.dataset.announce;
    }, ANNOUNCE_MS);
  }

  /**
   * @param {number} next
   */
  function setCount(next) {
    count = Math.max(1, Math.trunc(Number(next) || 1));
    root.style.setProperty("--count", String(count));
    if ($total) $total.textContent = String(count);
  }

  /**
   * @param {number} [current=1] 1-based label — pass total on complete so N/N persists
   */
  function showAll(current = 1) {
    announcedRound = 0;
    stopAnnounce();
    paintFill(count);
    if ($current) {
      const n = Math.max(1, Math.min(count, Math.trunc(Number(current) || 1)));
      $current.textContent = String(n);
    }
  }

  function clear() {
    announcedRound = 0;
    stopAnnounce();
    paintFill(0);
    if ($current) $current.textContent = "1";
  }

  /**
   * @param {number} round 1-based current round
   * @param {number} total total rounds
   */
  function setActive(round, total) {
    if (total != null && total !== count) setCount(total);

    const current = Math.max(1, Math.min(count, Math.trunc(Number(round) || 1)));

    paintFill(current);
    if ($current) $current.textContent = String(current);
    announce(current);
  }

  showAll();

  return { setCount, showAll, clear, setActive };
}
