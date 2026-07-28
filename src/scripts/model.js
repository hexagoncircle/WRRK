/**
 * @typedef {'work' | 'rest'} PhaseType
 */

/**
 * @typedef {Object} TimerSet
 * @property {string} id
 * @property {string} name
 * @property {number} workSeconds Must be > 0
 * @property {number} restSeconds May be 0
 * @property {number} rounds Integer from 1 to 100
 */

/**
 * @typedef {Object} Phase
 * @property {PhaseType} type
 * @property {number} durationSeconds
 * @property {number} round 1-based round index
 * @property {number} totalRounds
 */

export const MAX_ROUNDS = 100;
export const PREPARE_SECONDS = 3;

/**
 * @param {unknown} value
 * @returns {number}
 */
function toNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/**
 * @param {{
 *   id?: string,
 *   name?: string,
 *   workMinutes?: number,
 *   workSeconds?: number,
 *   restMinutes?: number,
 *   restSeconds?: number,
 *   workSecondsTotal?: number,
 *   restSecondsTotal?: number,
 *   rounds?: number,
 * }} input
 * @returns {{ ok: true, set: TimerSet } | { ok: false, error: string }}
 */
export function createTimerSet(input = {}) {
  const name = String(input.name ?? "").trim() || "Untitled set";

  const workSeconds =
    input.workSecondsTotal != null
      ? toNonNegativeInt(input.workSecondsTotal)
      : toNonNegativeInt(input.workMinutes) * 60 + toNonNegativeInt(input.workSeconds);

  const restSeconds =
    input.restSecondsTotal != null
      ? toNonNegativeInt(input.restSecondsTotal)
      : toNonNegativeInt(input.restMinutes) * 60 + toNonNegativeInt(input.restSeconds);

  const rounds = toNonNegativeInt(input.rounds);

  if (workSeconds <= 0) {
    return { ok: false, error: "Work duration must be greater than zero." };
  }

  if (rounds < 1 || rounds > MAX_ROUNDS) {
    return { ok: false, error: `Rounds must be between 1 and ${MAX_ROUNDS}.` };
  }

  /** @type {TimerSet} */
  const set = {
    id: typeof input.id === "string" && input.id ? input.id : crypto.randomUUID(),
    name,
    workSeconds,
    restSeconds,
    rounds,
  };

  return { ok: true, set };
}

/**
 * Expand a set into timed phases.
 * Pattern: (Work → Rest) × rounds, omitting zero-length rests and the rest after the final work.
 *
 * @param {TimerSet} set
 * @returns {Phase[]}
 */
export function toPhases(set) {
  /** @type {Phase[]} */
  const phases = [];

  for (let round = 1; round <= set.rounds; round++) {
    phases.push({
      type: "work",
      durationSeconds: set.workSeconds,
      round,
      totalRounds: set.rounds,
    });

    const isLastRound = round === set.rounds;
    if (!isLastRound && set.restSeconds > 0) {
      phases.push({
        type: "rest",
        durationSeconds: set.restSeconds,
        round,
        totalRounds: set.rounds,
      });
    }
  }

  return phases;
}

/**
 * @param {TimerSet} set
 * @returns {number}
 */
export function totalDurationSeconds(set) {
  return toPhases(set).reduce((sum, phase) => sum + phase.durationSeconds, 0);
}

/**
 * @param {unknown} value
 * @returns {TimerSet | null}
 */
export function normalizeStoredSet(value) {
  if (!value || typeof value !== "object") return null;

  const record = /** @type {Record<string, unknown>} */ (value);
  const result = createTimerSet({
    id: typeof record.id === "string" ? record.id : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
    workSecondsTotal: record.workSeconds,
    restSecondsTotal: record.restSeconds,
    rounds: record.rounds,
  });

  return result.ok ? result.set : null;
}
