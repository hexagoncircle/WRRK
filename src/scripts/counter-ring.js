import { clamp } from "./utils.js";

const ANNOUNCE_MS = 3000;
const PATH_LENGTH = 100;
const GAP_SHARE = 0.6;
const ROUND_MAX_COUNT = 30;

/**
 * Segmented rounds counter driven by CSS custom properties.
 * @param {HTMLElement} root Element with .counter-ring
 */
export function createCounterRing(root) {
  const $fill = root.querySelector(".fill");
  const $active = root.querySelector(".active");
  const $current = root.querySelector(".current");
  const $total = root.querySelector(".total");

  let count = clamp(root.style.getPropertyValue("--count"), 1, Number.MAX_SAFE_INTEGER);
  let announcedRound = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let announceTimer = null;

  function geometry(n) {
    const baseGap =
      Number.parseFloat(getComputedStyle(root).getPropertyValue("--ring-gap")) || 0;
    const segment = PATH_LENGTH / n;
    const linecap = n <= ROUND_MAX_COUNT ? "round" : "butt";

    if (linecap === "round") {
      const gap = Math.min(baseGap, segment);
      return { gap, segment, dash: segment - gap, linecap };
    }

    const gap = Math.min(baseGap, segment * GAP_SHARE);
    return { gap, segment, dash: Math.max(segment - gap, 0), linecap };
  }

  function applyGeometry() {
    const g = geometry(count);
    root.style.setProperty("--segment-gap", String(g.gap));
    root.style.setProperty("--segment-dash", String(g.dash));
    root.style.setProperty("--segment-rest", String(PATH_LENGTH - g.dash));
    root.style.setProperty("--segment-linecap", g.linecap);
    return g;
  }

  function paintFillRing(dasharray, visible) {
    if (!($fill instanceof SVGElement)) return;
    $fill.style.setProperty("--fill-dasharray", dasharray);
    $fill.style.opacity = visible ? "1" : "0";
  }

  /** @param {number} lit How many segments from the start are solid (0..count) */
  function paintFill(lit) {
    const { segment, dash, gap } = applyGeometry();

    if (lit <= 0) {
      paintFillRing("0 100", false);
      if ($active) $active.style.opacity = "0";
      return;
    }

    const completed = lit - 1;
    if (completed === 0) {
      paintFillRing("0 100", false);
    } else {
      const pattern = [];
      for (let i = 0; i < completed; i++) pattern.push(dash, gap);
      pattern[pattern.length - 1] = gap + (count - completed) * segment;
      paintFillRing(pattern.join(" "), true);
    }

    if ($active) $active.style.opacity = "1";
    root.style.setProperty("--active-index", String(completed));
  }

  function stopAnnounce() {
    if (announceTimer != null) {
      clearTimeout(announceTimer);
      announceTimer = null;
    }
    delete root.dataset.announce;
  }

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
    applyGeometry();
  }

  /** @param {number} [current=1] 1-based label — pass total on complete so N/N persists */
  function showAll(current = 1) {
    announcedRound = 0;
    stopAnnounce();
    paintFill(count);
    if ($current) $current.textContent = String(clamp(current, 1, count));
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
