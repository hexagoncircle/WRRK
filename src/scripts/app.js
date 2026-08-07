import { enhanceNumberFields } from "./number-field.js";
import { enhancePlayer } from "./player.js";
import { createConfig } from "./model.js";
import { loadConfig, saveConfig } from "./storage.js";

function main() {
  const $appRoot = document.querySelector("[data-app-root]");
  const $player = document.querySelector("[data-player]");

  if (!($appRoot instanceof HTMLElement) || !($player instanceof HTMLElement)) {
    return;
  }
  const fields = enhanceNumberFields($appRoot);
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
   * @param {boolean} disabled
   */
  const setFieldsDisabled = (disabled) => {
    for (const field of fields) {
      field.setDisabled(disabled);
    }
  };

  const player = enhancePlayer($player, {
    getConfig: readConfig,
    attrsRoot: $appRoot,
    onRunningChange: setFieldsDisabled,
  });

  $appRoot.addEventListener("number-field-change", () => {
    const config = readConfig();
    saveConfig(config);
    player.softReset(config);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
  main();
}
