import { enhanceEditor } from "./editor.js";
import { enhanceList } from "./list.js";
import { enhancePlayer } from "./player.js";
import { addSet, deleteSet, loadSets } from "./storage.js";

/**
 * Toggle build/play modes with View Transitions when available.
 * @param {HTMLElement} buildMode
 * @param {HTMLElement} playMode
 * @param {'build' | 'play'} mode
 */
function setMode(buildMode, playMode, mode) {
  const apply = () => {
    const isPlay = mode === "play";
    buildMode.hidden = isPlay;
    playMode.hidden = !isPlay;
  };

  if (typeof document.startViewTransition === "function") {
    document.startViewTransition(apply);
  } else {
    apply();
  }
}

function main() {
  const editorRoot = document.querySelector("[data-timer-editor]");
  const listRoot = document.querySelector("[data-timer-list]");
  const playerRoot = document.querySelector("[data-timer-player]");
  const buildMode = document.querySelector("[data-mode-build]");
  const playMode = document.querySelector("[data-mode-play]");
  const backButton = document.querySelector("[data-back-to-build]");

  if (
    !(editorRoot instanceof HTMLElement) ||
    !(listRoot instanceof HTMLElement) ||
    !(playerRoot instanceof HTMLElement) ||
    !(buildMode instanceof HTMLElement) ||
    !(playMode instanceof HTMLElement)
  ) {
    return;
  }

  enhanceEditor(editorRoot);
  const list = enhanceList(listRoot);
  const player = enhancePlayer(playerRoot);
  if (!list || !player) return;

  list.render(loadSets());

  document.addEventListener("set-created", (event) => {
    const set = /** @type {CustomEvent} */ (event).detail;
    list.render(addSet(set));
  });

  document.addEventListener("set-deleted", (event) => {
    const { id } = /** @type {CustomEvent} */ (event).detail;
    list.render(deleteSet(id));
  });

  document.addEventListener("play-set", async (event) => {
    const set = /** @type {CustomEvent} */ (event).detail;
    player.loadSet(set);
    setMode(buildMode, playMode, "play");
    await player.start();
  });

  backButton?.addEventListener("click", () => {
    player.stop();
    setMode(buildMode, playMode, "build");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
  main();
}
