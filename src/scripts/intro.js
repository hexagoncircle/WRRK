const LOGO_LEAD_MS = 600;
const LOTTIE_TIMEOUT_MS = 8000;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function hold(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function finishIntro() {
  document.documentElement.dataset.intro = "done";
}

/**
 * Reveal the timer with no animation (skip path): unlock immediately since
 * there's no curtain to wait for. Remove the intro shell when present.
 * @param {(() => void) | undefined} onReveal
 * @param {HTMLElement} [intro]
 */
function revealApp(onReveal, intro) {
  onReveal?.();
  // `inert` already removes the subtree from the accessibility tree
  // (Baseline since April 2023), so there's no need to also toggle aria-hidden.
  // It lives on <html>, not #app: #intro covers the full viewport with no
  // interactive content of its own, so nothing on the page should be
  // reachable while it's up — not just the app.
  document.documentElement.removeAttribute("inert");
  intro?.remove();
  finishIntro();
}

/**
 * Resolve once a CSS animation with the given name finishes on target
 * (or one of its descendants, since `animationend` bubbles).
 * @param {HTMLElement} target
 * @param {string} animationName
 * @returns {Promise<void>}
 */
function waitForAnimation(target, animationName) {
  return new Promise((resolve) => {
    target.addEventListener("animationend", function handler(event) {
      if (event.animationName !== animationName) return;
      target.removeEventListener("animationend", handler);
      resolve();
    });
  });
}

/**
 * Resolve once a CSS transition of the given property finishes on target.
 * @param {HTMLElement} target
 * @param {string} property
 * @returns {Promise<void>}
 */
function waitForTransition(target, property) {
  return new Promise((resolve) => {
    target.addEventListener("transitionend", function handler(event) {
      if (event.propertyName !== property) return;
      target.removeEventListener("transitionend", handler);
      resolve();
    });
  });
}

/**
 * Resolve once `event` fires on a Lottie AnimationItem. Lottie's emitter
 * isn't a real EventTarget, so `{ once: true }` isn't honored — this removes
 * its own listener instead.
 * @param {{ addEventListener: Function, removeEventListener: Function }} target
 * @param {string} event
 * @returns {Promise<void>}
 */
function once(target, event) {
  return new Promise((resolve) => {
    target.addEventListener(event, function handler() {
      target.removeEventListener(event, handler);
      resolve();
    });
  });
}

/**
 * Play a panel's Lottie once. Optional onNearEnd fires once, LOGO_LEAD_MS
 * before complete (scheduled from duration on DOMLoaded). CSS handles the
 * poster→SVG swap once the panel gets `.is-ready` (see the component styles).
 *
 * A panel settles on whichever comes first: a clean "complete", a
 * "data_failed", or the LOTTIE_TIMEOUT_MS safety net. In practice it's
 * always "complete" — the other two exist for a stuck or broken asset and
 * are not expected to fire.
 * @param {HTMLElement} panel
 * @param {typeof import('lottie-web/build/player/lottie_light.js').default} lottie
 * @param {(() => void) | undefined} [onNearEnd]
 * @returns {Promise<{ destroy: () => void }>}
 */
function playAnimation(panel, lottie, onNearEnd) {
  const src = panel.dataset.src;
  if (!src) {
    onNearEnd?.();
    return Promise.resolve({ destroy: () => {} });
  }

  const anim = lottie.loadAnimation({
    container: panel,
    renderer: "svg",
    loop: false,
    autoplay: false,
    path: src,
    rendererSettings: {
      progressiveLoad: true,
      hideOnTransparent: true,
    },
  });

  anim.addEventListener("DOMLoaded", () => {
    panel.classList.add("is-ready");
    anim.setSubframe(false);
    anim.play();
    if (onNearEnd) {
      const durationMs = (anim.totalFrames / anim.frameRate) * 1000;
      window.setTimeout(onNearEnd, Math.max(0, durationMs - LOGO_LEAD_MS));
    }
  });

  return Promise.race([
    once(anim, "complete"),
    once(anim, "data_failed"),
    hold(LOTTIE_TIMEOUT_MS),
  ]).then(() => ({
    destroy: () => {
      try {
        anim.destroy();
      } catch {
        // Already torn down.
      }
    },
  }));
}

/**
 * Trigger the logo-slam / figure-jump keyframes (defined in the component's
 * CSS). The slam's duration includes the rest at the end state, so this
 * resolves when that animation ends.
 * @param {HTMLElement} intro
 */
async function showLogotype(intro) {
  const done = waitForAnimation(intro, "logo-slam");
  intro.classList.add("is-slamming");
  await done;
}

/**
 * Clip the white overlay away bottom→top (a plain CSS transition); kick off
 * the digit dance as it clears.
 * @param {HTMLElement} intro
 * @param {Array<{ destroy: () => void }>} [players]
 * @param {(() => void) | undefined} [onReveal]
 */
async function revealTimer(intro, players = [], onReveal) {
  const done = waitForTransition(intro, "clip-path");
  intro.classList.add("is-exiting");
  onReveal?.();
  // finishIntro() stays synchronous here (not after `await done`): its
  // dataset flag is the only guard against playIntro() re-entering while
  // the wipe is still running.
  finishIntro();
  await done;

  // <html> stays inert for the full wipe: nothing behind the curtain should
  // be focusable or clickable until it's actually visible.
  document.documentElement.removeAttribute("inert");
  for (const player of players) player.destroy();
  intro.remove();
}

/**
 * Runs the brand intro when online, then clips away bottom→top to reveal the timer.
 * Offline and reduced-motion skip straight to the timer (intro assets are not SW-cached).
 * Call after the timer has been enhanced; pass onReveal to start the digit dance
 * as the overlay begins to clear.
 * @param {HTMLElement} [app]
 * @param {{ onReveal?: () => void }} [options]
 * @returns {Promise<void>}
 */
export async function playIntro(
  app = document.querySelector("#app") ?? undefined,
  { onReveal } = {},
) {
  const intro = document.querySelector("#intro");
  if (!(app instanceof HTMLElement)) return;

  // Missing shell, offline, reduced motion, or already done → timer only.
  if (
    !(intro instanceof HTMLElement) ||
    !navigator.onLine ||
    prefersReducedMotion() ||
    document.documentElement.dataset.intro === "done"
  ) {
    revealApp(onReveal, intro instanceof HTMLElement ? intro : undefined);
    return;
  }

  document.documentElement.setAttribute("inert", "");

  const panels = [...intro.querySelectorAll(".intro-panel")];

  if (!panels.length) {
    revealApp(onReveal, intro);
    return;
  }

  /** @type {typeof import('lottie-web/build/player/lottie_light.js').default} */
  let lottie;
  try {
    lottie = (await import("lottie-web/build/player/lottie_light.js")).default;
  } catch {
    // Lottie didn't load: show the still logotype, then clip the overlay away.
    const logo = intro.querySelector(".intro-logotype");
    if (logo instanceof HTMLElement) logo.style.opacity = "1";
    await revealTimer(intro, [], onReveal);
    return;
  }

  /** @type {Promise<void> | null} */
  let logoPromise = null;
  const ensureLogo = () => {
    logoPromise ??= showLogotype(intro);
  };

  // All panels play in parallel; logo starts LOGO_LEAD_MS before the last finishes.
  const lastPanel = panels.at(-1);
  const players = await Promise.all(
    panels.map((panel) =>
      playAnimation(panel, lottie, panel === lastPanel ? ensureLogo : undefined),
    ),
  );

  ensureLogo();
  await logoPromise;
  await revealTimer(intro, players, onReveal);
}
