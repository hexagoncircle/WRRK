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
function hold(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Resolves after the next frame has been painted (static intro SVGs first). */
function afterNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
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
 * Fetch a Lottie JSON; null on any failure (panel keeps its static SVG).
 * @param {string} src
 * @returns {Promise<object | null>}
 */
async function fetchAnimationData(src) {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Play a panel's Lottie once. Optional onNearEnd fires once, LOGO_LEAD_MS
 * before complete (scheduled from duration on DOMLoaded).
 * @param {HTMLElement} panel
 * @param {typeof import('lottie-web/build/player/lottie_light.js').default} lottie
 * @param {object | null | undefined} animationData
 * @param {(() => void) | undefined} [onNearEnd]
 * @returns {Promise<{ destroy: () => void }>}
 */
function playAnimation(panel, lottie, animationData, onNearEnd) {
  if (!animationData) {
    onNearEnd?.();
    return Promise.resolve({ destroy: () => {} });
  }

  const animRoot = document.createElement("div");
  animRoot.hidden = true;
  panel.append(animRoot);

  return new Promise((resolve) => {
    const anim = lottie.loadAnimation({
      container: animRoot,
      renderer: "svg",
      loop: false,
      autoplay: false,
      animationData,
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
    anim.addEventListener("DOMLoaded", () => {
      if (settled) return;
      animRoot.hidden = false;
      panel.replaceChildren(animRoot);
      anim.play();
      if (onNearEnd) {
        const durationMs = (anim.totalFrames / anim.frameRate) * 1000;
        leadId = window.setTimeout(onNearEnd, Math.max(0, durationMs - LOGO_LEAD_MS));
      }
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
  const figures = [...intro.querySelectorAll(".intro-panel")].filter(
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

  await hold(LOGO_HOLD_MS);
}

/**
 * Figures offset away from the logo, toward whichever corner they're
 * already closest to, then spring back into place. Rotation tips from
 * the bottom-inner corner so top and bottom figures lean the same way.
 * @param {HTMLElement[]} figures
 * @param {HTMLElement} logo
 */
function computeFigureOffsets(figures, logo) {
  const { x: logoCx, y: logoCy } = rectCenter(logo);

  return figures.map((figure) => {
    const rect = figure.getBoundingClientRect();
    const fx = rect.left + rect.width / 2;
    const fy = rect.top + rect.height / 2;
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

/** @param {HTMLElement} el */
function rectCenter(el) {
  const rect = el.getBoundingClientRect();
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
  const introEl = intro instanceof HTMLElement ? intro : undefined;
  if (!(app instanceof HTMLElement)) return;

  // Missing shell, offline, reduced motion, or already done → timer only.
  if (
    !introEl ||
    !navigator.onLine ||
    prefersReducedMotion() ||
    document.documentElement.dataset.intro === "done"
  ) {
    revealApp(app, onReveal, introEl);
    return;
  }

  app.setAttribute("inert", "");
  app.setAttribute("aria-hidden", "true");
  document.documentElement.dataset.intro = "pending";

  const panels = [...introEl.querySelectorAll(".intro-panel")].filter(
    (el) => el instanceof HTMLElement,
  );
  if (!panels.length) {
    revealApp(app, onReveal, introEl);
    return;
  }

  // Let static SVG stills paint before downloading/parsing Lottie + JSON.
  await afterNextPaint();

  // Load player + JSON in parallel so Lottie does not gate the animation fetches.
  /** @type {typeof import('lottie-web/build/player/lottie_light.js').default} */
  let lottie;
  /** @type {(object | null)[]} */
  let animationDatas;
  try {
    const [lottieMod, ...datas] = await Promise.all([
      import("lottie-web/build/player/lottie_light.js"),
      ...panels.map((panel) => {
        const src = panel.dataset.src;
        return src ? fetchAnimationData(src) : Promise.resolve(null);
      }),
    ]);
    lottie = lottieMod.default;
    animationDatas = datas;
  } catch {
    // Still SVGs are already in the template; hold then logo + clip without Lottie.
    await hold(Math.max(0, HOLD_MS - LOGO_LEAD_MS));
    const { animate } = await import("motion");
    await showLogotype(introEl, animate);
    await revealTimer(introEl, app, [], onReveal);
    return;
  }

  // Preload Motion while Lotties play so the logo slam has no import lag.
  const motionReady = import("motion");

  /** @type {Promise<void> | null} */
  let logoPromise = null;
  const ensureLogo = () => {
    logoPromise ??= motionReady.then(({ animate }) => showLogotype(introEl, animate));
  };

  // All panels play in parallel; logo starts LOGO_LEAD_MS before the last finishes.
  const lastPanel = panels.at(-1);
  const players = await Promise.all(
    panels.map((panel, i) =>
      playAnimation(
        panel,
        lottie,
        animationDatas[i],
        panel === lastPanel ? ensureLogo : undefined,
      ),
    ),
  );

  ensureLogo();
  await logoPromise;
  await revealTimer(introEl, app, players, onReveal);
}
