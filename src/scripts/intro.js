const HOLD_MS = 2000;
const LOGO_HOLD_MS = 800;
const LOGO_LEAD_MS = 630;
const LOTTIE_TIMEOUT_MS = 8000;
const LOGO_ENTRY_SPRING = { type: "spring", bounce: 0.6, visualDuration: 0.1 };
const FIGURE_OUT = { duration: 0.1 };
const FIGURE_IN_SPRING = { type: "spring", bounce: 0.6, visualDuration: 0.15 };
const FIGURE_SCALE = 1.1;
const FIGURE_OFFSET_RATIO = 0.03;
const FIGURE_ROTATE = 3;

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
      // Lottie SVG renderer clips every composition to its w×h via clip-path.
      // Jump-rope (and similar) arcs draw past that box — drop the clip so they can.
      const svg = lottieRoot.querySelector("svg");
      if (svg instanceof SVGElement) {
        svg.setAttribute("overflow", "visible");
        const clipped = svg.querySelector(":scope > g[clip-path]");
        clipped?.removeAttribute("clip-path");
      }

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
  const figures = [...intro.querySelectorAll(".intro-figure")].filter(
    (el) => el instanceof HTMLElement,
  );
  logo.style.opacity = "1";

  const offsets = computeFigureOffsets(figures, logo);

  await animate([
    ...(mark instanceof HTMLElement
      ? [[mark, { scale: [1.4, 1], rotate: [0, -5] }, LOGO_ENTRY_SPRING]]
      : []),
    ...buildOffsetSegments(offsets, "out"),
    ...buildOffsetSegments(offsets, "in"),
  ]).finished;

  await sleep(LOGO_HOLD_MS);
}

/**
 * Figures offset away from the logo, toward whichever corner they're
 * already closest to, then spring back into place. Rotation tips from
 * the bottom-inner corner so top and bottom figures lean the same way.
 * @param {HTMLElement[]} figures
 * @param {HTMLElement} logo
 */
function computeFigureOffsets(figures, logo) {
  const { x: logoCx, y: logoCy } = rectCenter(logo.getBoundingClientRect());

  return figures.map((figure) => {
    const rect = figure.getBoundingClientRect();
    const { x: fx, y: fy } = rectCenter(rect);
    const toLeft = fx < logoCx;
    const toTop = fy < logoCy;
    const offset = Math.round(Math.min(rect.width, rect.height) * FIGURE_OFFSET_RATIO);

    // Plant on the bottom-inner corner so every figure tips from its feet.
    figure.style.transformOrigin = `${toLeft ? "100%" : "0%"} 100%`;

    // Tip outward: left figures lean left (−), right lean right (+).
    const rotate = toLeft ? -FIGURE_ROTATE : FIGURE_ROTATE;

    return {
      figure,
      x: toLeft ? -offset : offset,
      y: toTop ? -offset : offset,
      scale: FIGURE_SCALE,
      rotate,
    };
  });
}

/** @param {DOMRect} rect */
function rectCenter(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * "out" offsets figures away first; "in" springs them back.
 * First "out" starts just after the logo (`<0.01`); first "in" waits for
 * "out" to finish (no `at`). Remaining segments in each phase use `<`.
 * @param {Array<{ figure: HTMLElement, x: number, y: number, scale: number, rotate: number }>} offsets
 * @param {"out" | "in"} direction
 */
function buildOffsetSegments(offsets, direction) {
  const isOut = direction === "out";
  const transition = isOut ? FIGURE_OUT : FIGURE_IN_SPRING;

  return offsets.map(({ figure, x, y, scale, rotate }, i) => {
    const rest = { scale, x, y, rotate };
    const home = { scale: 1, x: 0, y: 0, rotate: 0 };
    const from = isOut ? home : rest;
    const to = isOut ? rest : home;

    const options = { ...transition };
    if (i > 0) options.at = "<";
    else if (isOut) options.at = "<0.01";

    return [
      figure,
      {
        scale: [from.scale, to.scale],
        x: [from.x, to.x],
        y: [from.y, to.y],
        rotate: [from.rotate, to.rotate],
      },
      options,
    ];
  });
}

/**
 * Clip the white overlay away bottom→top; kick off the digit dance as it clears.
 * @param {HTMLElement} intro
 * @param {HTMLElement} app
 * @param {Array<{ destroy: () => void }>} [players]
 * @param {(() => void) | undefined} [onReveal]
 */
async function clipOutToTimer(intro, app, players = [], onReveal) {
  const { animate } = await import("motion");

  intro.classList.add("is-exiting");
  onReveal?.();
  finishIntro();
  app.removeAttribute("inert");
  app.removeAttribute("aria-hidden");

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
    await clipOutToTimer(intro, app, [], onReveal);
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
  await clipOutToTimer(intro, app, players, onReveal);
}
