const HOLD_MS = 2000;
const LOGO_HOLD_MS = 800;
const LOGO_LEAD_MS = 600;
const LOTTIE_TIMEOUT_MS = 8000;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
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
 * @param {HTMLElement} intro
 * @param {HTMLElement} app
 * @param {(() => void) | undefined} onReveal
 */
function revealImmediate(intro, app, onReveal) {
  onReveal?.();
  app.removeAttribute("inert");
  app.removeAttribute("aria-hidden");
  intro.remove();
  finishIntro();
}

/**
 * Play a panel's Lottie once. Optional onNearEnd fires LOGO_LEAD_MS before complete
 * (and again-safe on finish) so the logotype can lead the last character.
 * @param {HTMLElement} panel
 * @param {typeof import('lottie-web/build/player/lottie_light.js').default} lottie
 * @param {(() => void) | undefined} [onNearEnd]
 * @returns {Promise<{ destroy: () => void }>}
 */
function playAnimation(panel, lottie, onNearEnd) {
  const src = panel.dataset.src;
  const figure = panel.querySelector(".intro-figure");
  if (!src || !(figure instanceof HTMLElement)) {
    onNearEnd?.();
    return Promise.resolve({ destroy: () => {} });
  }

  // Layer Lottie over the still SVG; reveal only after the first frame is ready.
  const lottieRoot = document.createElement("div");
  lottieRoot.className = "intro-lottie";
  figure.append(lottieRoot);

  return new Promise((resolve) => {
    const anim = lottie.loadAnimation({
      container: lottieRoot,
      renderer: "svg",
      loop: false,
      autoplay: false,
      path: src,
      rendererSettings: {
        progressiveLoad: true,
        hideOnTransparent: true,
      },
    });

    let settled = false;
    let nearEndFired = false;

    const fireNearEnd = () => {
      if (nearEndFired || !onNearEnd) return;
      nearEndFired = true;
      onNearEnd();
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      anim.removeEventListener("complete", finish);
      anim.removeEventListener("data_failed", finish);
      if (onNearEnd) anim.removeEventListener("enterFrame", onFrame);
      fireNearEnd();
      resolve({
        destroy: () => {
          try {
            anim.destroy();
          } catch {
            // Already torn down.
          }
        },
      });
    };

    const onFrame = () => {
      const remainingMs = ((anim.totalFrames - anim.currentFrame) / anim.frameRate) * 1000;
      if (remainingMs <= LOGO_LEAD_MS) fireNearEnd();
    };

    const timeoutId = window.setTimeout(finish, LOTTIE_TIMEOUT_MS);

    anim.addEventListener("complete", finish);
    anim.addEventListener("data_failed", finish);
    if (onNearEnd) anim.addEventListener("enterFrame", onFrame);
    anim.addEventListener("DOMLoaded", () => {
      // Swap still SVG for the animated one so they never stack/duplicate.
      figure.querySelectorAll("img").forEach((img) => img.remove());
      lottieRoot.classList.add("is-ready");
      anim.play();
    });
  });
}

/**
 * Slam the logotype in over the characters, then hold.
 * @param {HTMLElement} intro
 * @param {typeof import('motion').animate} animate
 */
async function showLogotype(intro, animate) {
  const logo = intro.querySelector(".intro-logotype");
  if (!(logo instanceof HTMLElement)) return;

  const mark = logo.querySelector("img");
  logo.style.opacity = "1";

  if (mark instanceof HTMLElement) {
    await animate(mark, { scale: [1.2, 1] }, { type: "spring", bounce: 0.5, visualDuration: 0.1 })
      .finished;
  }

  await sleep(LOGO_HOLD_MS);
}

/**
 * Slide the white overlay up like a curtain; kick off the digit dance as it clears.
 * @param {HTMLElement} intro
 * @param {HTMLElement} app
 * @param {Array<{ destroy: () => void }>} [players]
 * @param {(() => void) | undefined} [onReveal]
 */
async function slideOutToTimer(intro, app, players = [], onReveal) {
  const { animate } = await import("motion");

  intro.classList.add("is-exiting");
  onReveal?.();
  finishIntro();
  app.removeAttribute("inert");
  app.removeAttribute("aria-hidden");

  await animate(
    intro,
    { y: ["0%", "-100%"] },
    {
      duration: 0.2,
      ease: [0.4, 0, 0.2, 1],
    },
  ).finished;

  for (const player of players) player.destroy();
  intro.remove();
}

/**
 * Runs the brand intro when online, then slides up to reveal the timer.
 * Offline skips straight to the timer (intro assets are not SW-cached).
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
  if (!(intro instanceof HTMLElement) || !(app instanceof HTMLElement)) return;

  // Offline = timer only; intro media is not service-worker cached.
  if (!navigator.onLine) {
    revealImmediate(intro, app, onReveal);
    return;
  }

  app.setAttribute("inert", "");
  app.setAttribute("aria-hidden", "true");
  document.documentElement.dataset.intro = "pending";

  const panels = [...intro.querySelectorAll(".intro-panel")].filter(
    (el) => el instanceof HTMLElement,
  );
  if (!panels.length) {
    revealImmediate(intro, app, onReveal);
    return;
  }

  // Still SVGs are in the template; show each panel (also the reduced-motion graphic).
  if (prefersReducedMotion()) {
    for (const panel of panels) panel.classList.add("is-shown");
    await sleep(Math.max(0, HOLD_MS - LOGO_LEAD_MS));
    const logo = intro.querySelector(".intro-logotype");
    if (logo instanceof HTMLElement) logo.style.opacity = "1";
    await sleep(LOGO_HOLD_MS);
    revealImmediate(intro, app, onReveal);
    return;
  }

  let lottie;
  try {
    const lottieMod = await import("lottie-web/build/player/lottie_light.js");
    lottie = lottieMod.default;
  } catch {
    for (const panel of panels) panel.classList.add("is-shown");
    await sleep(Math.max(0, HOLD_MS - LOGO_LEAD_MS));
    const { animate } = await import("motion");
    await showLogotype(intro, animate);
    await slideOutToTimer(intro, app, [], onReveal);
    return;
  }

  // Preload Motion so the logotype spring can start on the near-end frame with no import lag.
  const { animate } = await import("motion");

  /** @type {Promise<void> | null} */
  let logoPromise = null;
  const ensureLogo = () => {
    logoPromise ??= showLogotype(intro, animate);
  };

  // Reveal panels together; each Lottie starts as soon as its cell is on screen.
  // Logotype starts LOGO_LEAD_MS before the last character finishes.
  /** @type {Array<{ destroy: () => void }>} */
  const lastPanel = panels.at(-1);
  const players = await Promise.all(
    panels.map((panel) => {
      panel.classList.add("is-shown");
      return playAnimation(panel, lottie, panel === lastPanel ? ensureLogo : undefined);
    }),
  );

  ensureLogo();
  await logoPromise;
  await slideOutToTimer(intro, app, players, onReveal);
}
