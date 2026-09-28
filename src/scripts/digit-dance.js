const FRAME_S = 0.032;

/**
 * Lit segments in the order they settle. The index is `--settle` on that path.
 * @type {Record<string, string[]>}
 */
const SETTLE_ORDER = {
  0: ["top", "top-right", "top-left", "bottom-right", "bottom-left", "bottom"],
  1: ["top-right", "bottom-right"],
  2: ["top", "top-right", "middle", "bottom-left", "bottom"],
  3: ["top", "top-right", "middle", "bottom-right", "bottom"],
  4: ["top-left", "top-right", "middle", "bottom-right"],
  5: ["top", "top-left", "middle", "bottom-right", "bottom"],
  6: ["top", "top-left", "middle", "bottom-left", "bottom", "bottom-right"],
  7: ["top", "top-right", "bottom-right"],
  8: ["top", "top-right", "top-left", "middle", "bottom-right", "bottom-left", "bottom"],
  9: ["top", "top-right", "top-left", "middle", "bottom-right"],
};

let seq = 0;

/**
 * @param {Element} digit
 */
function clearSettle(digit) {
  for (const path of digit.querySelectorAll("path")) {
    path.style.removeProperty("--settle");
  }
}

/**
 * Freeze the stagger once. Later glyph snaps change `data-digit` only,
 * so this order does not restart the settle animation.
 * @param {Element} digit
 * @param {string} glyph
 */
function freezeSettle(digit, glyph) {
  const order = SETTLE_ORDER[glyph];
  if (!order) return;
  for (let index = 0; index < order.length; index++) {
    const path = digit.querySelector(`.${order[index]}`);
    if (!(path instanceof Element)) continue;
    path.style.setProperty("--settle", String(index));
  }
}

/**
 * @param {HTMLElement} root
 */
