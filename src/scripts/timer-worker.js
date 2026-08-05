/** Posts `{ type: "tick" }` on an interval for TimerEngine. */

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
