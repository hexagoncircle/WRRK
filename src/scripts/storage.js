import { createConfig, normalizeStoredConfig } from "./model.js";

/** @typedef {import('./model.js').TimerConfig} TimerConfig */

const STORAGE_KEY = "interval-timer:config";

/**
 * @returns {TimerConfig}
 */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createConfig();

    const parsed = JSON.parse(raw);
    return normalizeStoredConfig(parsed) ?? createConfig();
  } catch {
    return createConfig();
  }
}

/**
 * @param {TimerConfig} config
 */
export function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createConfig(config)));
  } catch {
    // Best-effort; quota / private mode may reject writes.
  }
}