function flush(root) {
  void root.offsetWidth;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * @param {HTMLElement} root
 */
function clearDance(root) {
  delete root.dataset.dance;
  delete root.dataset.countdown;
  root.style.removeProperty("--beat");
  root.style.removeProperty("--prep-beats");
  root.style.removeProperty("--count");
  for (const digit of root.querySelectorAll(".digit")) {
    digit.style.removeProperty("--chase-beats");
    clearSettle(digit);
  }
}

/**
 * Drop the previous run, then flush so the next attribute write is a real restart.
 * @param {HTMLElement} root
 */
function begin(root) {
  clearDance(root);
  flush(root);
  return String(++seq);
}

/**
 * @param {Animation} anim
 * @returns {anim is CSSAnimation}
 */
function isElementAnimation(anim) {
  if (!(anim instanceof CSSAnimation)) return false;
  if (anim.animationName === "pulse") return false;
  const effect = anim.effect;
  if (!(effect instanceof KeyframeEffect) || effect.pseudoElement) return false;
  return effect.target instanceof Element;
}

/**
 * Digit-path animations plus the beat clock on the root.
 * Separator transitions and the global pause pulse stay out.
 * @param {HTMLElement} root
 * @returns {CSSAnimation[]}
 */
function danceAnimations(root) {
  /** @type {CSSAnimation[]} */
  const list = [];
  for (const anim of root.getAnimations({ subtree: true })) {
    if (!isElementAnimation(anim)) continue;
    const target = /** @type {KeyframeEffect} */ (anim.effect).target;
    if (!(target instanceof Element)) continue;
    const onPath = target.localName === "path" && Boolean(target.closest(".digit"));
    if (target === root || onPath) list.push(anim);
  }
  return list;
}

/**
 * @param {CSSAnimation[]} anims
 */
function elapsedSeconds(anims) {
  let max = 0;
  for (const anim of anims) {
    const time = anim.currentTime;
    if (typeof time === "number" && time > max) max = time;
  }
  return max / 1000;
}

/**
 * @param {HTMLElement} root
 * @param {string} id
 * @param {CSSAnimation[]} anims
 * @param {() => void} [onDone]
 */
function watchFinished(root, id, anims, onDone) {
  const finished = Promise.all(anims.map((anim) => anim.finished));
  finished.catch(() => {});
  if (anims.length === 0) return finished;
  Promise.allSettled(anims.map((anim) => anim.finished)).then(() => {
    onDone?.();
    if (root.dataset.dance === id) clearDance(root);
  });
  return finished;
}

/**
 * @param {CSSAnimation[]} anims
 * @param {Promise<unknown>} finished
 * @param {() => void} stop
 * @param {(seconds: number) => void} [onSeek]
 */
function controls(anims, finished, stop, onSeek) {
  return {
    finished,
    pause() {
      for (const anim of anims) anim.pause();
    },
    play() {
      for (const anim of anims) anim.play();
    },
    stop,
    get time() {
      return elapsedSeconds(anims);
    },
    set time(seconds) {
      const next = Math.max(0, seconds);
      const ms = next * 1000;
      for (const anim of anims) anim.currentTime = ms;
      onSeek?.(next);
    },
  };
}

/**
 * @param {HTMLElement} root
 */
export function cancelDigitDance(root) {
  if (!(root instanceof HTMLElement)) return;
  clearDance(root);
}

/**
 * Figure-8 chase, then settle into each digit's glyph.
 * Reduced motion leaves the glyphs as they are.
 * @param {HTMLElement} root element that contains the `.digit` SVGs
 */
export function playDigitDance(root) {
  if (!(root instanceof HTMLElement) || prefersReducedMotion()) return null;
  const digits = [...root.querySelectorAll(".digit")];
  if (digits.length === 0) return null;

  const id = begin(root);
  for (const digit of digits) {
    const value = digit.dataset.digit;
    if (value) freezeSettle(digit, value);
  }
  root.dataset.dance = id;
  flush(root);

  const anims = danceAnimations(root);
  const stop = () => {
    if (root.dataset.dance === id) clearDance(root);
  };
  const finished = watchFinished(root, id, anims);
  return controls(anims, finished, stop);
}

/**
 * @param {number} t
 * @param {number} prep
 * @param {number} beat
 * @param {number} count
 * @param {boolean} reduced
 */
function digitForTime(t, prep, beat, count, reduced) {
  if (t < prep) return reduced ? "" : String(count);
  const beatIndex = Math.min(count - 1, Math.floor((t - prep) / beat));
  return String(count - beatIndex);
}

/**
 * Live beat events land on prep + k*beat. A seek can dispatch the same event
 * with currentTime already past that boundary.
 * @param {number} t
 * @param {number} prep
 * @param {number} beat
 * @param {number} count
 * @returns {number | null}
 */
function boundaryIndex(t, prep, beat, count) {
  const k = Math.round((t - prep) / beat);
  const expected = prep + k * beat;
  if (Math.abs(t - expected) > FRAME_S) return null;
  if (k < 0 || k >= count) return null;
  return k;
}

/**
 * Prep chase in lockstep. The last digit settles into `count` on the first beat.
 * Later beats snap that glyph. Reduced motion skips the chase.
 * @param {HTMLElement} root
 * @param {{ count?: number, beatSeconds?: number, prepSeconds?: number, onBeat?: (n: number) => void }} [options]
 */
export function playCountdown(
  root,
  { count = 3, beatSeconds = 1, prepSeconds = 0, onBeat } = {},
) {
  if (!(root instanceof HTMLElement)) return null;
  const digits = [...root.querySelectorAll(".digit")];
  if (digits.length === 0) return null;

  const countdownDigit = digits[digits.length - 1];
  if (!(countdownDigit instanceof Element)) return null;

  const reduced = prefersReducedMotion();
  const prepBeats = prepSeconds / beatSeconds;
  const id = begin(root);
  for (const digit of digits) {
    if (digit !== countdownDigit) digit.dataset.digit = "";
    const chaseBeats = digit === countdownDigit ? prepBeats : prepBeats + count;
    digit.style.setProperty("--chase-beats", String(chaseBeats));
  }
  freezeSettle(countdownDigit, String(count));
  countdownDigit.dataset.digit = digitForTime(0, prepSeconds, beatSeconds, count, reduced);

  root.style.setProperty("--beat", `${beatSeconds}s`);
  root.style.setProperty("--prep-beats", String(prepBeats));
  root.style.setProperty("--count", String(count));
  root.dataset.countdown = "";
  root.dataset.dance = id;
  flush(root);

  const anims = danceAnimations(root);
  const clock = anims.find((anim) => anim.effect?.target === root);
  const clockName = clock?.animationName ?? "";

  /** @param {AnimationEvent} event */
  const onClock = (event) => {
    if (event.target !== root || event.animationName !== clockName) return;
    if (root.dataset.dance !== id || !clock) return;
    const time = clock.currentTime;
    if (typeof time !== "number") return;
    const k = boundaryIndex(time / 1000, prepSeconds, beatSeconds, count);
    if (k == null) return;
    const n = count - k;
    countdownDigit.dataset.digit = String(n);
    onBeat?.(n);
  };

  root.addEventListener("animationstart", onClock);
  root.addEventListener("animationiteration", onClock);

  const detach = () => {
    root.removeEventListener("animationstart", onClock);
    root.removeEventListener("animationiteration", onClock);
  };
  const stop = () => {
    detach();
    if (root.dataset.dance === id) clearDance(root);
  };
  const finished = watchFinished(root, id, anims, detach);

  return controls(anims, finished, stop, (t) => {
    countdownDigit.dataset.digit = digitForTime(t, prepSeconds, beatSeconds, count, reduced);
  });
}
