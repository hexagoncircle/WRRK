/**
 * Best-effort Notification helper.
 * Permission is only requested from an explicit user gesture (play).
 */
export class NotificationController {
  get supported() {
    return typeof window !== "undefined" && "Notification" in window;
  }

  /**
   * Request permission if still undecided. Safe to call from a click handler.
   * @returns {Promise<NotificationPermission | 'unsupported'>}
   */
  async ensurePermission() {
    if (!this.supported) return "unsupported";
    if (Notification.permission === "granted" || Notification.permission === "denied") {
      return Notification.permission;
    }

    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }

  /**
   * @param {string} title
   * @param {NotificationOptions} [options]
   */
  notify(title, options = {}) {
    if (!this.supported || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;

    try {
      const notification = new Notification(title, {
        silent: true,
        ...options,
      });
      notification.addEventListener("click", () => {
        window.focus();
        notification.close();
      });
    } catch {
      // Ignore notification construction failures.
    }
  }

  /**
   * @param {'prepare' | 'work' | 'rest' | 'complete'} kind
   * @param {{ round?: number | null, totalRounds?: number | null }} [meta]
   */
  notifyPhase(kind, meta = {}) {
    if (kind === "prepare") {
      this.notify("Get ready", { body: "Starting in a few seconds" });
      return;
    }

    if (kind === "complete") {
      this.notify("Workout complete", { body: "Nice work, champ!" });
      return;
    }

    const roundLabel =
      meta.round != null && meta.totalRounds != null
        ? `Round ${meta.round}/${meta.totalRounds}`
        : "";

    if (kind === "work") {
      this.notify("Work", { body: roundLabel });
      return;
    }

    if (kind === "rest") {
      this.notify("Rest", { body: roundLabel });
    }
  }
}
