/**
 * Segmented rounds counter ring driven by CSS custom properties.
 *
 * @param {HTMLElement} root Element with .counter-ring
 */
export function createCounterRing(root) {
  const $fill = root.querySelector(".counter-fill");
  const $current = root.querySelector(".current");
  const $total = root.querySelector(".total");

  let count = Math.max(1, Number(root.style.getPropertyValue("--count")) || 1);

  function readGap() {
    return Number.parseFloat(getComputedStyle(root).getPropertyValue("--ring-gap")) || 5;
  }

  /**
   * @param {number} n
   */
  function geometry(n) {
    const gap = readGap();
    const segment = 100 / n;
    const dash = Math.max(segment - gap, 0);
    return { gap, segment, dash };
  }

  /**
   * @param {number} lit How many segments from the start are solid (0..count)
   */
  function paintFill(lit) {
    const { segment, dash, gap } = geometry(count);

    if (!($fill instanceof SVGElement)) return;

    if (lit <= 0) {
      $fill.style.setProperty("--fill-dasharray", "0 100");
      $fill.style.opacity = "0";
      return;
    }

    const pattern = [];
    for (let i = 0; i < lit; i++) {
      pattern.push(dash, gap);
    }
    if (lit < count) {
      pattern[pattern.length - 1] = gap + (count - lit) * segment;
    }

    $fill.style.opacity = "1";
    $fill.style.setProperty("--fill-dasharray", pattern.join(" "));
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
   * All segments lit (idle / complete).
   * @param {number} [current=1] 1-based label — pass total on complete so N/N persists
   */
  function showAll(current = 1) {
    paintFill(count);
    if ($current) {
      const n = Math.max(1, Math.min(count, Math.trunc(Number(current) || 1)));
      $current.textContent = String(n);
    }
  }

  /** Empty fill instantly (prepare / pre-workout). */
  function clear() {
    paintFill(0);
    if ($current) $current.textContent = "1";
  }

  /**
   * Fill segments through the active round.
   * @param {number} round 1-based current round
   * @param {number} total total rounds
   */
  function setActive(round, total) {
    if (total != null && total !== count) setCount(total);

    const current = Math.max(1, Math.min(count, Math.trunc(Number(round) || 1)));

    paintFill(current);
    if ($current) $current.textContent = String(current);
  }

  showAll();

  return { setCount, showAll, clear, setActive };
}
