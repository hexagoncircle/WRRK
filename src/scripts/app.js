import { createConfig } from "./model.js";
import { loadConfig, saveConfig } from "./storage.js";
import { playIntro } from "./intro.js";

/**
 * @typedef {HTMLElement & { name: string, value: number, disabled: boolean }} NumberFieldEl
 */

/**
 * @typedef {HTMLElement & {
 *   enhance: (options: {
 *     getConfig: () => import('./model.js').TimerConfig,
 *     attrsRoot?: HTMLElement,
 *     onRunningChange?: (running: boolean) => void,
 *   }) => Promise<{ softReset: (config?: import('./model.js').TimerConfig, opts?: { lightUp?: boolean }) => void }>,
 * }} TimerPlayerEl
 */

async function main() {
  const $app = document.querySelector("#app");
  const $player = document.querySelector("timer-player");

  if (!$app || !$player) return;

  document.querySelector("form.settings")?.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  await Promise.all([
    customElements.whenDefined("number-field"),
    customElements.whenDefined("timer-player"),
  ]);

  /** @type {NumberFieldEl[]} */
  const fields = [...$app.querySelectorAll("number-field")];
  const fieldByName = new Map(fields.map((field) => [field.name, field]));

  const initial = loadConfig();
  for (const [name, value] of Object.entries(initial)) {
    const field = fieldByName.get(name);
    if (field) field.value = value;
  }

  /**
   * @returns {import('./model.js').TimerConfig}
   */
  const readConfig = () =>
    createConfig({
      workSeconds: fieldByName.get("workSeconds")?.value,
      restSeconds: fieldByName.get("restSeconds")?.value,
      rounds: fieldByName.get("rounds")?.value,
    });

  /**
   * @param {boolean} disabled
   */
  const setFieldsDisabled = (disabled) => {
    for (const field of fields) {
      field.disabled = disabled;
    }
  };

  // Enhance first so the timer is live under the intro; digit dance starts on reveal.
  const player = await /** @type {TimerPlayerEl} */ ($player).enhance({
    getConfig: readConfig,
    attrsRoot: $app,
    onRunningChange: setFieldsDisabled,
  });

  $app.addEventListener("number-field:change", () => {
    const config = readConfig();
    saveConfig(config);
    player.softReset(config);
  });

  await playIntro($app, {
    onReveal: () => player.softReset(readConfig(), { lightUp: true }),
  });
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      void main();
    },
    { once: true },
  );
} else {
  void main();
}
