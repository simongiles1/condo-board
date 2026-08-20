/**
 * Project list filter helpers.
 * Run: npx tsx --test scripts/test-project-list-filter.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectProjectFilterOptions,
  EMPTY_PROJECT_LIST_FILTERS,
  hasActiveProjectListFilters,
  matchesProjectListFilters,
  projectHasCompleteMetadata,
  projectMatchesListSearch,
  projectMetadataFillCount,
} from "../lib/projects/project-list-filter";

const garage = {
  displayName: "Garage traffic topping project",
  name: "Garage traffic topping project",
  year_hint: "2025",
  phase: "contract signing",
  contractor: "Alliance Restoration",
  location: "garage",
  equipment_mentions: "traffic topping",
  aliases: ["traffic topping"],
  scope: "building" as const,
};

const incomplete = {
  displayName: "kitchen stack cleaning",
  name: "kitchen stack cleaning",
  year_hint: null,
  phase: "completed",
  contractor: null,
  location: null,
  equipment_mentions: "kitchen stack",
  aliases: [],
  scope: "unknown" as const,
};

describe("projectMetadataFillCount", () => {
  it("counts filled year/phase/contractor/location/equipment", () => {
    assert.equal(projectMetadataFillCount(garage), 5);
    assert.equal(projectMetadataFillCount(incomplete), 2);
    assert.equal(projectHasCompleteMetadata(garage), true);
    assert.equal(projectHasCompleteMetadata(incomplete), false);
  });
});

describe("matchesProjectListFilters", () => {
  it("passes the empty filter set", () => {
    assert.equal(matchesProjectListFilters(garage, EMPTY_PROJECT_LIST_FILTERS), true);
    assert.equal(
      hasActiveProjectListFilters(EMPTY_PROJECT_LIST_FILTERS),
      false,
    );
  });

  it("filters by scope, missing year, and incomplete metadata", () => {
    assert.equal(
      matchesProjectListFilters(garage, {
        ...EMPTY_PROJECT_LIST_FILTERS,
        scope: "building",
      }),
      true,
    );
    assert.equal(
      matchesProjectListFilters(incomplete, {
        ...EMPTY_PROJECT_LIST_FILTERS,
        year: "missing",
      }),
      true,
    );
    assert.equal(
      matchesProjectListFilters(garage, {
        ...EMPTY_PROJECT_LIST_FILTERS,
        year: "missing",
      }),
      false,
    );
    assert.equal(
      matchesProjectListFilters(incomplete, {
        ...EMPTY_PROJECT_LIST_FILTERS,
        completeness: "incomplete",
      }),
      true,
    );
    assert.equal(
      matchesProjectListFilters(garage, {
        ...EMPTY_PROJECT_LIST_FILTERS,
        completeness: "incomplete",
      }),
      false,
    );
  });

  it("filters contractor presence and a specific phase", () => {
    assert.equal(
      matchesProjectListFilters(garage, {
        ...EMPTY_PROJECT_LIST_FILTERS,
        contractor: "set",
        phase: "contract signing",
      }),
      true,
    );
    assert.equal(
      matchesProjectListFilters(incomplete, {
        ...EMPTY_PROJECT_LIST_FILTERS,
        contractor: "set",
      }),
      false,
    );
  });
});

describe("projectMatchesListSearch", () => {
  it("matches aliases and contractor, not just the display name", () => {
    assert.equal(projectMatchesListSearch(garage, "Alliance"), true);
    assert.equal(projectMatchesListSearch(garage, "traffic topping"), true);
    assert.equal(projectMatchesListSearch(garage, "elevator"), false);
  });
});

describe("collectProjectFilterOptions", () => {
  it("collects unique years newest-first and phases A→Z", () => {
    const options = collectProjectFilterOptions([garage, incomplete]);
    assert.deepEqual(options.years, ["2025"]);
    assert.deepEqual(options.phases, ["completed", "contract signing"]);
  });
});
