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
  expandProjectNameNeedles,
  findNeedleRanges,
  isThinProjectEvidenceBody,
  projectCardMatchesEvidenceValue,
  projectHighlightMatchesEvidenceValue,
  splitProjectEvidenceNeedles,
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

describe("expandProjectNameNeedles", () => {
  it("strips action suffix 'replacement' to yield core noun phrase", () => {
    const needles = expandProjectNameNeedles("TNR garage door replacement");
    assert.ok(needles.includes("TNR garage door replacement"));
    assert.ok(needles.includes("TNR garage door"));
  });

  it("handles dash-separated repair descriptors", () => {
    const needles = expandProjectNameNeedles(
      "West Side Loading Bay Door - Scheduled Repairs",
    );
    assert.ok(
      needles.includes("West Side Loading Bay Door - Scheduled Repairs"),
    );
    assert.ok(needles.includes("West Side Loading Bay Door"));
  });

  it("strips action prefix 'installation of a new'", () => {
    const needles = expandProjectNameNeedles(
      "installation of a new TNR overhead garage door",
    );
    assert.ok(
      needles.includes("installation of a new TNR overhead garage door"),
    );
    assert.ok(needles.includes("TNR overhead garage door"));
  });

  it("decomposes parenthetical abbreviations and suffix", () => {
    const needles = expandProjectNameNeedles(
      "Public Parking Overhead Door (OHD) Installation",
    );
    assert.ok(
      needles.includes("Public Parking Overhead Door (OHD) Installation"),
    );
    assert.ok(needles.includes("Public Parking Overhead Door"));
    assert.ok(needles.includes("OHD"));
  });
});

describe("alias evidence highlighting in email text", () => {
  it("highlights 'TNR garage door' when alias is 'TNR garage door replacement'", () => {
    const needles = splitProjectEvidenceNeedles(
      "name_alias",
      "TNR garage door replacement",
    );
    assert.ok(needles.includes("TNR garage door"));

    const email1 =
      "Hello Directors, Kindly see the revised proposal for installation of the new public parking TNR garage door. The approve...";
    const ranges1 = findNeedleRanges(email1, needles);
    assert.equal(ranges1.length, 1);
    assert.equal(
      email1.slice(ranges1[0]!.start, ranges1[0]!.end),
      "TNR garage door",
    );

    const email2 =
      "Good Afternoon Directors,\n\n* I have taken TNR Garage door quotes and provided to John to take approval from studio-1 and Studio-2 Boards.";
    const ranges2 = findNeedleRanges(email2, needles);
    assert.equal(ranges2.length, 1);
    assert.equal(
      email2.slice(ranges2[0]!.start, ranges2[0]!.end),
      "TNR Garage door",
    );
  });

  it("matches pass-1 project_names extraction using expanded alias needles", () => {
    const extraction = {
      project_names: ["TNR garage door"],
      year_hints: [],
      phases: [],
      contractors: [],
      locations: [],
    };
    assert.equal(
      projectHighlightMatchesEvidenceValue(
        extraction,
        "name_alias",
        "TNR garage door replacement",
      ),
      true,
    );
  });
});
