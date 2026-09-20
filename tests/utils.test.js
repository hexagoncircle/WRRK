import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clamp, clampNumber, formatClock, formatDurationAttr, formatMSS } from "../src/scripts/utils.js";

describe("clamp", () => {
  it("clamps within an inclusive integer range", () => {
    assert.equal(clamp(5, 1, 10), 5);
    assert.equal(clamp(0, 1, 10), 1);
    assert.equal(clamp(20, 1, 10), 10);
  });

  it("truncates toward zero", () => {
    assert.equal(clamp(5.9, 1, 10), 5);
    assert.equal(clamp(-1.9, -5, 5), -1);
  });

  it("returns lo for non-finite values", () => {
    assert.equal(clamp(NaN, 3, 9), 3);
    assert.equal(clamp(Infinity, 3, 9), 3);
    assert.equal(clamp("x", 3, 9), 3);
    assert.equal(clamp(undefined, 3, 9), 3);
  });

  it("coerces numeric strings", () => {
    assert.equal(clamp("7", 1, 10), 7);
  });
});

describe("clampNumber", () => {
  it("clamps without truncating", () => {
    assert.equal(clampNumber(5.5, 1, 10), 5.5);
    assert.equal(clampNumber(-0.5, -1, 1), -0.5);
    assert.equal(clampNumber(2, -1, 1), 1);
  });

  it("returns lo for non-finite values", () => {
    assert.equal(clampNumber(NaN, 0, 100), 0);
  });
});

describe("formatClock", () => {
  it("joins minutes and seconds without normalizing", () => {
    assert.equal(formatClock(5, 69), "5:69");
    assert.equal(formatClock(1, 5), "1:05");
  });
});

describe("formatMSS", () => {
  it("formats whole seconds as M:SS", () => {
    assert.equal(formatMSS(0), "0:00");
    assert.equal(formatMSS(5), "0:05");
    assert.equal(formatMSS(65), "1:05");
    assert.equal(formatMSS(599), "9:59");
  });

  it("ceils fractional seconds for display", () => {
    assert.equal(formatMSS(0.1), "0:01");
    assert.equal(formatMSS(59.1), "1:00");
  });

  it("treats non-finite as zero", () => {
    assert.equal(formatMSS(NaN), "0:00");
  });
});

describe("formatDurationAttr", () => {
  it("formats ISO 8601 PT#M#S", () => {
    assert.equal(formatDurationAttr(0), "PT0M0S");
    assert.equal(formatDurationAttr(65), "PT1M5S");
    assert.equal(formatDurationAttr(5), "PT0M5S");
  });
});
