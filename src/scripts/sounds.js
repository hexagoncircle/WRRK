import { clampNumber } from "./utils.js";
import { RECIPES } from "./sound-recipes.js";

/** @typedef {import('./sound-recipes.js').Shimmer} Shimmer */
/** @typedef {import('./sound-recipes.js').ToneLayer} ToneLayer */
/** @typedef {import('./sound-recipes.js').NoiseLayer} NoiseLayer */
/** @typedef {import('./sound-recipes.js').SoundRecipe} SoundRecipe */

/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {GainNode | null} */
let output = null;
/** True after backgrounding until audio is confirmed running again. */
let needsRevive = false;

const MUTED_STORAGE_KEY = "wrrk:muted";

/** @returns {boolean} */
function loadMutedPreference() {
  try {
    return localStorage.getItem(MUTED_STORAGE_KEY) === "true";
  } catch {
    // Private mode / blocked storage must not break module init.
    return false;
  }
}

/** @param {boolean} value */
function saveMutedPreference(value) {
  try {
    localStorage.setItem(MUTED_STORAGE_KEY, String(value));
  } catch {
    // Best-effort; quota / private mode may reject writes.
  }
}

let muted = loadMutedPreference();

const SOURCE_STOP_PADDING = 0.05;
const CLEANUP_MARGIN = 0.05;
const LOOKAHEAD = 0.02;
const INAUDIBLE_GAIN = 0.001;
const ENVELOPE_FLOOR = 0.0001;
const OUTPUT_GAIN = 20;

const NOTE_OFFSETS = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

import { RECIPES } from "./sound-recipes.js";



/**
 * @param {string} note
 * @returns {number | null}
 */
function noteToHz(note) {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
  if (!match) return null;

  const [, letter, accidental, octaveStr] = match;
  let semitone = NOTE_OFFSETS[letter];
  if (accidental === "#") semitone += 1;
  else if (accidental === "b") semitone -= 1;

  const midi = (Number(octaveStr) + 1) * 12 + semitone;
  return 440 * 2 ** ((midi - 69) / 12);
}

/** @returns {boolean} */
function hasLiveContext() {
  return Boolean(audioCtx && output && audioCtx.state !== "closed");
}

function teardownAudio() {
  const ctx = audioCtx;
  audioCtx = null;
  output = null;
  if (!ctx) return;
  try {
    ctx.close();
  } catch {}
}

function setupAudio() {
  if (hasLiveContext()) return true;

  teardownAudio();

  // Enable sound even if phone's silent switch is on.
  if (navigator.audioSession) {
    try {
      navigator.audioSession.type = "playback";
    } catch {}
  }

  if (typeof AudioContext === "undefined") return false;

  audioCtx = new AudioContext();
  output = audioCtx.createGain();
  output.gain.value = OUTPUT_GAIN;
  output.connect(audioCtx.destination);
  return true;
}

/**
 * iOS PWAs often leave AudioContext suspended/interrupted (or "zombie":
 * state looks fine but rendering is dead). Prefer resume; recreate if needed.
 * @param {{ forceRecreate?: boolean, bounce?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function resumeAudio({ forceRecreate = false, bounce = false } = {}) {
  if (forceRecreate) teardownAudio();
  if (!setupAudio() || !audioCtx) return false;
  if (audioCtx.state === "running" && !bounce) {
    needsRevive = false;
    return true;
  }

  // WebKit bug: after backgrounding, resume() alone can leave a zombie context.
  // suspend() first forces a clean internal reset before resume.
  try {
    await audioCtx.suspend();
    await audioCtx.resume();
  } catch {}

  if (audioCtx.state === "running") {
    needsRevive = false;
    return true;
  }

  // Closed or still unusable — rebuild the graph once.
  if (!forceRecreate) return resumeAudio({ forceRecreate: true });
  return false;
}

function onAppForeground() {
  if (!audioCtx) return;
  needsRevive = true;
  // Always bounce through suspend→resume on return; iOS can report "running"
  // while the context is actually dead after app switching.
  void resumeAudio({ bounce: true });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    needsRevive = true;
    return;
  }
  onAppForeground();
});

// BFCache / PWA restore paths where visibilitychange alone is not enough.
window.addEventListener("pageshow", onAppForeground);
window.addEventListener("focus", onAppForeground);

document.addEventListener(
  "pointerdown",
  () => {
    if (needsRevive || !audioCtx || audioCtx.state !== "running") {
      void resumeAudio({ bounce: needsRevive });
    }
  },
  { passive: true },
);

/**
 * Applies a standard Attack/Decay envelope to an audio source.
 * @param {AudioContext} audio
 * @param {AudioNode} source
 * @param {AudioNode} destination
 * @param {{ attack: number, decay: number, peak: number }} layer
 * @param {number} startTime
 */
function applyEnvelope(audio, source, destination, layer, startTime) {
  const gain = audio.createGain();
  gain.gain.setValueAtTime(ENVELOPE_FLOOR, startTime);
  gain.gain.exponentialRampToValueAtTime(layer.peak, startTime + layer.attack);
  gain.gain.exponentialRampToValueAtTime(ENVELOPE_FLOOR, startTime + layer.attack + layer.decay);
  source.connect(gain).connect(destination);
}

