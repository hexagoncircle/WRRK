import { clampNumber } from "./utils.js";

/**
 * @typedef {{
 *   delay: number,
 *   feedback: number,
 *   wet: number,
 *   lowpass: number,
 * }} Shimmer
 */

/**
 * @typedef {{
 *   kind: "tone",
 *   note: string,
 *   offset?: number,
 *   attack: number,
 *   decay: number,
 *   peak: number,
 * }} ToneLayer
 */

/**
 * @typedef {{
 *   kind: "noise",
 *   filterType: BiquadFilterType,
 *   filterFrequency: number,
 *   filterQ?: number,
 *   offset?: number,
 *   attack: number,
 *   decay: number,
 *   peak: number,
 * }} NoiseLayer
 */

/** @typedef {ToneLayer | NoiseLayer} SoundLayer */

/**
 * @typedef {{
 *   masterGain: number,
 *   layers: SoundLayer[],
 *   shimmer?: Shimmer,
 * }} SoundRecipe
 */

/** @type {Shimmer} */
const MELODIC_SHIMMER = {
  delay: 0.1,
  feedback: 0.22,
  wet: 0.16,
  lowpass: 4500,
};

/**
 * @param {string} note
 * @param {{ offset?: number, attack?: number, decay?: number, peak?: number }} [options]
 * @returns {ToneLayer}
 */
function tone(note, { offset, attack = 0.006, decay = 0.2, peak = 0.08 } = {}) {
  return {
    kind: "tone",
    note,
    ...(offset === undefined ? {} : { offset }),
    attack,
    decay,
    peak,
  };
}

/** @type {SoundRecipe} */
export const blipSound = {
  masterGain: 0.5,
  layers: [
    tone("C#5", { attack: 0.008, decay: 0.1, peak: 0.08 }),
    tone("G#5", { offset: 0.02, attack: 0.008, decay: 0.1, peak: 0.02 }),
  ],
};

/** @type {SoundRecipe} */
export const completedSound = {
  masterGain: 0.55,
  layers: [
    tone("C#5", { decay: 0.18 }),
    tone("G#5", { offset: 0.09, decay: 0.18 }),
    tone("F5", { offset: 0.18, decay: 0.18 }),
    tone("B5", { offset: 0.27 }),
    tone("C#6", { offset: 0.36, decay: 0.28, peak: 0.09 }),
  ],
  shimmer: { delay: 0.12, feedback: 0.25, wet: 0.2, lowpass: 4000 },
};

/** @type {SoundRecipe} */
export const muteSound = {
  masterGain: 0.3,
  layers: [
    tone("E5", { attack: 0.002, decay: 0.1, peak: 0.09 }),
    tone("C#5", { offset: 0.09, attack: 0.002, decay: 0.1 }),
    tone("A4", { offset: 0.18, attack: 0.002, decay: 0.1 }),
    tone("G#4", { offset: 0.26, attack: 0.002, decay: 0.1 }),
  ],
};

/** @type {SoundRecipe} */
export const pauseSound = {
  masterGain: 0.55,
  layers: [
    tone("G#5", { peak: 0.09 }),
    tone("E5", { offset: 0.09 }),
    tone("G#5", { offset: 0.18, decay: 0.22 }),
  ],
  shimmer: MELODIC_SHIMMER,
};

/** @type {SoundRecipe} */
export const pressSound = {
  masterGain: 0.1,
  layers: [
    {
      kind: "noise",
      filterType: "bandpass",
      filterFrequency: 5000,
      filterQ: 2,
      attack: 0.001,
      decay: 0.01,
      peak: 0.2,
    },
  ],
};

/** @type {SoundRecipe} */
export const restSound = {
  masterGain: 0.55,
  layers: [
    tone("B5", { peak: 0.09 }),
    tone("G#5", { offset: 0.09 }),
    tone("A4", { offset: 0.18, decay: 0.24, peak: 0.07 }),
  ],
  shimmer: MELODIC_SHIMMER,
};

/** @type {SoundRecipe} */
export const resetSound = {
  masterGain: 0.55,
  layers: [
    tone("G#5", { decay: 0.14 }),
    tone("E4", { offset: 0.04, attack: 0.004, peak: 0.02 }),
  ],
  shimmer: MELODIC_SHIMMER,
};

/** @type {SoundRecipe} */
export const resumeSound = {
  masterGain: 0.55,
  layers: [
    tone("C#5", { peak: 0.09 }),
    tone("G#5", { offset: 0.09 }),
    tone("E5", { offset: 0.18, decay: 0.22 }),
  ],
  shimmer: MELODIC_SHIMMER,
};

