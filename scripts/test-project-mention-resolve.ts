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
  projectMentionYearCompatible,
  shortlistProjectMentionCandidates,
  type ProjectLexicalCandidate,
  type ProjectMentionSearchDocument,
} from "../lib/projects/mention-resolve-shared";

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
});
