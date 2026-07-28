import { normalizeStoredSet } from "./model.js";

/** @typedef {import('./model.js').TimerSet} TimerSet */

const STORAGE_KEY = "interval-timer:sets";

/**
 * @returns {TimerSet[]}
 */
export function loadSets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map(normalizeStoredSet).filter(/** @type {(s: TimerSet | null) => s is TimerSet} */ (s) => s != null);
  } catch {
    return [];
  }
}

/**
 * @param {TimerSet[]} sets
 */
export function saveSets(sets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
}

/**
 * @param {TimerSet} set
 * @returns {TimerSet[]}
 */
export function addSet(set) {
  const sets = loadSets();
  sets.push(set);
  saveSets(sets);
  return sets;
}

/**
 * @param {string} id
 * @returns {TimerSet[]}
 */
export function deleteSet(id) {
  const sets = loadSets().filter((set) => set.id !== id);
  saveSets(sets);
  return sets;
}
