/**
 * Canonical project year-range parsing.
 * Run: npx tsx --test scripts/test-project-year-range.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeProjectYearHint,
  parseProjectYearRange,
  preferProjectYearHint,
  projectYearRangeCovers,
  projectYearRangeIdentity,
  yearsMatch,
} from "../lib/projects/project-year-range";

const TODAY = new Date("2026-08-20T12:00:00Z");

describe("parseProjectYearRange", () => {
  it("keeps a single calendar year", () => {
    assert.deepEqual(parseProjectYearRange("2024"), { start: 2024, end: 2024 });
    assert.deepEqual(parseProjectYearRange("FY2024"), {
      start: 2024,
      end: 2024,
    });
  });

  it("parses inclusive spans", () => {
    assert.deepEqual(parseProjectYearRange("2024-2026"), {
      start: 2024,
      end: 2026,
    });
    assert.deepEqual(parseProjectYearRange("2022/2023"), {
      start: 2022,
      end: 2023,
    });
    assert.deepEqual(parseProjectYearRange("2024-25"), {
      start: 2024,
      end: 2025,
    });
    assert.deepEqual(parseProjectYearRange("2024–2028"), {
      start: 2024,
      end: 2028,
    });
  });

  it("resolves relatives against the reference date", () => {
    assert.deepEqual(parseProjectYearRange("this year", TODAY), {
      start: 2026,
      end: 2026,
    });
    assert.deepEqual(parseProjectYearRange("next year", TODAY), {
      start: 2027,
      end: 2027,
    });
    assert.deepEqual(parseProjectYearRange("last year", TODAY), {
      start: 2025,
      end: 2025,
    });
  });

  it("drops durations and seasons", () => {
    assert.equal(parseProjectYearRange("3-year"), null);
    assert.equal(parseProjectYearRange("three-year"), null);
    assert.equal(parseProjectYearRange("this coming spring"), null);
  });
});

describe("normalizeProjectYearHint", () => {
  it("formats a single year or an en-dash span", () => {
    assert.equal(normalizeProjectYearHint("FY2024"), "2024");
    assert.equal(normalizeProjectYearHint("2024-25"), "2024–2025");
    assert.equal(normalizeProjectYearHint("this year", TODAY), "2026");
    assert.equal(normalizeProjectYearHint("3-year"), null);
  });
});

describe("projectYearRangeIdentity", () => {
  it("uses ASCII hyphens in identity tokens", () => {
    assert.equal(
      projectYearRangeIdentity({ start: 2024, end: 2024 }),
      "2024",
    );
    assert.equal(
      projectYearRangeIdentity({ start: 2024, end: 2026 }),
      "2024-2026",
    );
  });
});

describe("yearsMatch", () => {
  it("treats overlapping ranges as the same evidence value", () => {
    assert.equal(yearsMatch("2024-25", "2024"), true);
    assert.equal(yearsMatch("2024–2026", "2025"), true);
    assert.equal(yearsMatch("2024", "2026"), false);
  });
});

describe("preferProjectYearHint", () => {
  it("unions overlapping or adjacent stored hints", () => {
    assert.equal(preferProjectYearHint("2024", "2024-2026"), "2024–2026");
    assert.equal(preferProjectYearHint("FY2024", "2024"), "2024");
  });
});

describe("projectYearRangeCovers", () => {
  it("lets a year filter hit a spanning project", () => {
    assert.equal(projectYearRangeCovers("2024–2026", 2025), true);
    assert.equal(projectYearRangeCovers("2024–2026", 2027), false);
  });
});
