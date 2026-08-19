/**
 * Project list sort helpers.
 * Run: npx tsx --test scripts/test-project-list-sort.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseProjectFingerprintListSort,
  sortProjectFingerprintSummaries,
} from "../lib/projects/project-list-sort";

const sample = [
  { displayName: "Maglock 2024", sourceEmailCount: 2656 },
  { displayName: "EV charging", sourceEmailCount: 2596 },
  { displayName: "Boiler replacement", sourceEmailCount: 6 },
];

describe("parseProjectFingerprintListSort", () => {
  it("accepts known values and defaults to mentions-desc", () => {
    assert.equal(parseProjectFingerprintListSort("name-asc"), "name-asc");
    assert.equal(parseProjectFingerprintListSort("bad"), "mentions-desc");
    assert.equal(parseProjectFingerprintListSort(null), "mentions-desc");
  });
});

describe("sortProjectFingerprintSummaries", () => {
  it("sorts by name ascending", () => {
    const sorted = sortProjectFingerprintSummaries(sample, "name-asc");
    assert.deepEqual(
      sorted.map((project) => project.displayName),
      ["Boiler replacement", "EV charging", "Maglock 2024"],
    );
  });

  it("sorts by mentions descending", () => {
    const sorted = sortProjectFingerprintSummaries(sample, "mentions-desc");
    assert.deepEqual(
      sorted.map((project) => project.displayName),
      ["Maglock 2024", "EV charging", "Boiler replacement"],
    );
  });
});