/** @type {SoundRecipe} */
export const startSound = {
  masterGain: 0.5,
  layers: [
    tone("C#5", { attack: 0.004, decay: 0.09, peak: 0.06 }),
    tone("G#5", { offset: 0.06, attack: 0.004, decay: 0.1, peak: 0.06 }),
    tone("C#6", { offset: 0.12, attack: 0.004, decay: 0.18, peak: 0.07 }),
  ],
  shimmer: { delay: 0.2, feedback: 0.1, wet: 0.2, lowpass: 800 },
};

/** @type {SoundRecipe} */
export const workSound = {
  masterGain: 0.55,
  layers: [
    tone("C#5", { peak: 0.09 }),
    tone("G#5", { offset: 0.09, decay: 0.22 }),
  ],
  shimmer: MELODIC_SHIMMER,
};

/** @type {SoundRecipe} */
export const unmuteSound = {
  masterGain: 0.3,
  layers: [
    tone("A4", { attack: 0.002, decay: 0.1 }),
    tone("C#5", { offset: 0.09, attack: 0.002, decay: 0.1 }),
    tone("E5", { offset: 0.18, attack: 0.002, decay: 0.1, peak: 0.09 }),
  ],
};

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
/** Makeup so layer peaks can stay in a 0–1 authoring range. */
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

/**
 * iOS: "playback" ignores the silent switch but exposes Now Playing controls.
 * Use it only while foreground; "ambient" drops lock-screen media chrome.
 * @param {"playback" | "ambient"} type
 */
function setAudioSessionType(type) {
  if (!navigator.audioSession) return;
  try {
    navigator.audioSession.type = type;
  } catch {}
}

function setupAudio() {
  if (hasLiveContext()) return true;

  teardownAudio();
  setAudioSessionType("playback");

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
  setAudioSessionType("playback");
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

  if (!forceRecreate) return resumeAudio({ forceRecreate: true });
  return false;
}

function onAppForeground() {
  if (!audioCtx) return;
  setAudioSessionType("playback");
  needsRevive = true;
  // Always bounce through suspend→resume on return; iOS can report "running"
  // while the context is actually dead after app switching.
  void resumeAudio({ bounce: true });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    needsRevive = true;
    // Avoid lock-screen / Control Center media controls for timer SFX.
    setAudioSessionType("ambient");
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
 * @param {GainNode} destination
 * @param {SoundRecipe} recipe
 * @param {number} startTime
 * @param {{ pan?: number }} [opts]
 */
function renderRecipe(audio, destination, recipe, startTime, { pan = 0 } = {}) {
  const bus = audio.createGain();
  bus.gain.value = recipe.masterGain;

  /** @type {AudioNode[]} */
  const cleanupNodes = [bus];

  const clampedPan = clampNumber(pan, -1, 1);
  if (clampedPan !== 0) {
    const panner = audio.createStereoPanner();
    panner.pan.setValueAtTime(clampedPan, startTime);
    bus.connect(panner).connect(destination);
    cleanupNodes.push(panner);
  } else {
    bus.connect(destination);
  }

  if (recipe.shimmer) {
    cleanupNodes.push(...attachShimmer(audio, bus, destination, recipe.shimmer));
  }

  for (const layer of recipe.layers) {
    const layerStartTime = startTime + (layer.offset ?? 0);
    if (layer.kind === "tone") renderTone(audio, bus, layer, layerStartTime);
    else renderNoise(audio, bus, layer, layerStartTime);
  }

  const cleanupAfterMs = (sourceEnd(recipe) + shimmerTail(recipe.shimmer) + CLEANUP_MARGIN) * 1000;
  setTimeout(() => {
    // Context may already be closed by teardownAudio after backgrounding.
    if (audio.state === "closed") return;
    for (const node of cleanupNodes) {
      try {
        node.disconnect();
      } catch {}
    }
  }, cleanupAfterMs);
}

/** @param {boolean} value */
export function setMuted(value) {
  muted = Boolean(value);
  saveMutedPreference(muted);
}

/** @returns {boolean} */
export function isMuted() {
  return muted;
}

/**
 * @param {SoundRecipe} sound
 * @param {{ pan?: number }} [opts]
 */
export function play(sound, opts) {
  if (muted || !sound) return;

  resumeAudio({ bounce: needsRevive }).then((ok) => {
    if (!ok || !audioCtx || !output) return;
    renderRecipe(audioCtx, output, sound, audioCtx.currentTime + LOOKAHEAD, opts);
  });
}
