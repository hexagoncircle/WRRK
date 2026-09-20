import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createConfig,
  DEFAULT_CONFIG,
  DURATION_MAX,
  DURATION_MIN,
  normalizeStoredConfig,
  ROUNDS_MAX,
  toPhaseType,
  toPhases,
  totalWorkoutSeconds,
} from "../src/scripts/model.js";

describe("createConfig", () => {
  it("returns defaults for empty input", () => {
    assert.deepEqual(createConfig(), { ...DEFAULT_CONFIG });
  });

  it("clamps work and rest into the duration range", () => {
    assert.equal(createConfig({ workSeconds: 1 }).workSeconds, DURATION_MIN);
    assert.equal(createConfig({ workSeconds: 9999 }).workSeconds, DURATION_MAX);
    assert.equal(createConfig({ restSeconds: 1 }).restSeconds, DURATION_MIN);
  });

  it("clamps rounds into 1..ROUNDS_MAX", () => {
    assert.equal(createConfig({ rounds: 0 }).rounds, 1);
    assert.equal(createConfig({ rounds: 500 }).rounds, ROUNDS_MAX);
  });
});

describe("toPhases", () => {
  it("expands work/rest pairs and omits the final rest", () => {
    const phases = toPhases({ workSeconds: 30, restSeconds: 10, rounds: 3 });
    assert.deepEqual(
      phases.map((p) => [p.type, p.durationSeconds, p.round]),
      [
        ["work", 30, 1],
        ["rest", 10, 1],
        ["work", 30, 2],
        ["rest", 10, 2],
        ["work", 30, 3],
      ],
    );
  });

  it("is a single work phase for one round", () => {
    const phases = toPhases({ workSeconds: 20, restSeconds: 15, rounds: 1 });
    assert.equal(phases.length, 1);
    assert.equal(phases[0].type, "work");
    assert.equal(phases[0].totalRounds, 1);
  });
});

describe("totalWorkoutSeconds", () => {
  it("sums work and rest, omitting the final rest", () => {
    assert.equal(totalWorkoutSeconds({ workSeconds: 30, restSeconds: 10, rounds: 3 }), 110);
    assert.equal(totalWorkoutSeconds({ workSeconds: 30, restSeconds: 10, rounds: 1 }), 30);
  });
});

describe("toPhaseType", () => {
  it("narrows work and rest, otherwise null", () => {
    assert.equal(toPhaseType("work"), "work");
    assert.equal(toPhaseType("rest"), "rest");
    assert.equal(toPhaseType("other"), null);
    assert.equal(toPhaseType(undefined), null);
  });
});

describe("normalizeStoredConfig", () => {
  it("rejects non-objects and missing workSeconds", () => {
    assert.equal(normalizeStoredConfig(null), null);
    assert.equal(normalizeStoredConfig(42), null);
    assert.equal(normalizeStoredConfig({}), null);
    assert.equal(normalizeStoredConfig({ restSeconds: 10 }), null);
  });

  it("accepts numeric or string workSeconds and clamps the rest", () => {
    assert.deepEqual(normalizeStoredConfig({ workSeconds: 40, restSeconds: 20, rounds: 4 }), {
      workSeconds: 40,
      restSeconds: 20,
      rounds: 4,
    });
    assert.equal(normalizeStoredConfig({ workSeconds: "25" }).workSeconds, 25);
  });
});
