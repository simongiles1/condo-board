/**
 * Project field evidence matching (alias fold + highlight).
 * Run: npx tsx --test scripts/test-project-field-evidence.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findCaseInsensitiveRanges,
  collectProjectIdentityNeedles,
  collectProjectSourceNeedles,
  emailBelongsInProjectSourceEvidence,
  findNeedleRanges,
  isThinProjectEvidenceBody,
  projectCardMatchesEvidenceValue,
  projectHighlightMatchesEvidenceValue,
} from "../lib/projects/registry-evidence-shared";

describe("projectCardMatchesEvidenceValue", () => {
  it("matches an alias that was originally a card name", () => {
    const card = {
      name: "Maglock upgrade",
      year_hint: "2024",
      phase: "tender",
      contractor: "ABC Lock",
      location: "front doors",
      equipment_mentions: "maglock",
      aliases: [],
    };
    assert.equal(
      projectCardMatchesEvidenceValue(card, "name_alias", "Maglock upgrade"),
      true,
    );
    assert.equal(
      projectCardMatchesEvidenceValue(card, "contractor", "ABC Lock"),
      true,
    );
  });

  it("matches a folded alias on the survivor card", () => {
    const card = {
      name: "Maglock 2024",
      year_hint: "2024-25",
      phase: null,
      contractor: null,
      location: null,
      equipment_mentions: null,
      aliases: ["Front door maglocks", "Maglock upgrade"],
    };
    assert.equal(
      projectCardMatchesEvidenceValue(card, "name_alias", "Maglock upgrade"),
      true,
    );
    assert.equal(
      projectCardMatchesEvidenceValue(card, "name", "Maglock upgrade"),
      false,
    );
    assert.equal(
      projectCardMatchesEvidenceValue(card, "year_hint", "2024"),
      true,
    );
  });
});

describe("projectHighlightMatchesEvidenceValue", () => {
  it("treats pass-1 project_names as alias evidence", () => {
    const extraction = {
      project_names: ["Maglock upgrade", "EV charging"],
      year_hints: ["FY2024"],
      phases: ["tender"],
      contractors: ["ABC Lock"],
      locations: ["P1"],
    };
    assert.equal(
      projectHighlightMatchesEvidenceValue(
        extraction,
        "name_alias",
        "Maglock upgrade",
      ),
      true,
    );
    assert.equal(
      projectHighlightMatchesEvidenceValue(extraction, "year_hint", "2024"),
      true,
    );
    assert.equal(
      projectHighlightMatchesEvidenceValue(
        extraction,
        "equipment_mentions",
        "maglock",
      ),
      false,
    );
  });
});

describe("findCaseInsensitiveRanges", () => {
  it("finds the project name in authored text", () => {
    const ranges = findCaseInsensitiveRanges(
      "Please quote the Maglock upgrade for the lobby.",
      "maglock upgrade",
    );
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0]?.start, 17);
  });
});

describe("collectProjectIdentityNeedles", () => {
  it("ignores contractor when deciding project identity", () => {
    const needles = collectProjectIdentityNeedles({
      name: null,
      aliases: [],
    });
    assert.deepEqual(needles, []);
  });

  it("uses the work-name and aliases only", () => {
    const needles = collectProjectIdentityNeedles({
      name: "riser replacement",
      aliases: ["riser work"],
    });
    assert.deepEqual(needles, ["riser replacement", "riser work"]);
  });
});

describe("collectProjectSourceNeedles", () => {
  it("still highlights contractor on a named project", () => {
    const needles = collectProjectSourceNeedles({
      name: "riser replacement",
      displayName: "riser replacement (2026)",
      aliases: [],
      phase: null,
      contractor: "Applied System Technology",
      location: null,
      equipment_mentions: null,
    });
    assert.ok(needles.includes("Applied System Technology"));
    assert.ok(needles.includes("riser replacement"));
  });
});

describe("project source-email attribution", () => {
  it("drops a signature stub even if it was on the thread", () => {
    assert.equal(isThinProjectEvidenceBody("Shawna"), true);
    assert.equal(
      emailBelongsInProjectSourceEvidence({
        authoredBody: "Shawna",
        pass3CardMatches: true,
        identityNeedles: ["riser replacement"],
      }),
      false,
    );
  });

  it("keeps a pass-3 match with a real body", () => {
    assert.equal(
      emailBelongsInProjectSourceEvidence({
        authoredBody:
          "We contacted Applied System Technology regarding the work scheduled for today.",
        pass3CardMatches: true,
        identityNeedles: ["riser replacement"],
      }),
      true,
    );
  });

  it("includes an email that names the work even without a pass-3 card", () => {
    assert.equal(
      emailBelongsInProjectSourceEvidence({
        authoredBody:
          "Please confirm the schedule for the riser replacement on Thursday.",
        pass3CardMatches: false,
        identityNeedles: ["riser replacement"],
      }),
      true,
    );
  });

  it("does not include contractor-only mentions as identity evidence", () => {
    assert.equal(
      emailBelongsInProjectSourceEvidence({
        authoredBody:
          "We contacted Applied System Technology regarding the work scheduled for today.",
        pass3CardMatches: false,
        identityNeedles: ["riser replacement"],
      }),
      false,
    );
  });
});

describe("findNeedleRanges", () => {
  it("keeps the longer overlapping hit", () => {
    const ranges = findNeedleRanges(
      "Applied System Technology quoted the riser work.",
      ["Applied System", "Applied System Technology"],
    );
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0]?.start, 0);
    assert.equal(ranges[0]?.end, "Applied System Technology".length);
  });
});
