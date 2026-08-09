import { clamp } from "./utils.js";

const ANNOUNCE_MS = 3000;

/**
 * Segmented rounds counter driven by CSS custom properties.
 * @param {HTMLElement} root Element with .counter-ring
 */
export function createCounterRing(root) {
  const $fill = root.querySelector(".counter-fill");
  const $active = root.querySelector(".counter-active");
  const $current = root.querySelector(".current");
  const $total = root.querySelector(".total");

  let count = clamp(root.style.getPropertyValue("--count"), 1, Number.MAX_SAFE_INTEGER);
  let announcedRound = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let announceTimer = null;

  function geometry(n) {
    const gap =
      Number.parseFloat(getComputedStyle(root).getPropertyValue("--ring-gap")) || 0;
    const segment = 100 / n;
    return { gap, segment, dash: Math.max(segment - gap, 0) };
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

  /** @param {number} lit How many segments from the start are solid (0..count) */
  function paintFill(lit) {
    const { segment, dash, gap } = geometry(count);

    if (lit <= 0) {
      paintCircle($fill, "0 100", false);
      paintCircle($active, "0 100", false);
      return;
    }

    // Completed rounds on .counter-fill; current round on .counter-active (pulses).
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

  /** Show the round number alone for ANNOUNCE_MS. */
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

  function setCount(next) {
    count = clamp(next, 1, Number.MAX_SAFE_INTEGER);
    root.style.setProperty("--count", String(count));
    if ($total) $total.textContent = String(count);
  }

  /** @param {number} [current=1] 1-based label — pass total on complete so N/N persists */
  function showAll(current = 1) {
    announcedRound = 0;
    stopAnnounce();
    paintFill(count);
    if ($current) {
      $current.textContent = String(clamp(current, 1, count));
    }
  }

  function clear() {
    announcedRound = 0;
    stopAnnounce();
    paintFill(0);
    if ($current) $current.textContent = "1";
  }

  /** @param {number} round 1-based current round */
  function setActive(round, total) {
    if (total != null && total !== count) setCount(total);
    const current = clamp(round, 1, count);
    paintFill(current);
    if ($current) $current.textContent = String(current);
    announce(current);
  }

  showAll();

  return { setCount, showAll, clear, setActive };
}
