/**
 * Project identity keys and coalescing.
 * Run: npx tsx --test scripts/test-project-identity.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  coalesceProjectEntityCards,
  emptyProjectHighlightExtraction,
  isSpecificProjectLocation,
  parseProjectEntityCard,
  parseProjectHighlightExtraction,
  projectIdentityKey,
  uniqueProjectHarvestCount,
  type ProjectEntityCard,
} from "../lib/email-analysis/project-highlight-shared";
import { normalizeProjectYearHint } from "../lib/projects/project-multi-values";

function card(
  partial: Partial<ProjectEntityCard> & { name: string | null },
): ProjectEntityCard {
  return {
    name: partial.name,
    year_hint: partial.year_hint ?? null,
    phase: partial.phase ?? null,
    contractor: partial.contractor ?? null,
    location: partial.location ?? null,
    equipment_mentions: partial.equipment_mentions ?? null,
    aliases: partial.aliases ?? [],
  };
}

describe("projectIdentityKey", () => {
  it("keeps maglock 2024 and 2026 as different keys", () => {
    const key2024 = projectIdentityKey(
      card({ name: "Maglock", year_hint: "2024" }),
    );
    const key2026 = projectIdentityKey(
      card({ name: "Maglock", year_hint: "2026" }),
    );
    assert.notEqual(key2024, key2026);
    assert.equal(key2024, "name:maglock|year:2024");
    assert.equal(key2026, "name:maglock|year:2026");
  });

  it("treats FY2024 and 2024 as the same year", () => {
    assert.equal(normalizeProjectYearHint("FY2024"), "2024");
    assert.equal(normalizeProjectYearHint("2024"), "2024");
    assert.equal(
      projectIdentityKey(card({ name: "Maglock", year_hint: "FY2024" })),
      projectIdentityKey(card({ name: "Maglock", year_hint: "2024" })),
    );
  });
});

describe("coalesceProjectEntityCards", () => {
  it("does not merge the same name with different years", () => {
    const coalesced = coalesceProjectEntityCards([
      card({ name: "Maglock installation", year_hint: "2024" }),
      card({ name: "Maglock installation", year_hint: "2026" }),
    ]);
    assert.equal(coalesced.length, 2);
    const years = coalesced
      .map((row) => normalizeProjectYearHint(row.year_hint))
      .sort();
    assert.deepEqual(years, ["2024", "2026"]);
  });

  it("coalesces the same name and year into one card", () => {
    const coalesced = coalesceProjectEntityCards([
      card({
        name: "EV charging",
        year_hint: "FY2024",
        contractor: "Acme Electric",
      }),
      card({
        name: "EV charging",
        year_hint: "2024",
        location: "P1",
      }),
    ]);
    assert.equal(coalesced.length, 1);
    assert.equal(coalesced[0]!.name, "EV charging");
    assert.equal(normalizeProjectYearHint(coalesced[0]!.year_hint), "2024");
    assert.equal(coalesced[0]!.contractor, "Acme Electric");
    assert.equal(coalesced[0]!.location, "P1");
  });
});

describe("isSpecificProjectLocation", () => {
  it("drops generic building/property words", () => {
    for (const value of [
      "building",
      "the building",
      "throughout the building",
      "building's",
      "property",
      "the property",
      "site",
      "condo",
      "premises",
      "facility",
    ]) {
      assert.equal(isSpecificProjectLocation(value), false, value);
    }
  });

  it("keeps specific places", () => {
    for (const value of [
      "unit 201",
      "ninth floor amenity space",
      "9th floor",
      "P1",
      "roof",
      "garage",
      "front doors",
      "199 Richmond St W",
    ]) {
      assert.equal(isSpecificProjectLocation(value), true, value);
    }
  });
});

describe("parseProjectHighlightExtraction locations", () => {
  it("drops generic locations and keeps specific ones", () => {
    const parsed = parseProjectHighlightExtraction({
      project_names: ["kitchen stack cleaning"],
      year_hints: [],
      phases: ["completed"],
      contractors: [],
      locations: ["building", "unit 201", "the property"],
    });
    assert.deepEqual(parsed.locations, ["unit 201"]);
  });
});

describe("parseProjectEntityCard location", () => {
  it("nulls a generic-only location and keeps a specific one", () => {
    const generic = parseProjectEntityCard({
      name: "kitchen stack cleaning",
      location: "building",
    });
    assert.equal(generic?.location, null);

    const specific = parseProjectEntityCard({
      name: "maglock",
      location: "unit 201",
    });
    assert.equal(specific?.location, "unit 201");
  });
});

describe("uniqueProjectHarvestCount", () => {
  it("counts unique cards, not name+phase+location marks", () => {
    const extraction = {
      ...emptyProjectHighlightExtraction(),
      project_names: ["kitchen stack cleaning"],
      phases: ["completed"],
      locations: ["building"],
    };
    const count = uniqueProjectHarvestCount(
      [
        card({
          name: "kitchen stack cleaning",
          phase: "completed",
          location: "building",
        }),
        card({
          name: "kitchen stack cleaning",
          phase: "completed",
          location: "building",
        }),
      ],
      extraction,
    );
    assert.equal(count, 1);
  });

  it("falls back to project names when there are no cards", () => {
    const extraction = {
      ...emptyProjectHighlightExtraction(),
      project_names: ["kitchen stack cleaning"],
      phases: ["completed"],
      locations: ["building"],
    };
    assert.equal(uniqueProjectHarvestCount([], extraction), 1);
  });
});
