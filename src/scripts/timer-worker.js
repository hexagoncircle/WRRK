/**
 * Ticker running off the main thread. Worker timers keep firing at a steady
 * cadence even when the tab is hidden, unlike main-thread rAF/setTimeout which
 * browsers heavily throttle for background tabs. Each `tick` message just asks
 * the engine to recompute against its absolute deadline, so accuracy stays put.
 */

/** @type {ReturnType<typeof setInterval> | null} */
let intervalId = null;

self.addEventListener("message", (event) => {
  const data = event.data ?? {};

  if (data.type === "start") {
    const interval = typeof data.interval === "number" && data.interval > 0 ? data.interval : 250;
    if (intervalId != null) clearInterval(intervalId);
    intervalId = setInterval(() => self.postMessage({ type: "tick" }), interval);
    return;
  }

  if (data.type === "stop") {
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
});
