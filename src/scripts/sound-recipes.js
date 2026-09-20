/**
 * Sound recipe table and related typedefs.
 * Synthesis lives in sounds.js; this file is data only.
 */

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

/** @type {Record<string, SoundRecipe>} */
export const RECIPES = {
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
        note: "C#5",
        attack: 0.004,
        decay: 0.09,
        peak: 0.06,
      },
      {
        kind: "tone",
        note: "G#5",
        offset: 0.06,
        attack: 0.004,
        decay: 0.1,
        peak: 0.06,
      },
      {
        kind: "tone",
        note: "C#6",
        offset: 0.12,
        attack: 0.004,
        decay: 0.18,
        peak: 0.07,
      },
    ],
    shimmer: { delay: 0.2, feedback: 0.1, wet: 0.2, lowpass: 800 },
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
