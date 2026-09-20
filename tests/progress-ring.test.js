import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { phasePercents } from "../src/scripts/progress-ring.js";

describe("phasePercents", () => {
  it("returns zeros when both sides are empty", () => {
    assert.deepEqual(phasePercents(0, 0), { workPercent: 0, restPercent: 0 });
  });

  it("fills the ring for single-phase layouts", () => {
    assert.deepEqual(phasePercents(30, 0), { workPercent: 100, restPercent: 0 });
    assert.deepEqual(phasePercents(0, 20), { workPercent: 0, restPercent: 100 });
  });

  it("splits proportional ratios without flooring", () => {
    assert.deepEqual(phasePercents(30, 30), { workPercent: 50, restPercent: 50 });
    assert.deepEqual(phasePercents(40, 10), { workPercent: 80, restPercent: 20 });
  });

  it("floors extreme ratios to MIN_PHASE_PERCENT (8)", () => {
    assert.deepEqual(phasePercents(100, 1), { workPercent: 92, restPercent: 8 });
    assert.deepEqual(phasePercents(1, 100), { workPercent: 8, restPercent: 92 });
  });
});
