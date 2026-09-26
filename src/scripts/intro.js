const LOGO_HOLD_MS = 800;
const LOGO_LEAD_MS = 600;
const LOTTIE_TIMEOUT_MS = 8000;
const POSTER_FPS = 12;
const LOGO_ENTRY = 0.42;
const FIGURE_OUT = 0.1;
const FIGURE_IN = 0.3;
const FIGURE_JUMP = 1.1;

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
 * @param {HTMLElement} app
 * @param {(() => void) | undefined} onReveal
 */
function unlockApp(app, onReveal) {
  onReveal?.();
  app.removeAttribute("inert");
  app.removeAttribute("aria-hidden");
}

/**
 * Reveal the timer; remove the intro shell when present.
 * @param {HTMLElement} app
 * @param {(() => void) | undefined} onReveal
 * @param {HTMLElement} [intro]
 */
function revealApp(app, onReveal, intro) {
  unlockApp(app, onReveal);
  intro?.remove();
  finishIntro();
}

/**
 * Play a panel's Lottie once. Optional onNearEnd fires once, LOGO_LEAD_MS
 * before complete (scheduled from duration on DOMLoaded). The poster image
 * stays until DOMLoaded, then the Lottie SVG in the panel replaces it.
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

  return new Promise((resolve) => {
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

    let settled = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let leadId;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.clearTimeout(leadId);
      anim.removeEventListener("complete", finish);
      anim.removeEventListener("data_failed", finish);
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

    const timeoutId = window.setTimeout(finish, LOTTIE_TIMEOUT_MS);

    anim.addEventListener("complete", finish);
    anim.addEventListener("data_failed", finish);
    // SVG is appended during config, before the next paint. Hide it so the
    // poster stays until DOMLoaded swaps it in.
    anim.addEventListener("config_ready", () => {
      panel.querySelector(":scope > svg")?.setAttribute("hidden", "");
    });
    anim.addEventListener("DOMLoaded", () => {
      if (settled) return;
      const svg = panel.querySelector(":scope > svg");
      panel.querySelector(":scope > img")?.remove();
      svg?.removeAttribute("hidden");
      anim.setSubframe(false);
      anim.play();
      if (onNearEnd) {
        const durationMs = (anim.totalFrames / anim.frameRate) * 1000;
        leadId = window.setTimeout(onNearEnd, Math.max(0, durationMs - LOGO_LEAD_MS));
      }
    });
  });
}

/**
 * @param {number} t progress in 0..1
 */
function linear(t) {
  return t;
}

/**
 * Penner ease-out elastic. Overshoots, then settles.
 * @param {number} t progress in 0..1
 */
function elasticOut(t) {
  if (t === 0 || t === 1) return t;
  const period = 0.3;
  return Math.pow(2, -10 * t) * Math.sin(((t - period / 4) * (2 * Math.PI)) / period) + 1;
}

/**
 * Sample an ease on the same 12fps grid as the Lottie clips.
 * @param {number} duration seconds
 * @param {(t: number) => number} ease
 */
function posterized(duration, ease) {
  const totalFrames = Math.max(1, Math.round(POSTER_FPS * duration));
  return {
    duration,
    ease: (/** @type {number} */ t) => {
      const steppedTime = Math.round(t * totalFrames) / totalFrames;
      return ease(steppedTime);
    },
  };
}

/**
 * Slam the logotype in over the characters, then hold.
 * Elastic tweens step at 12fps so the slam matches the Lottie clips.
 * @param {HTMLElement} intro
 * @param {typeof import('motion').animate} animate
 */
async function showLogotype(intro, animate) {
  const logo = intro.querySelector(".intro-logotype");
  if (!(logo instanceof HTMLElement)) return;

  const figures = intro.querySelectorAll(".intro-panel");
  logo.style.opacity = "1";

  // Figures pop with the logo, then spring back after that pop finishes.
  await animate([
    [logo, { scale: [1.4, 1], rotate: [0, -5] }, posterized(LOGO_ENTRY, elasticOut)],
    [figures, { scale: [1, FIGURE_JUMP] }, { ...posterized(FIGURE_OUT, linear), at: "<0.01" }],
    [figures, { scale: [FIGURE_JUMP, 1] }, posterized(FIGURE_IN, elasticOut)],
  ]).finished;

  await hold(LOGO_HOLD_MS);
}

/**
 * Clip the white overlay away bottom→top; kick off the digit dance as it clears.
 * @param {HTMLElement} intro
 * @param {HTMLElement} app
 * @param {Array<{ destroy: () => void }>} [players]
 * @param {(() => void) | undefined} [onReveal]
 */
async function revealTimer(intro, app, players = [], onReveal) {
  const { animate } = await import("motion");

  intro.classList.add("is-exiting");
  unlockApp(app, onReveal);
  finishIntro();

  await animate(
    intro,
    {
      clipPath: ["inset(0% 0% 0% 0%)", "inset(0% 0% 100% 0%)"],
      y: [0, -5],
    },
    {
      duration: 0.3,
      ease: [0.4, 0, 0.2, 1],
    },
  ).finished;

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
    revealApp(app, onReveal, intro instanceof HTMLElement ? intro : undefined);
    return;
  }

  app.setAttribute("inert", "");
  app.setAttribute("aria-hidden", "true");
  document.documentElement.dataset.intro = "pending";

  const panels = [...intro.querySelectorAll(".intro-panel")];

  if (!panels.length) {
    revealApp(app, onReveal, intro);
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
    await revealTimer(intro, app, [], onReveal);
    return;
  }

  // Preload Motion while Lotties play so the logo slam has no import lag.
  const motionReady = import("motion");

  /** @type {Promise<void> | null} */
  let logoPromise = null;
  const ensureLogo = () => {
    logoPromise ??= motionReady.then(({ animate }) => showLogotype(intro, animate));
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
  await revealTimer(intro, app, players, onReveal);
}
