/** @type {AudioContext | null} */
let ctx = null;

const NOTE_OFFSETS = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Random value in `[base - amount, base + amount]`. */
function randomRange(base, amount) {
  return base + (Math.random() * 2 - 1) * amount;
}

/**
 * Convert a note name (e.g. "C4", "F#5", "Bb3") to frequency in Hz.
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

function ensureAudio() {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/**
 * Resume AudioContext from a user gesture and prime the output path
 * so the first real note isn't late on cold start.
 * @returns {Promise<void>}
 */
export async function unlock() {
  const audio = ensureAudio();
  if (!audio) return;
  if (audio.state === "suspended") {
    try {
      await audio.resume();
    } catch {
      return;
    }
  }
  const buffer = audio.createBuffer(1, 1, audio.sampleRate);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.start(0);
}

/**
 * Short oscillator blip. Prefer `note` (e.g. "C#5"); pass `frequency` to override Hz.
 * `when` is an offset in seconds from AudioContext.currentTime.
 * `pan` is stereo position from -1 (left) to 1 (right).
 * @param {{
 *   note?: string,
 *   frequency?: number,
 *   duration?: number,
 *   when?: number,
 *   attack?: number,
 *   volume?: number,
 *   pan?: number,
 * }} [opts]
 */
export function playBlip({
  note = "C#5",
  frequency,
  duration = 0.1,
  when = 0,
  attack = 0.03,
  volume = 0.6,
  pan = 0,
} = {}) {
  const audio = ensureAudio();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume();

  const freq = frequency ?? noteToHz(note);
  if (freq == null) return;

  const now = audio.currentTime + when;

  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const panner = audio.createStereoPanner();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, now + Math.max(duration, attack + 0.01));
  panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);

  osc.connect(gain);
  gain.connect(panner);
  panner.connect(audio.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
  osc.addEventListener("ended", () => {
    osc.disconnect();
    gain.disconnect();
    panner.disconnect();
  });
}

export function playClickSound() {
  playBlip({
    frequency: randomRange(400, 40),
    duration: randomRange(0.01, 0.003),
    attack: randomRange(0.0005, 0.0002),
    volume: randomRange(0.2, 0.04),
  });
}

/**
 * Play a sequence of blips spaced by `gap` seconds.
 * @param {string[]} notes
 * @param {{ gap?: number, duration?: number }} [opts]
 */
function playSequence(notes, { gap = 0.09, duration = 0.2 } = {}) {
  notes.forEach((note, i) => {
    playBlip({ note, duration, when: i * gap });
  });
}

export function playRestSound() {
  playSequence(["B5", "G#5", "A4"]);
}

export function playWorkSound() {
  playSequence(["C#5", "G#5"]);
}

export function playPauseSound() {
  playSequence(["G#5", "E5", "G#5"]);
}

export function playResumeSound() {
  playSequence(["C#5", "G#5", "E5"]);
}

export function playCompletedSound() {
  playSequence(["C#5", "G#5", "F5", "B5", "C#6"]);
}
