/**
 * Org list sort helpers.
 * Run: npx tsx --test scripts/test-org-list-sort.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseOrgFingerprintListSort,
  sortOrgFingerprintSummaries,
} from "../lib/organizations/org-list-sort";

const sample = [
  { displayName: "Studio on Richmond", sourceEmailCount: 2656 },
  { displayName: "ICC Property Management Ltd.", sourceEmailCount: 2596 },
  { displayName: "1-800-GOT-JUNK", sourceEmailCount: 6 },
];

describe("parseOrgFingerprintListSort", () => {
  it("accepts known values and defaults to mentions-desc", () => {
    assert.equal(parseOrgFingerprintListSort("name-asc"), "name-asc");
    assert.equal(parseOrgFingerprintListSort("bad"), "mentions-desc");
    assert.equal(parseOrgFingerprintListSort(null), "mentions-desc");
  });
});

describe("sortOrgFingerprintSummaries", () => {
  it("sorts by name ascending", () => {
    const sorted = sortOrgFingerprintSummaries(sample, "name-asc");
    assert.deepEqual(
      sorted.map((org) => org.displayName),
      [
        "1-800-GOT-JUNK",
        "ICC Property Management Ltd.",
        "Studio on Richmond",
      ],
    );
  });

  it("sorts by mentions descending", () => {
    const sorted = sortOrgFingerprintSummaries(sample, "mentions-desc");
    assert.deepEqual(
      sorted.map((org) => org.displayName),
      [
        "Studio on Richmond",
        "ICC Property Management Ltd.",
        "1-800-GOT-JUNK",
      ],
    );
  });
});
