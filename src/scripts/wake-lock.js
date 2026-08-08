/**
 * Best-effort Screen Wake Lock helper.
 * Unsupported or denied permissions are treated as non-fatal.
 */
export class WakeLockController {
  constructor() {
    /** @type {WakeLockSentinel | null} */
    this._sentinel = null;
    /** @type {boolean} */
    this._enabled = false;
    /** @type {Promise<void> | null} */
    this._pending = null;

    document.addEventListener("visibilitychange", () => {
      if (this._enabled && document.visibilityState === "visible") {
        this._acquire();
      }
    });
  }

  async request() {
    this._enabled = true;
    await this._acquire();
  }

  async release() {
    this._enabled = false;
    const sentinel = this._sentinel;
    this._sentinel = null;
    if (!sentinel) return;
    try {
      await sentinel.release();
    } catch {}
  }

  async _acquire() {
    if (!this._enabled || !("wakeLock" in navigator)) return;
    if (document.visibilityState !== "visible") return;
    if (this._sentinel && !this._sentinel.released) return;

    this._pending ??= this._requestSentinel();
    await this._pending;
  }

  async _requestSentinel() {
    try {
      const sentinel = await navigator.wakeLock.request("screen");

      if (!this._enabled || document.visibilityState !== "visible") {
        await sentinel.release().catch(() => {});
        return;
      }

      this._sentinel = sentinel;
      sentinel.addEventListener("release", () => {
        if (this._sentinel !== sentinel) return;
        this._sentinel = null;
        // OS may release while the page stays visible; re-acquire if still needed.
        if (this._enabled && document.visibilityState === "visible") {
          this._acquire();
        }
      });
    } catch {
      this._sentinel = null;
    } finally {
      this._pending = null;
    }
  }
}
