import { createTimerSet, MAX_ROUNDS } from "./model.js";

/**
 * Progressive enhancement for the set editor form.
 * @param {HTMLElement} root
 */
export function enhanceEditor(root) {
  const form = root.querySelector("[data-editor-form]");
  const saveButton = root.querySelector("[data-editor-save]");
  if (!(form instanceof HTMLFormElement) || !(saveButton instanceof HTMLButtonElement)) {
    return;
  }

  const syncValidity = () => {
    const data = readForm(form);
    const result = createTimerSet(data);
    saveButton.disabled = !result.ok;
  };

  form.addEventListener("input", syncValidity);
  form.addEventListener("change", syncValidity);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = createTimerSet(readForm(form));
    if (!result.ok) return;

    root.dispatchEvent(
      new CustomEvent("set-created", {
        detail: result.set,
        bubbles: true,
      }),
    );

    form.reset();
    const nameInput = form.elements.namedItem("name");
    const roundsInput = form.elements.namedItem("rounds");
    if (nameInput instanceof HTMLInputElement) nameInput.value = "My set";
    if (roundsInput instanceof HTMLInputElement) roundsInput.value = "1";
    syncValidity();
  });

  syncValidity();
}

/**
 * @param {HTMLFormElement} form
 */
function readForm(form) {
  const getNumber = (name) => {
    const field = form.elements.namedItem(name);
    return field instanceof HTMLInputElement ? field.value : "0";
  };

  const nameField = form.elements.namedItem("name");

  return {
    name: nameField instanceof HTMLInputElement ? nameField.value : "Untitled set",
    workMinutes: getNumber("workMinutes"),
    workSeconds: getNumber("workSeconds"),
    restMinutes: getNumber("restMinutes"),
    restSeconds: getNumber("restSeconds"),
    rounds: Math.min(MAX_ROUNDS, Number(getNumber("rounds")) || 0),
  };
}
