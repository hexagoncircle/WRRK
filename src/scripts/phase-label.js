import { animate, steps } from "motion";
import { LABEL } from "./labels.js";

const DURATION = 0.2;
const LINE = "1lh";
const SLIDE_DOWN = new Set([LABEL.prepare, LABEL.paused]);

/**
 * @param {string | null | undefined} tone
 * @returns {"work" | "rest" | null}
 */
function normalizeTone(tone) {
  return tone === "work" || tone === "rest" ? tone : null;
}

/**
 * Slide text up: outgoing exits top, incoming enters from below (clipped).
 * @param {HTMLElement} root Clip container (e.g. `.phase`)
 */
export function createPhaseLabel(root) {
  /** @type {HTMLElement} */
  let track =
    root.querySelector(".phase-track") ??
    (() => {
      const el = document.createElement("div");
      el.className = "phase-track";
      el.setAttribute("aria-hidden", "true");
      const existing = root.querySelector(".phase-label");
      if (existing) el.append(existing);
      else if (root.textContent?.trim()) {
        const label = document.createElement("div");
        label.className = "phase-label";
        label.textContent = root.textContent.trim();
        el.append(label);
      }
      root.replaceChildren(el);
      return el;
    })();

  track.setAttribute("aria-hidden", "true");

  /** @type {HTMLElement | null} */
  let label = track.querySelector(".phase-label");
  let text = label?.textContent ?? "";
  /** @type {"work" | "rest" | null} */
  let tone = normalizeTone(label?.dataset.tone ?? root.dataset.tone);
  /** @type {{ stop: () => void } | null} */
  let active = null;

  if (text) root.setAttribute("aria-label", text);

  /** @param {string} next @param {"work" | "rest" | null} nextTone */
  const makeLabel = (next, nextTone) => {
    const el = document.createElement("div");
    el.className = "phase-label";
    el.textContent = next;
    if (nextTone) el.dataset.tone = nextTone;
    return el;
  };

  /** @param {"work" | "rest" | null} nextTone */
  const applyRootTone = (nextTone) => {
    if (nextTone) root.dataset.tone = nextTone;
    else delete root.dataset.tone;
  };

  /** @param {string} next @param {"work" | "rest" | null} nextTone */
  const snap = (next, nextTone) => {
    active?.stop();
    active = null;
    track.removeAttribute("style");
    if (!label) label = makeLabel(next, nextTone);
    else {
      label.textContent = next;
      if (nextTone) label.dataset.tone = nextTone;
      else delete label.dataset.tone;
    }
    track.replaceChildren(label);
    root.replaceChildren(track);
    root.setAttribute("aria-label", next);
    applyRootTone(nextTone);
    text = next;
    tone = nextTone;
  };

  /**
   * @param {string} next
   * @param {"work" | "rest" | null} nextTone
   * @param {"bottom" | "top"} [from]
   */
  const slide = (next, nextTone, from = "bottom") => {
    if (!label) {
      snap(next, nextTone);
      return;
    }

    active?.stop();

    const outgoing = label;
    if (tone) outgoing.dataset.tone = tone;
    const incoming = makeLabel(next, nextTone);
    const fromTop = from === "top";

    track.replaceChildren(...(fromTop ? [incoming, outgoing] : [outgoing, incoming]));
    if (fromTop) track.style.transform = `translateY(-${LINE})`;
    else track.removeAttribute("style");
    root.setAttribute("aria-label", next);
    delete root.dataset.tone;

    text = next;
    tone = nextTone;
    label = incoming;

    const controls = animate(
      track,
      { y: fromTop ? [`-${LINE}`, 0] : [0, `-${LINE}`] },
      { duration: DURATION, ease: steps(3) },
    );
    active = controls;

    controls.then(
      () => {
        if (active !== controls) return;
        active = null;
        outgoing.remove();
        track.removeAttribute("style");
        applyRootTone(nextTone);
      },
      () => {
        if (active !== controls) return;
        active = null;
        snap(next, nextTone);
      },
    );
  };

  /**
   * @param {string} next
   * @param {{ tone?: string | null, animate?: boolean, from?: "bottom" | "top" }} [opts]
   */
  const set = (next, { tone: nextTone = null, animate: shouldAnimate = true, from } = {}) => {
    const resolvedTone = normalizeTone(nextTone);
    if (next === text && resolvedTone === tone && !active) return;

    if (next === LABEL.complete) {
      snap(next, resolvedTone);
      return;
    }

    if (
      next === LABEL.start &&
      (text === LABEL.complete || text === LABEL.paused)
    ) {
      snap(next, resolvedTone);
      return;
    }

    if (shouldAnimate && text && next !== text) {
      const direction = from ?? (SLIDE_DOWN.has(next) ? "top" : "bottom");
      slide(next, resolvedTone, direction);
      return;
    }

    snap(next, resolvedTone);
  };

  return { set, getText: () => text };
}
