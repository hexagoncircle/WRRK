/** @type {typeof import("lottie-web/build/player/lottie_light.js").default | undefined} */
let lottie;

/**
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function introRoot() {
  const intro = document.getElementById("intro");
  return intro instanceof HTMLElement ? intro : undefined;
}

function introDone() {
  return !introRoot()?.hasAttribute("data-status");
}

/**
 * Reveal the timer with no curtain (skip path).
 * @param {(() => void) | undefined} onReveal
 * @param {HTMLElement} [intro]
 */
function revealApp(onReveal, intro) {
  onReveal?.();
  dismissIntro(intro);
}

/**
 * @param {HTMLElement} [intro]
 */
function dismissIntro(intro) {
  document.documentElement.removeAttribute("inert");
  if (!intro) return;
  delete intro.dataset.status;
  intro.remove();
}

/** Past the 2.4s delay + 0.4s wipe, so a missed animation event still unlocks the page. */
const INTRO_FALLBACK_MS = 4000;

/**
 * Child animations bubble to `#intro`. Wait until this element's own animation fires.
 * @param {HTMLElement} intro
 * @param {"animationstart" | "animationend"} eventName
 * @returns {Promise<void>}
 */
function whenIntroAnimation(intro, eventName) {
  return new Promise((resolve) => {
    let settled = false;
    /** @param {AnimationEvent} event */
    const handler = (event) => {
      if (event.target !== intro) return;
      finish();
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      intro.removeEventListener(eventName, handler);
      resolve();
    };
    const timer = window.setTimeout(finish, INTRO_FALLBACK_MS);
    intro.addEventListener(eventName, handler);
  });
}

/**
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
 * @typedef {{
 *   isLoaded?: boolean,
 *   destroy: () => void,
 *   play: () => void,
 *   setSubframe: (flag: boolean) => void,
 *   addEventListener: Function,
 *   removeEventListener: Function,
 * }} LottieAnim
 */

/**
 * DOMLoaded is scheduled with setTimeout(0) after isLoaded flips, so a
 * listener added in the same turn still hears it. If it already flipped
 * and the event was missed, isLoaded is enough.
 * @param {LottieAnim} anim
 * @returns {Promise<void>}
 */
function whenDomLoaded(anim) {
  if (anim.isLoaded) return Promise.resolve();
  return Promise.race([once(anim, "DOMLoaded"), once(anim, "data_failed"), once(anim, "error")]);
}

/**
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
function whenAborted(signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * @returns {Promise<void>}
 */
async function loadLottie() {
  if (lottie) return;
  try {
    lottie = (await import("lottie-web/build/player/lottie_light.js")).default;
  } catch {
    // The sequence still runs on the posters.
  }
}

/**
 * @param {LottieAnim[]} anims
 */
function destroyAnims(anims) {
  for (const anim of anims) {
    try {
      anim.destroy();
    } catch {
      // Already torn down.
    }
  }
}

/**
 * Build whatever clips arrive before `signal` aborts. A clip that made it
 * in is played in full; the budget only limits the fetch, not playback.
 * @param {HTMLElement[]} panels
 * @param {AbortSignal} signal
 * @returns {Promise<LottieAnim[]>}
 */
async function loadClips(panels, signal) {
  if (!panels.length) return [];

  /** @type {Promise<{ panel: HTMLElement, data: unknown } | null>[]} */
  const clipPromises = panels.map(async (panel) => {
    try {
      const res = await fetch(panel.dataset.src ?? "", { signal });
      if (!res.ok) return null;
      return { panel, data: await res.json() };
    } catch {
      return null;
    }
  });

  await Promise.race([Promise.all([loadLottie(), ...clipPromises]), whenAborted(signal)]);

  const loaded = (await Promise.all(clipPromises)).filter((clip) => clip !== null);
  if (!loaded.length || !lottie || introDone()) return [];

  const player = lottie;
  const built = loaded.map(({ panel, data }) => ({
    panel,
    anim: player.loadAnimation({
      container: panel,
      renderer: "svg",
      loop: false,
      autoplay: false,
      animationData: data,
      rendererSettings: {
        progressiveLoad: true,
        hideOnTransparent: true,
      },
    }),
  }));

  await Promise.race([
    Promise.all(built.map(({ anim }) => whenDomLoaded(anim))),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
  if (introDone()) {
    destroyAnims(built.map(({ anim }) => anim));
    return [];
  }

  /** @type {LottieAnim[]} */
  const playable = [];
  for (const { panel, anim } of built) {
    if (anim.isLoaded) {
      panel.dataset.ready = "";
      playable.push(anim);
    } else {
      try {
        anim.destroy();
      } catch {
        // Already torn down.
      }
    }
  }
  return playable;
}

/**
 * @param {LottieAnim[]} anims
 */
function playClips(anims) {
  for (const anim of anims) {
    anim.setSubframe(false);
    anim.play();
  }
}

/** Settled lockup stays up this long from first paint, then the curtain cuts away. */
const STATIC_HOLD_MS = 2000;

/**
 * Characters are already painted. The logotype fades in after 0.5s.
 * The curtain cuts away at 2s. Never fetches Lottie.
 * @param {HTMLElement} intro
 * @param {(() => void) | undefined} onReveal
 */
async function playStaticIntro(intro, onReveal) {
  const shownAt = Number(intro.dataset.shownAt);
  const elapsed = Number.isFinite(shownAt) ? Date.now() - shownAt : 0;
  const hold = Math.max(0, STATIC_HOLD_MS - elapsed);
  if (hold > 0) await new Promise((resolve) => window.setTimeout(resolve, hold));
  if (introDone()) {
    revealApp(onReveal, intro);
    return;
  }

  onReveal?.();
  dismissIntro(intro);
}

/**
 * The brand intro paints posters immediately. Clips have 2000ms to
 * arrive; then `data-status="playing"` starts the CSS sequence (slam, jump, wipe) and
 * any built clip plays from that same moment. A 2s clip finishes before the
 * wipe at 2.4s. Offline skips straight to the timer. Reduced motion shows the
 * characters, fades the logotype in after 0.5s, then cuts to the timer, and
 * does not fetch clips.
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

  if (!(intro instanceof HTMLElement) || !navigator.onLine || introDone()) {
    revealApp(onReveal, intro instanceof HTMLElement ? intro : undefined);
    return;
  }

  if (prefersReducedMotion()) {
    await playStaticIntro(intro, onReveal);
    return;
  }

  /** @type {HTMLElement[]} */
  const panels = [...intro.querySelectorAll(".intro-panel")].filter(
    (panel) => panel instanceof HTMLElement,
  );
  const anims = await loadClips(panels, AbortSignal.timeout(2000));

  if (introDone()) {
    destroyAnims(anims);
    revealApp(onReveal, intro);
    return;
  }

  const wipeStarted = whenIntroAnimation(intro, "animationstart");
  const wipeEnded = whenIntroAnimation(intro, "animationend");
  intro.dataset.status = "playing";
  playClips(anims);

  await wipeStarted;
  onReveal?.();

  await wipeEnded;
  destroyAnims(anims);
  dismissIntro(intro);
}
