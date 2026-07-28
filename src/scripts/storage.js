import { createConfig, DEFAULT_CONFIG, normalizeStoredConfig } from "./model.js";

/** @typedef {import('./model.js').TimerConfig} TimerConfig */

const STORAGE_KEY = "interval-timer:config";

/**
 * @returns {TimerConfig}
 */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createConfig(DEFAULT_CONFIG);

    const parsed = JSON.parse(raw);
    return normalizeStoredConfig(parsed) ?? createConfig(DEFAULT_CONFIG);
  } catch {
    return createConfig(DEFAULT_CONFIG);
  }
}

/**
 * @param {TimerConfig} config
 */
export function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(createConfig(config)));
}
