import { clamp } from "./utils.js";

/**
 * @typedef {'work' | 'rest'} PhaseType
 */

/**
 * @typedef {Object} TimerConfig
 * @property {number} workSeconds
 * @property {number} restSeconds
 * @property {number} rounds
 */

/**
 * @typedef {Object} Phase
 * @property {PhaseType} type
 * @property {number} durationSeconds
 * @property {number} round 1-based round index
 * @property {number} totalRounds
 */

export const DURATION_MIN = 5;
export const DURATION_MAX = 9 * 60 + 59; // 9:59
export const DURATION_STEP = 5;
export const COUNTDOWN_SECONDS = 3;
export const PREPARE_SECONDS = 3;
export const ROUNDS_MAX = 99;

export const DEFAULT_CONFIG = Object.freeze({
  workSeconds: 30,
  restSeconds: 30,
  rounds: 5,
});

/**
 * @param {{
 *   workSeconds?: number,
 *   restSeconds?: number,
 *   rounds?: number,
 * }} input
 * @returns {TimerConfig}
 */
export function createConfig(input = {}) {
  return {
    workSeconds: clamp(input.workSeconds ?? DEFAULT_CONFIG.workSeconds, DURATION_MIN, DURATION_MAX),
    restSeconds: clamp(input.restSeconds ?? DEFAULT_CONFIG.restSeconds, DURATION_MIN, DURATION_MAX),
    rounds: clamp(input.rounds ?? DEFAULT_CONFIG.rounds, 1, ROUNDS_MAX),
  };
}

/**
 * Expand a config into timed phases.
 * Pattern: (Work → Rest) × rounds, omitting the rest after the final work.
 *
 * @param {TimerConfig} config
 * @returns {Phase[]}
 */
export function toPhases(config) {
  /** @type {Phase[]} */
  const phases = [];

  for (let round = 1; round <= config.rounds; round++) {
    phases.push({
      type: "work",
      durationSeconds: config.workSeconds,
      round,
      totalRounds: config.rounds,
    });

    const isLastRound = round === config.rounds;
    if (!isLastRound) {
      phases.push({
        type: "rest",
        durationSeconds: config.restSeconds,
        round,
        totalRounds: config.rounds,
      });
    }
  }

  return phases;
}

/**
 * Total workout duration in seconds (final rest omitted).
 * @param {TimerConfig} config
 * @returns {number}
 */
export function totalWorkoutSeconds(config) {
  const restRounds = Math.max(0, config.rounds - 1);
  return config.workSeconds * config.rounds + config.restSeconds * restRounds;
}

/**
 * @param {unknown} value
 * @returns {TimerConfig | null}
 */
export function normalizeStoredConfig(value) {
  if (!value || typeof value !== "object") return null;

  const record = /** @type {Record<string, unknown>} */ (value);
  if (typeof record.workSeconds !== "number" && typeof record.workSeconds !== "string") {
    return null;
  }

  return createConfig({
    workSeconds: record.workSeconds,
    restSeconds: record.restSeconds,
    rounds: record.rounds,
  });
}
