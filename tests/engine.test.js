import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { COUNTDOWN_SECONDS, PREPARE_SECONDS } from "../src/scripts/model.js";
import { STATUS, TimerEngine } from "../src/scripts/engine.js";

/** Minimal Worker stub — engine only needs construct + postMessage + terminate. */
class StubWorker {
  addEventListener() {}
  postMessage() {}
  terminate() {}
}

/**
 * @param {TimerEngine} engine
 * @param {string} type
 */
function collect(engine, type) {
  /** @type {unknown[]} */
  const events = [];
  engine.addEventListener(type, (event) => events.push(event));
  return events;
}

describe("TimerEngine", () => {
  /** @type {typeof globalThis.Worker | undefined} */
  let previousWorker;

  beforeEach(() => {
    previousWorker = globalThis.Worker;
    globalThis.Worker = StubWorker;
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
  });

  afterEach(() => {
    mock.timers.reset();
    if (previousWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = previousWorker;
  });

  /** Advance past a deadline so the boundary timer has fired. */
  function advance(ms) {
    mock.timers.tick(ms + 1);
  }

  it("starts in preparing, then countdown, then first work", () => {
    const engine = new TimerEngine({ workSeconds: 5, restSeconds: 5, rounds: 2 });
    const phases = collect(engine, "phase-change");

    engine.start();
    assert.equal(engine.status, STATUS.preparing);
    assert.equal(/** @type {CustomEvent} */ (phases[0]).detail.status, STATUS.preparing);

    advance(PREPARE_SECONDS * 1000);
    assert.equal(engine.status, STATUS.countdown);
    assert.equal(/** @type {CustomEvent} */ (phases.at(-1)).detail.status, STATUS.countdown);

    advance(COUNTDOWN_SECONDS * 1000);
    assert.equal(engine.status, STATUS.running);
    const running = /** @type {CustomEvent} */ (phases.at(-1)).detail;
    assert.equal(running.status, STATUS.running);
    assert.equal(running.phase?.type, "work");
    assert.equal(running.round, 1);
  });

  it("pauses and resumes mid-phase without losing remaining time", () => {
    const engine = new TimerEngine({ workSeconds: 10, restSeconds: 5, rounds: 1 });
    const resumes = collect(engine, "resume");

    engine.start();
    advance((PREPARE_SECONDS + COUNTDOWN_SECONDS) * 1000);
    assert.equal(engine.status, STATUS.running);

    mock.timers.tick(3000);
    engine.pause();
    assert.equal(engine.status, STATUS.paused);
    assert.ok(engine.remaining != null);
    const pausedSeconds = engine.remaining;
    assert.ok(pausedSeconds > 6.5 && pausedSeconds < 7.5);

    engine.start();
    assert.equal(engine.status, STATUS.running);
    assert.equal(engine.remaining, null);
    assert.equal(resumes.length, 1);
    assert.equal(/** @type {CustomEvent} */ (resumes[0]).detail.status, STATUS.running);
  });

  it("emits complete after the final work phase", () => {
    const engine = new TimerEngine({ workSeconds: 2, restSeconds: 2, rounds: 1 });
    const completes = collect(engine, "complete");

    engine.start();
    advance((PREPARE_SECONDS + COUNTDOWN_SECONDS + 2) * 1000);
    assert.equal(engine.status, STATUS.complete);
    assert.equal(completes.length, 1);
  });

  it("runs work → rest → work across multiple rounds", () => {
    const engine = new TimerEngine({ workSeconds: 2, restSeconds: 2, rounds: 2 });
    /** @type {string[]} */
    const types = [];
    engine.addEventListener("phase-change", (event) => {
      if (event.detail.phase) types.push(event.detail.phase.type);
    });

    engine.start();
    advance((PREPARE_SECONDS + COUNTDOWN_SECONDS) * 1000);
    advance(2000);
    advance(2000);
    advance(2000);

    assert.deepEqual(types, ["work", "rest", "work"]);
    assert.equal(engine.status, STATUS.complete);
  });

  it("reset returns to idle", () => {
    const engine = new TimerEngine({ workSeconds: 5, restSeconds: 5, rounds: 1 });
    engine.start();
    engine.reset();
    assert.equal(engine.status, STATUS.idle);
    assert.equal(engine.phaseIndex, -1);
    assert.equal(engine.phaseEndMs, null);
  });
});
