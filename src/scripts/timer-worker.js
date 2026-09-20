/**
 * Classic worker source for TimerEngine.
 * Inlined as a Blob URL so Start works offline with no separate fetch.
 */
export const PRESS_WORKER_SOURCE = `
let intervalId = null;

self.addEventListener("message", (event) => {
  const data = event.data ?? {};

  if (data.type === "start") {
    const interval = typeof data.interval === "number" && data.interval > 0 ? data.interval : 250;
    if (intervalId != null) clearInterval(intervalId);
    intervalId = setInterval(() => self.postMessage({ type: "press" }), interval);
    return;
  }

  if (data.type === "stop") {
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
});
`;
