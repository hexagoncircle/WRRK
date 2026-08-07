/** @type {AudioContext | null} */
let ctx = null;
/** @type {GainNode | null} */
let master = null;

const MUTED_STORAGE_KEY = "interval-timer:muted";

/** @returns {boolean} */
function loadMutedPreference() {
  try {
    return localStorage.getItem(MUTED_STORAGE_KEY) === "true";
  } catch {
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

const MELODIC_SHIMMER = {
  delay: 0.1,
  feedback: 0.22,
  wet: 0.16,
  lowpass: 4500,
};

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
 *   note?: string,
 *   frequency?: number,
 *   waveform?: OscillatorType,
 *   offset?: number,
 *   attack: number,
 *   decay: number,
 *   peak: number,
 *   detune?: number,
 *   glideTo?: number | string,
 *   glideTime?: number,
 * }} ToneLayer
 */

/**
 * @typedef {{
 *   kind: "noise",
 *   filterType: BiquadFilterType,
 *   filterFrequency: number,
 *   filterQ?: number,
 *   filterGlideTo?: number,
 *   filterGlideTime?: number,
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

/** @type {Record<string, SoundRecipe>} */
const RECIPES = {
  blip: {
    masterGain: 0.5,
    layers: [
      {
        kind: "tone",
        note: "C#5",
        attack: 0.008,
        decay: 0.1,
        peak: 0.08,
      },
      {
        kind: "tone",
        note: "G#5",
        attack: 0.008,
        decay: 0.1,
        peak: 0.02,
        offset: 0.02,
      },
    ],
  },
  completed: {
    masterGain: 0.55,
    layers: [
      { kind: "tone", note: "C#5", attack: 0.006, decay: 0.18, peak: 0.08 },
      {
        kind: "tone",
        note: "G#5",
        offset: 0.09,
        attack: 0.006,
        decay: 0.18,
        peak: 0.08,
      },
      {
        kind: "tone",
        note: "F5",
        offset: 0.18,
        attack: 0.006,
        decay: 0.18,
        peak: 0.08,
      },
      {
        kind: "tone",
        note: "B5",
        offset: 0.27,
        attack: 0.006,
        decay: 0.2,
        peak: 0.08,
      },
      {
        kind: "tone",
        note: "C#6",
        offset: 0.36,
        attack: 0.006,
        decay: 0.28,
        peak: 0.09,
      },
    ],
    shimmer: { delay: 0.12, feedback: 0.25, wet: 0.2, lowpass: 4000 },
  },
  mute: {
    masterGain: 0.3,
    layers: [
      { kind: "tone", note: "E5", attack: 0.002, decay: 0.1, peak: 0.09 },
      {
        kind: "tone",
        note: "C#5",
        offset: 0.09,
        attack: 0.002,
        decay: 0.1,
        peak: 0.08,
      },
      {
        kind: "tone",
        note: "A4",
        offset: 0.18,
        attack: 0.002,
        decay: 0.1,
        peak: 0.08,
      },
      {
        kind: "tone",
        note: "G#4",
        offset: 0.26,
        attack: 0.002,
        decay: 0.1,
        peak: 0.08,
      },
    ],
  },
  pause: {
    masterGain: 0.55,
    layers: [
      { kind: "tone", note: "G#5", attack: 0.006, decay: 0.2, peak: 0.09 },
      {
        kind: "tone",
        note: "E5",
        offset: 0.09,
        attack: 0.006,
        decay: 0.2,
        peak: 0.08,
      },
      {
        kind: "tone",
        note: "G#5",
        offset: 0.18,
        attack: 0.006,
        decay: 0.22,
        peak: 0.08,
      },
    ],
    shimmer: MELODIC_SHIMMER,
  },
  press: {
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
  },
  rest: {
    masterGain: 0.55,
    layers: [
      { kind: "tone", note: "B5", attack: 0.006, decay: 0.2, peak: 0.09 },
      {
        kind: "tone",
        note: "G#5",
        offset: 0.09,
        attack: 0.006,
        decay: 0.2,
        peak: 0.08,
      },
      {
        kind: "tone",
        note: "A4",
        offset: 0.18,
        attack: 0.006,
        decay: 0.24,
        peak: 0.07,
      },
    ],
    shimmer: MELODIC_SHIMMER,
  },
  reset: {
    masterGain: 0.55,
    layers: [
      { kind: "tone", note: "G#5", attack: 0.006, decay: 0.14, peak: 0.08 },
      {
        kind: "tone",
        note: "E4",
        offset: 0.04,
        attack: 0.004,
        decay: 0.2,
        peak: 0.02,
      },
    ],
    shimmer: MELODIC_SHIMMER,
  },
  resume: {
    masterGain: 0.55,
    layers: [
      { kind: "tone", note: "C#5", attack: 0.006, decay: 0.2, peak: 0.09 },
      {
        kind: "tone",
        note: "G#5",
        offset: 0.09,
        attack: 0.006,
        decay: 0.2,
        peak: 0.08,
      },
      {
        kind: "tone",
        note: "E5",
        offset: 0.18,
        attack: 0.006,
        decay: 0.22,
        peak: 0.08,
      },
    ],
    shimmer: MELODIC_SHIMMER,
  },
  start: {
    masterGain: 0.5,
    layers: [
      {
        kind: "tone",
        waveform: "sine",
        note: "C#5",
        attack: 0.004,
        decay: 0.09,
        peak: 0.06,
      },
      {
        kind: "tone",
        waveform: "sine",
        note: "G#5",
        offset: 0.06,
        attack: 0.004,
        decay: 0.1,
        peak: 0.06,
      },
      {
        kind: "tone",
        waveform: "sine",
        note: "C#6",
        offset: 0.12,
        attack: 0.004,
        decay: 0.18,
        peak: 0.07,
      },
    ],
    shimmer: { delay: 0.2, feedback: 0.1, wet: 0.2, lowpass: 800 },
  },
  toggle: {
    masterGain: 0.4,
    layers: [
      {
        kind: "noise",
        filterType: "bandpass",
        filterFrequency: 4000,
        filterQ: 2,
        attack: 0.001,
        decay: 0.01,
        peak: 0.08,
      },
      {
        kind: "noise",
        filterType: "bandpass",
        filterFrequency: 2000,
        filterQ: 1.6,
        offset: 0.024,
        attack: 0.001,
        decay: 0.02,
        peak: 0.1,
      },
    ],
  },
  work: {
    masterGain: 0.55,
    layers: [
      { kind: "tone", note: "C#5", attack: 0.006, decay: 0.2, peak: 0.09 },
      {
        kind: "tone",
        note: "G#5",
        offset: 0.09,
        attack: 0.006,
        decay: 0.22,
        peak: 0.08,
      },
    ],
    shimmer: MELODIC_SHIMMER,
  },
  unmute: {
    masterGain: 0.3,
    layers: [
      {
        kind: "tone",
        note: "A4",
        attack: 0.002,
        decay: 0.1,
        peak: 0.08,
      },
      {
        kind: "tone",
        note: "C#5",
        offset: 0.09,
        attack: 0.002,
        decay: 0.1,
        peak: 0.08,
      },
      {
        kind: "tone",
        note: "E5",
        offset: 0.18,
        attack: 0.002,
        decay: 0.1,
        peak: 0.09,
      },
    ],
  },
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

/**
 * @param {{ frequency?: number, note?: string }} layer
 * @returns {number | null}
 */
function resolveFrequency(layer) {
  if (typeof layer.frequency === "number") return layer.frequency;
  if (typeof layer.note === "string") return noteToHz(layer.note);
  return null;
}

function setupAudio() {
  if (ctx && master) return true;

  // iOS 17+: route Web Audio through the playback session so the Silent
  // switch does not mute timer sounds.
  if (navigator.audioSession) {
    try {
      navigator.audioSession.type = "playback";
    } catch {
      // Unsupported / rejected — leave default ambient
    }
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return false;

  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = OUTPUT_GAIN;
  master.connect(ctx.destination);
  return true;
}

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
  const freq = resolveFrequency(layer);
  if (freq == null) return;

  const oscillator = audio.createOscillator();
  oscillator.type = layer.waveform ?? "sine";
  oscillator.frequency.setValueAtTime(freq, startTime);
  if (layer.detune != null) oscillator.detune.value = layer.detune;

  if (layer.glideTo !== undefined) {
    const glideTo = typeof layer.glideTo === "string" ? noteToHz(layer.glideTo) : layer.glideTo;
    if (glideTo != null) {
      const glideTime = layer.glideTime ?? layer.attack + layer.decay;
      oscillator.frequency.exponentialRampToValueAtTime(glideTo, startTime + glideTime);
    }
  }

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

  const clampedPan = Math.max(-1, Math.min(1, pan));
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
  if (!setupAudio() || !ctx || !master) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const startTime = ctx.currentTime + LOOKAHEAD;
  renderRecipe(ctx, master, recipe, startTime, opts);
}
