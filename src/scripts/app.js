import { enhanceNumberFields } from "../components/number-field.js";
import { enhancePlayer } from "../components/player.js";
import { createConfig } from "./model.js";
import { loadConfig, saveConfig } from "./storage.js";

function main() {
  const appRoot = document.querySelector("[data-app-root]");
  const playerRoot = document.querySelector("[data-player]");

  if (!(appRoot instanceof HTMLElement) || !(playerRoot instanceof HTMLElement)) {
    return;
  }

  const fields = enhanceNumberFields(appRoot);
  const fieldByName = new Map(fields.map((field) => [field.name, field]));

  const initial = loadConfig();
  for (const [name, value] of Object.entries(initial)) {
    fieldByName.get(name)?.setValue(value);
  }

  /**
   * @returns {import('./model.js').TimerConfig}
   */
  const readConfig = () =>
    createConfig({
      workSeconds: fieldByName.get("workSeconds")?.getValue(),
      restSeconds: fieldByName.get("restSeconds")?.getValue(),
      rounds: fieldByName.get("rounds")?.getValue(),
    });

  /**
   * @param {boolean} running
   */
  const setFieldsDisabled = (running) => {
    for (const field of fields) {
      field.setDisabled(running);
    }
  };

  const player = enhancePlayer(playerRoot, {
    getConfig: readConfig,
    onRunningChange: setFieldsDisabled,
  });

  if (!player) return;

  appRoot.addEventListener("number-field-change", () => {
    const config = readConfig();
    saveConfig(config);

    // Edits while paused (or idle) soft-reset so the next Play starts prepare
    // with the updated values. While running, fields are disabled.
    if (!player.isRunning()) {
      player.softReset(config);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
  main();
}