/**
 * @param {AudioContext} audio
 * @param {AudioNode} destination
 * @param {ToneLayer} layer
 * @param {number} startTime
 */
function renderTone(audio, destination, layer, startTime) {
  const freq = noteToHz(layer.note);
  if (freq == null) return;

  const oscillator = audio.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(freq, startTime);

  applyEnvelope(audio, oscillator, destination, layer, startTime);

  oscillator.start(startTime);
  oscillator.stop(startTime + layer.attack + layer.decay + SOURCE_STOP_PADDING);
}

/**
 * @param {AudioContext} audio
 * @param {AudioNode} destination
 * @param {NoiseLayer} layer
 * @param {number} startTime
 */
function renderNoise(audio, destination, layer, startTime) {
  const duration = layer.attack + layer.decay + SOURCE_STOP_PADDING;
  const length = Math.max(1, Math.floor(duration * audio.sampleRate));
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = 2 * Math.random() - 1;

  const source = audio.createBufferSource();
  source.buffer = buffer;

  const filter = audio.createBiquadFilter();
  filter.type = layer.filterType;
  filter.frequency.value = layer.filterFrequency;
  if (layer.filterQ !== undefined) filter.Q.value = layer.filterQ;

  source.connect(filter);
  applyEnvelope(audio, filter, destination, layer, startTime);

  source.start(startTime);
  source.stop(startTime + duration);
}

/**
 * @param {AudioContext} audio
 * @param {AudioNode} source
 * @param {AudioNode} destination
 * @param {Shimmer} shimmer
 * @returns {AudioNode[]}
 */
function attachShimmer(audio, source, destination, shimmer) {
  const delay = audio.createDelay(1);
  delay.delayTime.value = shimmer.delay;

  const feedbackFilter = audio.createBiquadFilter();
  feedbackFilter.type = "lowpass";
  feedbackFilter.frequency.value = shimmer.lowpass;

  const feedbackGain = audio.createGain();
  feedbackGain.gain.value = shimmer.feedback;

  const wetGain = audio.createGain();
  wetGain.gain.value = shimmer.wet;

  source.connect(delay);
  delay.connect(feedbackFilter);
  feedbackFilter.connect(feedbackGain);
  feedbackGain.connect(delay);
  feedbackFilter.connect(wetGain);
  wetGain.connect(destination);

  return [delay, feedbackFilter, feedbackGain, wetGain];
}

/** @param {SoundRecipe} recipe */
function sourceEnd(recipe) {
  return Math.max(
    ...recipe.layers.map(
      (layer) => (layer.offset ?? 0) + layer.attack + layer.decay + SOURCE_STOP_PADDING,
    ),
  );
}

/** @param {Shimmer} [shimmer] */
function shimmerTail(shimmer) {
  if (!shimmer || shimmer.feedback <= 0) return 0;
  if (shimmer.feedback >= 1) return shimmer.delay;
  return shimmer.delay * (1 + Math.ceil(Math.log(INAUDIBLE_GAIN) / Math.log(shimmer.feedback)));
}

/**
 * @param {AudioContext} audio
 * @param {GainNode} output
 * @param {SoundRecipe} recipe
 * @param {number} startTime
 * @param {{ volume?: number, pan?: number }} [opts]
 */
function renderRecipe(audio, output, recipe, startTime, { volume = 1, pan = 0 } = {}) {
  const bus = audio.createGain();
  bus.gain.value = recipe.masterGain * volume;

  /** @type {AudioNode[]} */
  const cleanupNodes = [bus];

  const clampedPan = clampNumber(pan, -1, 1);
  if (clampedPan !== 0) {
    const panner = audio.createStereoPanner();
    panner.pan.setValueAtTime(clampedPan, startTime);
    bus.connect(panner).connect(output);
    cleanupNodes.push(panner);
  } else {
    bus.connect(output);
  }

  if (recipe.shimmer) {
    cleanupNodes.push(...attachShimmer(audio, bus, output, recipe.shimmer));
  }

  for (const layer of recipe.layers) {
    const layerStartTime = startTime + (layer.offset ?? 0);
    if (layer.kind === "tone") renderTone(audio, bus, layer, layerStartTime);
    else renderNoise(audio, bus, layer, layerStartTime);
  }

  const cleanupAfterMs = (sourceEnd(recipe) + shimmerTail(recipe.shimmer) + CLEANUP_MARGIN) * 1000;
  setTimeout(() => {
    for (const node of cleanupNodes) node.disconnect();
  }, cleanupAfterMs);
}

/**
 * When muted, `play` is a no-op until unmuted.
 * Preference is persisted so SoundControl restores on load.
 * @param {boolean} value
 */
export function setMuted(value) {
  muted = Boolean(value);
  saveMutedPreference(muted);
}

/** @returns {boolean} */
export function isMuted() {
  return muted;
}

/**
 * Play a sound effect.
 * @param {string} name
 * @param {{ volume?: number, pan?: number }} [opts]
 */
export function play(name, opts) {
  if (muted) return;
  const recipe = RECIPES[name];
  if (!recipe) return;

  resumeAudio({ bounce: needsRevive }).then((ok) => {
    if (!ok || !audioCtx || !output) return;
    renderRecipe(audioCtx, output, recipe, audioCtx.currentTime + LOOKAHEAD, opts);
  });
}
