/**
 * Best-effort Screen Wake Lock helper.
 * Unsupported or denied permissions are treated as non-fatal.
 */
export class WakeLockController {
  constructor() {
    /** @type {WakeLockSentinel | null} */
    this._sentinel = null;
    /** @type {boolean} */
    this._desired = false;
    /** @type {AbortController | null} */
    this._visibilityController = null;
  }

  get supported() {
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
  }

  /**
   * Request a wake lock while playback is active.
   */
  async request() {
    this._desired = true;
    this._watchVisibility();
    await this._acquire();
  }

  /**
   * Release the wake lock and stop trying to hold it.
   */
  async release() {
    this._desired = false;
    this._visibilityController?.abort();
    this._visibilityController = null;
    await this._releaseSentinel();
  }

  async _acquire() {
    if (!this._desired || !this.supported) return;
    if (document.visibilityState !== "visible") return;
    if (this._sentinel && !this._sentinel.released) return;

    try {
      this._sentinel = await navigator.wakeLock.request("screen");
      this._sentinel.addEventListener("release", () => {
        this._sentinel = null;
      });
    } catch {
      // Permission denied or temporarily unavailable — ignore.
      this._sentinel = null;
    }
  }

  async _releaseSentinel() {
    if (!this._sentinel) return;
    try {
      await this._sentinel.release();
    } catch {
      // Already released.
    }
    this._sentinel = null;
  }

  _watchVisibility() {
    this._visibilityController?.abort();
    this._visibilityController = new AbortController();

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!this._desired) return;
        if (document.visibilityState === "visible") {
          void this._acquire();
        }
      },
      { signal: this._visibilityController.signal },
    );
  }
}
