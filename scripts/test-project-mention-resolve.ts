/**
 * Project mention lexical shortlist + decision function.
 * Run: npx tsx --test scripts/test-project-mention-resolve.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyProjectMentionNameMatch,
  decideProjectMentionResolution,
  formatProjectMentionSearchDocument,
  projectMentionAnchorMatches,
  projectMentionMissingCanonicalAnchor,
  projectMentionYearCompatible,
  shortlistProjectMentionCandidates,
  type ProjectLexicalCandidate,
  type ProjectMentionQuery,
  type ProjectMentionSearchDocument,
} from "../lib/projects/mention-resolve-shared";
import {
  capitalProjectPromotionPatch,
  collectIncidentPromotionReasons,
} from "../lib/projects/project-promotion-shared";
import { resolveProjectAnchor } from "../lib/projects/project-anchor-resolve";
import {
  foldProjectNames,
  mergeProjectAliasLists,
} from "../lib/projects/project-multi-values";
import type { EquipmentRegistryDocument } from "../lib/equipment/mention-resolve-shared";

function doc(
  partial: Partial<ProjectMentionSearchDocument> & {
    id: string;
    name: string;
  },
): ProjectMentionSearchDocument {
  return {
    identityKey: partial.identityKey ?? `name:${partial.name.toLowerCase()}`,
    aliases: partial.aliases ?? [],
    contractor: partial.contractor ?? null,
    yearHint: partial.yearHint ?? null,
    location: partial.location ?? null,
    ...partial,
  };
}

function query(
  partial: Partial<ProjectMentionQuery> & { rawName: string },
): ProjectMentionQuery {
  return {
    contractor: partial.contractor ?? null,
    yearHint: partial.yearHint ?? null,
    location: partial.location ?? null,
    ...partial,
  };
}

function candidate(
  partial: Partial<ProjectLexicalCandidate> & { id: string },
): ProjectLexicalCandidate {
  return {
    nameMatch: "work",
    yearCompatible: true,
    score: 70,
    ...partial,
  };
}

describe("formatProjectMentionSearchDocument", () => {
  it("joins name, aliases, contractor, year, and location — not equipment", () => {
    const haystack = formatProjectMentionSearchDocument(
      doc({
        id: "p1",
        name: "Maglock installation",
        aliases: ["magnet", "electromagnetic locks"],
        contractor: "ABC Locks",
        yearHint: "2024",
        location: "front doors",
      }),
    );
    assert.match(haystack, /Maglock installation/);
    assert.match(haystack, /magnet/);
    assert.match(haystack, /ABC Locks/);
    assert.match(haystack, /2024/);
    assert.match(haystack, /front doors/);
    assert.doesNotMatch(haystack, /equipment/i);
  });
});

describe("classifyProjectMentionNameMatch", () => {
  const maglock = doc({
    id: "p1",
    name: "Maglock installation",
    aliases: ["magnet", "electromagnetic locks"],
    yearHint: "2024",
  });

  it("matches an exact canonical name", () => {
    assert.equal(
      classifyProjectMentionNameMatch("maglock installation", maglock),
      "exact",
    );
  });

  it("matches a stored alias (magnet → maglock)", () => {
    assert.equal(classifyProjectMentionNameMatch("Magnet", maglock), "alias");
  });

  it("matches a work-name variant without requiring an alias", () => {
    assert.equal(
      classifyProjectMentionNameMatch(
        "Maglock system",
        doc({ id: "p1", name: "Maglock installation", aliases: [] }),
      ),
      "work",
    );
  });

  it("does not treat a contractor name as a project name", () => {
    assert.equal(
      classifyProjectMentionNameMatch(
        "Otis",
        doc({
          id: "p1",
          name: "Elevator modernization",
          contractor: "Otis",
          yearHint: "2024",
        }),
      ),
      null,
    );
  });
});

describe("projectMentionYearCompatible", () => {
  it("treats a missing year on either side as compatible", () => {
    assert.equal(projectMentionYearCompatible(null, "2024"), true);
    assert.equal(projectMentionYearCompatible("2024", null), true);
  });

  it("rejects non-overlapping years", () => {
    assert.equal(projectMentionYearCompatible("2024", "2026"), false);
  });

  it("accepts overlapping ranges", () => {
    assert.equal(projectMentionYearCompatible("2024", "2024–2026"), true);
  });
});

describe("shortlistProjectMentionCandidates", () => {
  const maglock2024 = doc({
    id: "p2024",
    identityKey: "name:maglock|year:2024",
    name: "Maglock installation",
    aliases: ["magnet"],
    contractor: "ABC Locks",
    yearHint: "2024",
    location: "front doors",
  });
  const maglock2026 = doc({
    id: "p2026",
    identityKey: "name:maglock|year:2026",
    name: "Maglock installation",
    aliases: ["magnet"],
    yearHint: "2026",
  });
  const elevator = doc({
    id: "elev",
    name: "Elevator modernization",
    contractor: "Otis",
    yearHint: "2024",
  });

  it("returns magnet as an alias hit and keeps year-mismatched siblings in the shortlist", () => {
    const hits = shortlistProjectMentionCandidates(
      { rawName: "magnet", contractor: null, yearHint: "2024", location: null },
      [maglock2024, maglock2026, elevator],
    );
    assert.equal(hits.length, 2);
    assert.equal(hits[0]!.id, "p2024");
    assert.equal(hits[0]!.nameMatch, "alias");
    assert.equal(hits[0]!.yearCompatible, true);
    assert.equal(hits[1]!.id, "p2026");
    assert.equal(hits[1]!.yearCompatible, false);
  });

  it("does not shortlist a contractor-as-name mention", () => {
    const hits = shortlistProjectMentionCandidates(
      { rawName: "Otis", contractor: "Otis", yearHint: "2024", location: null },
      [maglock2024, elevator],
    );
    assert.equal(hits.length, 0);
  });

  it("caps the shortlist at five", () => {
    const docs = Array.from({ length: 8 }, (_, i) =>
      doc({
        id: `p${i}`,
        name: "Maglock installation",
        yearHint: String(2018 + i),
      }),
    );
    const hits = shortlistProjectMentionCandidates(
      {
        rawName: "Maglock installation",
        contractor: null,
        yearHint: null,
        location: null,
      },
      docs,
    );
    assert.equal(hits.length, 5);
  });
});

describe("decideProjectMentionResolution", () => {
  it("confirms a unique identity key before lexical evidence", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: ["p2024"],
      lexicalCandidates: [
        candidate({ id: "p2026", nameMatch: "exact" }),
      ],
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.projectId, "p2024");
    assert.equal(decision.reason, "unique_identity_key");
  });

  it("confirms a unique exact or alias hit after the year filter", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: [],
      lexicalCandidates: [
        candidate({
          id: "p2024",
          nameMatch: "alias",
          yearCompatible: true,
        }),
        candidate({
          id: "p2026",
          nameMatch: "alias",
          yearCompatible: false,
        }),
      ],
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.projectId, "p2024");
    assert.equal(decision.reason, "unique_name_or_alias");
  });

  it("prefers a unique alias over a work-name hit on a different card", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: [],
      lexicalCandidates: [
        candidate({ id: "roof", nameMatch: "alias", yearCompatible: true }),
        candidate({
          id: "membrane",
          nameMatch: "work",
          yearCompatible: true,
        }),
      ],
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.projectId, "roof");
    assert.equal(decision.reason, "unique_name_or_alias");
  });

  it("attaches a unique work-name hit provisionally", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: [],
      lexicalCandidates: [
        candidate({ id: "p1", nameMatch: "work", yearCompatible: true }),
      ],
    });
    assert.equal(decision.status, "provisional");
    assert.equal(decision.projectId, "p1");
    assert.equal(decision.reason, "unique_work_name_provisional");
  });

  it("leaves a yearless mention unresolved when two year-specific cards remain", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: [],
      lexicalCandidates: [
        candidate({ id: "p2024", nameMatch: "work", yearCompatible: true }),
        candidate({ id: "p2026", nameMatch: "work", yearCompatible: true }),
      ],
    });
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.projectId, null);
    assert.equal(decision.reason, "work_name_ambiguous");
  });

  it("does not attach when every lexical hit fails year overlap", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: [],
      lexicalCandidates: [
        candidate({ id: "p2026", nameMatch: "exact", yearCompatible: false }),
      ],
    });
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.reason, "year_mismatch");
  });

  it("does not attach on contractor-only / empty shortlist", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: [],
      lexicalCandidates: [],
    });
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.reason, "insufficient");
  });

  it("fails closed when an extracted anchor type has no canonical id", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: ["p1"],
      lexicalCandidates: [
        candidate({ id: "p1", nameMatch: "exact", yearCompatible: true }),
      ],
      missingAnchor: true,
    });
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.projectId, null);
    assert.equal(decision.reason, "ambiguous_equipment");
  });

  it("does not attach a public-parking door mention onto a residential door", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: [],
      lexicalCandidates: [
        candidate({
          id: "residential",
          nameMatch: "alias",
          yearCompatible: true,
          anchorCompatible: false,
        }),
      ],
    });
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.projectId, null);
    assert.equal(decision.reason, "anchor_mismatch");
  });

  it("rejects a completed project past the 90-day window", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: [],
      lexicalCandidates: [
        candidate({
          id: "p2024",
          nameMatch: "exact",
          yearCompatible: true,
          lifecycle: "completed_locked",
        }),
      ],
    });
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.projectId, null);
    assert.equal(decision.reason, "completed_locked");
  });

  it("attaches a trailing invoice inside 90 days with the same contractor and anchor", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: [],
      lexicalCandidates: [
        candidate({
          id: "p2024",
          nameMatch: "exact",
          yearCompatible: true,
          lifecycle: "trailing_invoice",
          isTrailingInvoice: true,
        }),
      ],
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.projectId, "p2024");
    assert.equal(decision.reason, "trailing_invoice_attached");
  });

  it("attaches a completed project when an explicit quote or PO matches", () => {
    const decision = decideProjectMentionResolution({
      uniqueIdentityMatches: [],
      lexicalCandidates: [
        candidate({
          id: "p2024",
          nameMatch: "alias",
          yearCompatible: false,
          lifecycle: "explicit_id",
        }),
      ],
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.projectId, "p2024");
    assert.equal(decision.reason, "unique_name_or_alias");
  });
});

describe("anchor discriminator", () => {
  const publicDoor = doc({
    id: "public",
    name: "Emergency Repair Work at Public Parking Garage Door",
    aliases: ["Quote #4092"],
    contractor: "Overhead Door Co.",
    yearHint: "2024",
    anchorType: "equipment",
    anchorId: "DOOR-PUBLIC-P1",
    equipmentIds: ["DOOR-PUBLIC-P1"],
  });
  const residentialDoor = doc({
    id: "residential",
    name: "Residential garage door repair",
    aliases: ["P2 sectional garage door replacement"],
    contractor: "Overhead Door Co.",
    yearHint: "2024",
    anchorType: "equipment",
    anchorId: "DOOR-RESIDENTIAL-P2",
    equipmentIds: ["DOOR-RESIDENTIAL-P2"],
  });

  it("treats a type without a canonical id as a missing anchor", () => {
    assert.equal(
      projectMentionMissingCanonicalAnchor({
        anchorType: "equipment",
        anchorId: null,
      }),
      true,
    );
    assert.equal(
      projectMentionMissingCanonicalAnchor({
        anchorType: "equipment",
        anchorId: "DOOR-PUBLIC-P1",
      }),
      false,
    );
  });

  it("matches bundled equipment_ids on a multi-asset contract", () => {
    const bundled = doc({
      id: "both",
      name: "P1 and P2 garage door overhaul",
      anchorType: "equipment",
      anchorId: "DOOR-PUBLIC-P1",
      equipmentIds: ["DOOR-PUBLIC-P1", "DOOR-RESIDENTIAL-P2"],
    });
    assert.equal(
      projectMentionAnchorMatches(
        { anchorType: "equipment", anchorId: "DOOR-RESIDENTIAL-P2" },
        bundled,
      ),
      true,
    );
  });

  it("does not let a residential door mention shortlist onto the public door", () => {
    const hits = shortlistProjectMentionCandidates(
      query({
        rawName: "Residential garage door repair",
        yearHint: "2024",
        anchorType: "equipment",
        anchorId: "DOOR-RESIDENTIAL-P2",
      }),
      [publicDoor, residentialDoor],
    );
    const compatible = hits.filter((hit) => hit.anchorCompatible);
    assert.equal(compatible.length, 1);
    assert.equal(compatible[0]!.id, "residential");
  });

  it("marks a completed job past 90 days as completed_locked", () => {
    const completed = doc({
      ...publicDoor,
      completedAt: "2024-01-01T00:00:00.000Z",
      phase: "complete",
    });
    const hits = shortlistProjectMentionCandidates(
      query({
        rawName: "Emergency Repair Work at Public Parking Garage Door",
        contractor: "Overhead Door Co.",
        yearHint: "2024",
        anchorType: "equipment",
        anchorId: "DOOR-PUBLIC-P1",
        mentionDate: "2024-06-01T00:00:00.000Z",
      }),
      [completed],
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.lifecycle, "completed_locked");
  });

  it("passes a same-contractor invoice inside the 90-day window", () => {
    const completed = doc({
      ...publicDoor,
      completedAt: "2024-01-01T00:00:00.000Z",
      phase: "complete",
    });
    const hits = shortlistProjectMentionCandidates(
      query({
        rawName: "Emergency Repair Work at Public Parking Garage Door",
        contractor: "Overhead Door Co.",
        yearHint: "2024",
        anchorType: "equipment",
        anchorId: "DOOR-PUBLIC-P1",
        mentionDate: "2024-03-15T00:00:00.000Z",
      }),
      [completed],
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.lifecycle, "trailing_invoice");
    assert.equal(hits[0]!.isTrailingInvoice, true);
  });

  it("passes a completed job when the mention cites Quote #4092 after 90 days", () => {
    const completed = doc({
      ...publicDoor,
      completedAt: "2024-01-01T00:00:00.000Z",
      phase: "complete",
    });
    const hits = shortlistProjectMentionCandidates(
      query({
        rawName: "Quote #4092",
        contractor: "Another Vendor",
        yearHint: "2024",
        anchorType: "equipment",
        anchorId: "DOOR-PUBLIC-P1",
        mentionDate: "2024-08-01T00:00:00.000Z",
      }),
      [completed],
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.lifecycle, "explicit_id");
  });
});

describe("collectIncidentPromotionReasons", () => {
  it("promotes on two quotes, a board package, or a >30 day span", () => {
    assert.deepEqual(
      collectIncidentPromotionReasons({
        quoteOrRfpCount: 2,
        boardReportCount: 0,
        mentionEmailCount: 1,
        firstMentionAt: "2024-01-01",
        lastMentionAt: "2024-01-01",
      }),
      ["multiple_quotes"],
    );
    assert.deepEqual(
      collectIncidentPromotionReasons({
        quoteOrRfpCount: 0,
        boardReportCount: 1,
        mentionEmailCount: 1,
        firstMentionAt: "2024-01-01",
        lastMentionAt: "2024-01-01",
      }),
      ["board_briefed"],
    );
    assert.deepEqual(
      collectIncidentPromotionReasons({
        quoteOrRfpCount: 0,
        boardReportCount: 0,
        mentionEmailCount: 2,
        firstMentionAt: "2024-01-01T00:00:00.000Z",
        lastMentionAt: "2024-02-15T00:00:00.000Z",
      }),
      ["duration_over_30_days"],
    );
  });

  it("does not promote a single-visit service call", () => {
    assert.deepEqual(
      collectIncidentPromotionReasons({
        quoteOrRfpCount: 1,
        boardReportCount: 0,
        mentionEmailCount: 1,
        firstMentionAt: "2024-01-01",
        lastMentionAt: "2024-01-10",
      }),
      [],
    );
  });

  it("writes only tier and reasons — mention foreign keys stay put", () => {
    const patch = capitalProjectPromotionPatch(
      ["multiple_quotes", "board_briefed"],
      "2024-06-01T00:00:00.000Z",
    );
    assert.equal(patch.tier, "capital_project");
    assert.equal(
      patch.promotionReasonsJson,
      JSON.stringify(["multiple_quotes", "board_briefed"]),
    );
    assert.equal(patch.updatedAt, "2024-06-01T00:00:00.000Z");
    assert.equal("resolvedProjectId" in patch, false);
  });
});

describe("Pass A: Project mention anchor resolution & alias hygiene", () => {
  const sampleRegistry: EquipmentRegistryDocument[] = [
    {
      id: "DOOR-PUBLIC-P1",
      canonicalName: "Public Parking Garage Overhead Door (P1)",
      category: "door",
      floor: -1,
      location: "P1 Parking / Commercial Entrance",
      aliases: [
        "public parking garage door",
        "public garage door",
        "p1 garage door",
        "visitor gate",
      ],
      componentKeywords: ["photo-eye", "photo eye", "counterweight", "safety edge"],
      status: "active",
    },
    {
      id: "DOOR-RES-P2",
      canonicalName: "Residential Parking Garage Overhead Door (P2)",
      category: "door",
      floor: -2,
      location: "P2 Parking Entrance",
      aliases: [
        "residential garage door",
        "residential overhead door",
        "p2 garage door",
      ],
      componentKeywords: ["torsion spring", "door track", "rollers"],
      status: "active",
    },
    {
      id: "PUMP-DOM-BOOST-DUP",
      canonicalName: "Domestic Cold Water Booster Pump Duplex System",
      category: "pump",
      floor: -1,
      location: "P1 Domestic Water Pump Room",
      aliases: ["domestic booster pump", "booster pump duplex system"],
      componentKeywords: ["impeller", "mechanical seal", "vfd"],
      status: "active",
    },
  ];

  it("resolves explicit equipment_mentions to canonical ID", () => {
    const res = resolveProjectAnchor(
      {
        rawName: "Repair Work on Visitor Gate",
        equipmentMentions: "visitor gate",
      },
      sampleRegistry,
    );
    assert.equal(res.extractedAnchorType, "equipment");
    assert.equal(res.extractedAnchorHint, "visitor gate");
    assert.equal(res.resolvedAnchorId, "DOOR-PUBLIC-P1");
  });

  it("maps component mention to parent equipment asset", () => {
    const res = resolveProjectAnchor(
      {
        rawName: "Replace broken photo eye",
        equipmentMentions: "photo-eye",
      },
      sampleRegistry,
    );
    assert.equal(res.extractedAnchorType, "equipment");
    assert.equal(res.extractedAnchorHint, "photo-eye");
    assert.equal(res.resolvedAnchorId, "DOOR-PUBLIC-P1");
  });

  it("fails closed with null resolvedAnchorId when equipment is ambiguous", () => {
    const res = resolveProjectAnchor(
      {
        rawName: "Garage door repair",
        equipmentMentions: "garage door",
        location: null,
      },
      sampleRegistry,
    );
    assert.equal(res.extractedAnchorType, "equipment");
    assert.equal(res.extractedAnchorHint, "garage door");
    assert.equal(res.resolvedAnchorId, null);
  });

  it("disambiguates generic equipment when location is present", () => {
    const res = resolveProjectAnchor(
      {
        rawName: "Garage door repair",
        equipmentMentions: "garage door",
        location: "P1 parking",
      },
      sampleRegistry,
    );
    assert.equal(res.extractedAnchorType, "equipment");
    assert.equal(res.resolvedAnchorId, "DOOR-PUBLIC-P1");
  });

  it("falls back to project rawName when equipment_mentions is missing", () => {
    const res = resolveProjectAnchor(
      {
        rawName: "Emergency repair work at Public Parking Garage Door",
      },
      sampleRegistry,
    );
    assert.equal(res.extractedAnchorType, "equipment");
    assert.equal(res.resolvedAnchorId, "DOOR-PUBLIC-P1");
  });

  it("returns null anchor fields for non-equipment projects", () => {
    const res = resolveProjectAnchor(
      {
        rawName: "Reserve Fund Study 2024",
      },
      sampleRegistry,
    );
    assert.equal(res.extractedAnchorType, null);
    assert.equal(res.extractedAnchorHint, null);
    assert.equal(res.resolvedAnchorId, null);
  });

  it("mergeProjectAliasLists filters out operational action phrases", () => {
    const aliases = mergeProjectAliasLists("Public Parking Garage Door", [
      "P1 Overhead Door",
      "Emergency repair work at public parking garage door",
      "Service call for broken gate",
      "Visitor Gate",
    ]);
    assert.deepEqual(aliases, ["P1 Overhead Door", "Visitor Gate"]);
  });

  it("foldProjectNames with includeOtherAsAlias: false does not turn raw other name into alias", () => {
    const folded = foldProjectNames({
      preferredName: "Public Parking Garage Door Modernization",
      otherName: "Public Parking Garage Door Repair",
      preferredAliases: ["P1 Door Overhaul"],
      includeOtherAsAlias: false,
    });
    assert.equal(folded.name, "Public Parking Garage Door Modernization");
    assert.deepEqual(folded.aliases, ["P1 Door Overhaul"]);
  });
});
