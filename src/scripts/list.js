import { formatMMSS } from "./format.js";
import { totalDurationSeconds } from "./model.js";

/** @typedef {import('./model.js').TimerSet} TimerSet */

/**
 * Progressive enhancement for the saved-sets list.
 * @param {HTMLElement} root
 */
export function enhanceList(root) {
  const list = root.querySelector("[data-set-list]");
  if (!(list instanceof HTMLElement)) return;

  /** @type {TimerSet[]} */
  let sets = [];

  /**
   * @param {TimerSet[]} next
   */
  const render = (next) => {
    sets = next;
    list.replaceChildren();

    if (sets.length === 0) {
      const empty = document.createElement("p");
      empty.dataset.empty = "";
      empty.textContent = "No saved sets yet.";
      list.append(empty);
      return;
    }

    for (const set of sets) {
      const item = document.createElement("article");
      item.dataset.setId = set.id;

      const title = document.createElement("h3");
      title.textContent = set.name;

      const meta = document.createElement("p");
      const total = formatMMSS(totalDurationSeconds(set));
      meta.textContent = `Work ${formatMMSS(set.workSeconds)} · Rest ${formatMMSS(set.restSeconds)} · ${set.rounds} rounds · ${total} total`;

      const playButton = document.createElement("button");
      playButton.type = "button";
      playButton.textContent = "Play";
      playButton.addEventListener("click", () => {
        root.dispatchEvent(
          new CustomEvent("play-set", {
            detail: set,
            bubbles: true,
          }),
        );
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        root.dispatchEvent(
          new CustomEvent("set-deleted", {
            detail: { id: set.id },
            bubbles: true,
          }),
        );
      });

      item.append(title, meta, playButton, deleteButton);
      list.append(item);
    }
  };

  return { render };
}
