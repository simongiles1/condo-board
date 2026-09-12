/**
 * Gold-standard concept compare: flatten, align leftovers, parse v1+v2.
 * Run: npx tsx --test scripts/test-gold-standard-compare.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAiMinutesConcepts } from "../lib/minutes/gold-standard-ai-concepts";
import {
  completeAlignments,
  deriveBidirectionalFindings,
  displaySegmentMark,
  findingColumn,
  findingsForAlignmentColumn,
  needsSpaceBetweenCompareSegments,
  repairCompareSegmentBoundaries,
  scoreCompareDocument,
} from "../lib/minutes/gold-standard-compare";
import { buildGoldStandardFindingsByItemId } from "../lib/minutes/gold-standard-item-match";
import {
  parseStoredGoldStandardValidation,
  serializeGoldStandardValidation,
  type CompareAlignment,
  type GoldStandardValidationResult,
} from "../lib/minutes/gold-standard-schema";
import { wrapMinutesV2, type MinutesDocumentV2 } from "../lib/minutes/schema-v2";

function sampleMinutes(): MinutesDocumentV2 {
  return {
    metadata: {
      corporationName: "Test Corp",
      meetingDate: "2026-08-12",
      meetingTime: "6:30 p.m.",
    },
    attendance: {
      present: [{ name: "A. Smith", titleOrRole: "President" }],
      byInvitation: [],
      guests: [],
      regrets: [],
    },
    specialPresentations: [],
    approvalOfPreviousMinutes: [],
    financialMatters: [],
    managementReport: {
      itemsForRatification: [],
      itemsForApproval: [
        {
          topic: "Booster pump replacement",
          summary:
            "The Board approved the booster pump replacement with New Water Plumbing at a total cost of $163,000 plus HST.",
          actionItems: [],
          subItems: [],
          motion: {
            movedBy: "A. Smith",
            secondedBy: "B. Jones",
            resolutionText:
              "New Water Plumbing be approved to proceed with the booster pump replacement at a total cost of $163,000 plus HST.",
            status: "Motion carried.",
          },
        },
      ],
      itemsForInformation: [],
      itemsForDiscussion: [],
    },
    correspondence: [],
    newOrOtherBusiness: [],
    postTerminationSections: [],
  };
}

describe("buildAiMinutesConcepts", () => {
  it("flattens attendance and agenda items from v2 minutes", () => {
    const json = JSON.stringify(wrapMinutesV2(sampleMinutes()));
    const concepts = buildAiMinutesConcepts(json, [
      { id: "item-booster", title: "Booster Pump Replacement", itemNumber: "4.B.1" },
    ]);
    assert.ok(concepts.some((row) => row.kind === "attendance"));
    const booster = concepts.find((row) => /booster/i.test(row.heading));
    assert.ok(booster);
    assert.match(booster.body, /163,000/);
    assert.deepEqual(booster.agendaItemIds, ["item-booster"]);
  });
});

describe("completeAlignments", () => {
  it("keeps model matches and emits unmatched leftovers", () => {
    const gold = [
      { id: "g1", heading: "Booster pump", body: "Approved $163k.", kind: "agenda_item" as const, sortOrder: 0 },
      { id: "g2", heading: "Gym etiquette", body: "Discussed signs.", kind: "agenda_item" as const, sortOrder: 1 },
    ];
    const ai = [
      {
        id: "a1",
        heading: "Booster pump replacement",
        body: "Approved $163,000.",
        kind: "agenda_item" as const,
        sortOrder: 0,
        agendaItemIds: ["item-booster"],
      },
    ];
    const raw: CompareAlignment[] = [
      {
        id: "align-1",
        kind: "1:1",
        goldConceptIds: ["g1"],
        aiConceptIds: ["a1"],
        confidence: "high",
        label: "Booster pump",
      },
    ];
    const completed = completeAlignments(gold, ai, raw);
    assert.equal(completed.length, 2);
    assert.equal(completed[0]?.kind, "1:1");
    assert.equal(completed[1]?.kind, "gold_only");
    assert.deepEqual(completed[1]?.goldConceptIds, ["g2"]);
  });
});

describe("compare_v2 persistence", () => {
  it("round-trips compare_v2 and still parses validation_v1", () => {
    const v1 = parseStoredGoldStandardValidation(
      JSON.stringify({
        schema_version: "validation_v1",
        analyzed_at: "2026-09-12T00:00:00.000Z",
        validation_score: 81,
        score_rationale: "Mostly aligned.",
        generated_only: [],
        gold_only: [
          {
            id: "f1",
            topic: "Gym",
            detail: "Gold noted gym signage.",
            significance: "minor",
          },
        ],
      }),
    );
    assert.equal(v1?.schemaVersion, "validation_v1");
    assert.equal(v1?.goldOnly[0]?.topic, "Gym");
    assert.equal(v1?.compare, undefined);

    const result: GoldStandardValidationResult = {
      schemaVersion: "compare_v2",
      analyzedAt: "2026-09-12T12:00:00.000Z",
      validationScore: 88,
      scoreRationale: "One unmatched gold concept.",
      generatedOnly: [],
      goldOnly: [
        {
          id: "f2",
          topic: "Gym etiquette",
          detail: "Present in gold with no AI counterpart.",
          significance: "moderate",
        },
      ],
      compare: {
        goldConcepts: [
          { id: "g1", heading: "Booster", body: "Approved.", kind: "agenda_item", sortOrder: 0 },
          { id: "g2", heading: "Gym etiquette", body: "Signs.", kind: "agenda_item", sortOrder: 1 },
        ],
        aiConcepts: [
          {
            id: "a1",
            heading: "Booster",
            body: "Approved.",
            kind: "agenda_item",
            sortOrder: 0,
            agendaItemIds: ["item-booster"],
          },
        ],
        alignments: [
          {
            id: "al1",
            kind: "1:1",
            goldConceptIds: ["g1"],
            aiConceptIds: ["a1"],
            confidence: "high",
            label: "Booster",
          },
          {
            id: "al2",
            kind: "gold_only",
            goldConceptIds: ["g2"],
            aiConceptIds: [],
            confidence: "high",
            label: "Gym etiquette",
          },
        ],
        pairs: [
          {
            alignmentId: "al1",
            pairScore: 96,
            goldSegments: [{ text: "Approved.", mark: "same" }],
            aiSegments: [{ text: "Approved.", mark: "same" }],
            findings: [],
          },
          {
            alignmentId: "al2",
            pairScore: 35,
            goldSegments: [{ text: "Signs.", mark: "omitted" }],
            aiSegments: [],
            findings: [
              {
                id: "f2",
                topic: "Gym etiquette",
                detail: "Present in gold with no AI counterpart.",
                significance: "moderate",
              },
            ],
          },
        ],
      },
    };

    const parsed = parseStoredGoldStandardValidation(
      serializeGoldStandardValidation(result),
    );
    assert.equal(parsed?.schemaVersion, "compare_v2");
    assert.equal(parsed?.compare?.alignments.length, 2);
    assert.equal(parsed?.compare?.pairs[1]?.goldSegments[0]?.mark, "omitted");

    const findings = buildGoldStandardFindingsByItemId(
      [{ id: "item-booster", title: "Booster pump replacement" }],
      parsed!.generatedOnly,
      parsed!.goldOnly,
      parsed,
    );
    assert.equal(findings.get("item-booster")?.goldOnly.length ?? 0, 0);

    const gymFindings = buildGoldStandardFindingsByItemId(
      [{ id: "item-gym", title: "Gym etiquette" }],
      parsed!.generatedOnly,
      parsed!.goldOnly,
      parsed,
    );
    assert.equal(gymFindings.get("item-gym")?.goldOnly[0]?.topic, "Gym etiquette");
  });
});

describe("scoreCompareDocument", () => {
  it("averages pair scores without stacking a critical-finding penalty", () => {
    const scored = scoreCompareDocument({
      goldConcepts: [],
      aiConcepts: [],
      alignments: [
        {
          id: "a",
          kind: "1:1",
          goldConceptIds: ["g"],
          aiConceptIds: ["ai"],
          confidence: "high",
          label: "A",
        },
        {
          id: "b",
          kind: "gold_only",
          goldConceptIds: ["g2"],
          aiConceptIds: [],
          confidence: "high",
          label: "B",
        },
      ],
      pairs: [
        {
          alignmentId: "a",
          pairScore: 90,
          goldSegments: [],
          aiSegments: [],
          findings: [
            {
              id: "c1",
              topic: "Motion",
              detail: "Motion wording differs.",
              significance: "critical",
            },
          ],
        },
        {
          alignmentId: "b",
          pairScore: 35,
          goldSegments: [],
          aiSegments: [],
          findings: [],
        },
      ],
    });
    assert.equal(scored.validationScore, 63);
  });
});

describe("repairCompareSegmentBoundaries", () => {
  it("inserts a space between adjacent spans when the model omitted it", () => {
    const repaired = repairCompareSegmentBoundaries([
      { text: "1. Call to Order", mark: "same" },
      { text: "Proper notice was given.", mark: "omitted" },
    ]);
    assert.equal(repaired[1]?.text, " Proper notice was given.");
    assert.equal(
      repaired.map((segment) => segment.text).join(""),
      "1. Call to Order Proper notice was given.",
    );
  });

  it("does not double spaces already present on a boundary", () => {
    const repaired = repairCompareSegmentBoundaries([
      { text: "Order ", mark: "same" },
      { text: "Proper", mark: "changed" },
    ]);
    assert.equal(repaired[1]?.text, "Proper");
  });
});

describe("needsSpaceBetweenCompareSegments", () => {
  it("skips punctuation boundaries", () => {
    assert.equal(needsSpaceBetweenCompareSegments("carried", "."), false);
  });
});

describe("displaySegmentMark", () => {
  it("keeps short formal motion lines and demotes whole-paragraph motion paint", () => {
    assert.equal(
      displaySegmentMark(
        "motion",
        "**THAT IT BE DULY RATIFIED** that the proposal be approved. Motion carried.",
      ),
      "motion",
    );
    assert.equal(
      displaySegmentMark(
        "motion",
        `${"The Board considered the ratification of email decisions. ".repeat(8)} MOTION by S. Greenspan. THAT IT BE DULY RATIFIED that the work proceed.`,
      ),
      "changed",
    );
  });
});

describe("findingsForAlignmentColumn", () => {
  it("keeps ai_only findings on the AI column only", () => {
    const alignment: CompareAlignment = {
      id: "a1",
      kind: "ai_only",
      goldConceptIds: [],
      aiConceptIds: ["ai"],
      confidence: "high",
      label: "Not discussed",
    };
    const findings = [
      {
        id: "f",
        topic: "Not discussed",
        detail: "Present in the AI minutes with no matching gold-standard concept.",
        significance: "moderate" as const,
      },
    ];
    assert.equal(findingsForAlignmentColumn(alignment, findings, "ai").length, 1);
    assert.equal(findingsForAlignmentColumn(alignment, findings, "gold").length, 0);
  });
});

describe("findingColumn", () => {
  it("puts AI-adds notes on the AI side and AI-omits notes on gold", () => {
    assert.equal(
      findingColumn({
        id: "1",
        topic: "Tender",
        detail: "AI adds specific tender details, including Ambient Mechanical.",
        significance: "moderate",
      }),
      "ai",
    );
    assert.equal(
      findingColumn({
        id: "2",
        topic: "Legal fees",
        detail: "AI omits that the legal fees for the contract review are a Reserve Fund cost.",
        significance: "moderate",
      }),
      "gold",
    );
  });
});

describe("deriveBidirectionalFindings", () => {
  it("puts gold-only pair findings in goldOnly", () => {
    const derived = deriveBidirectionalFindings({
      goldConcepts: [],
      aiConcepts: [],
      alignments: [
        {
          id: "al2",
          kind: "gold_only",
          goldConceptIds: ["g2"],
          aiConceptIds: [],
          confidence: "high",
          label: "Gym",
        },
      ],
      pairs: [
        {
          alignmentId: "al2",
          pairScore: 35,
          goldSegments: [{ text: "Signs.", mark: "omitted" }],
          aiSegments: [],
          findings: [
            {
              id: "f",
              topic: "Gym",
              detail: "Present in gold.",
              significance: "moderate",
            },
          ],
        },
      ],
    });
    assert.equal(derived.goldOnly.length, 1);
    assert.equal(derived.generatedOnly.length, 0);
  });
});
