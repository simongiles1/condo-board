/**
 * V4 coverage, reply parsing, and assembly.
 * Run: npx tsx --test scripts/test-meeting-v4.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agendaTextForItem,
  buildAgendaExtracts,
  resolveAgendaSourcePages,
  selectCorrectedPageText,
} from "../lib/meeting-v4/agenda-text";
import { assembleMeetingsV4Minutes } from "../lib/meeting-v4/assemble";
import { MEETINGS_V4_PIPELINE_PROMPT_TABS, MEETINGS_V4_RESTRICTED_CLASSIFICATION_PROMPT } from "../lib/meeting-v4/pipeline-prompts";
import { minutesJsonForGoldCompare } from "../lib/meeting-v4/workspace";
import { buildAiMinutesConcepts } from "../lib/minutes/gold-standard-ai-concepts";
import { bundleCuesForItem, inventoryMeetingsV4 } from "../lib/meeting-v4/inventory";
import {
  buildMeetingsV4DraftUserPayload,
  meetingsV4DraftFullCallMarkdown,
  meetingsV4DraftTranscriptMarkdown,
} from "../lib/meeting-v4/draft-payload";
import { MEETINGS_V4_DRAFT_PROMPT, readMeetingsV4Draft } from "../lib/meeting-v4/prompt";
import type { MeetingsV4AssemblyItem } from "../lib/meeting-v4/assemble";
import { RESTRICTED_ADDENDUM_TITLE } from "../lib/minutes/restricted-addendum-boilerplate";

const cues = [
  { index: 0, start: "00:00:00.000", end: "00:00:02.000", speaker: "Ada", text: "Opening." },
  { index: 1, start: "00:00:02.000", end: "00:00:04.000", speaker: "Ben", text: "Booster pump." },
  { index: 2, start: "00:00:04.000", end: "00:00:06.000", speaker: "Ada", text: "Unassigned middle." },
  { index: 3, start: "00:10:00.000", end: "00:10:04.000", speaker: "Ben", text: "Return to the pump." },
];

describe("v4 inventory", () => {
  it("lists a later return, an unassigned cue, and a leaf with no span", () => {
    const inventory = inventoryMeetingsV4({
      items: [
        { id: "sec", itemNumber: "4", title: "Management" },
        { id: "pump", itemNumber: "4.A", title: "Booster pump" },
        { id: "open", itemNumber: "4.B", title: "Open item" },
      ],
      cues,
      spans: [
        { agendaItemId: "pump", startCueIndex: 1, endCueIndex: 1, startSeconds: 2, endSeconds: 4 },
        { agendaItemId: "pump", startCueIndex: 3, endCueIndex: 3, startSeconds: 600, endSeconds: 604 },
      ],
    });
    const pump = inventory.items.find((item) => item.id === "pump");
    assert.equal(pump?.returnCount, 1);
    assert.equal(pump?.cueCount, 2);
    assert.equal(inventory.items.find((item) => item.id === "sec")?.heading, true);
    assert.deepEqual(inventory.missingLeaves.map((item) => item.id), ["open"]);
    assert.deepEqual(inventory.unassignedCues.map((cue) => cue.index), [0, 2]);
    assert.equal(inventory.overlappingCues.length, 0);
    assert.equal(bundleCuesForItem("pump", cues, [
      { agendaItemId: "pump", startCueIndex: 1, endCueIndex: 1, startSeconds: 2, endSeconds: 4 },
      { agendaItemId: "pump", startCueIndex: 3, endCueIndex: 3, startSeconds: 600, endSeconds: 604 },
    ]).map((cue) => cue.speaker).join(","), "Ben,Ben");
  });

  it("flags a cue assigned to two items", () => {
    const inventory = inventoryMeetingsV4({
      items: [
        { id: "a", itemNumber: "1", title: "One" },
        { id: "b", itemNumber: "2", title: "Two" },
      ],
      cues,
      spans: [
        { agendaItemId: "a", startCueIndex: 1, endCueIndex: 2, startSeconds: 2, endSeconds: 6 },
        { agendaItemId: "b", startCueIndex: 2, endCueIndex: 2, startSeconds: 4, endSeconds: 6 },
      ],
    });
    assert.equal(inventory.overlappingCues.length, 1);
    assert.deepEqual(inventory.overlappingCues[0]?.itemNumbers.sort(), ["1", "2"]);
  });
});

describe("v4 agenda text", () => {
  it("prefers V3-linked source pages over empty V2 pages", () => {
    const v3Rows = [{ itemNumber: "4.A", title: "Booster pump", sourcePagesJson: "[4]" }];
    const corrected = new Map([[4, "clean table"]]);
    assert.deepEqual(
      resolveAgendaSourcePages({
        itemNumber: "4.A",
        title: "Booster pump",
        v2Pages: [],
        v3Rows,
        correctedPages: corrected,
      }),
      [4],
    );
  });

  it("matches V3 pages by title when V2 and V3 item numbers differ", () => {
    const v3Rows = [{
      itemNumber: "1",
      title: "Booster Pump Replacement – Base Specification and Alternative Options",
      sourcePagesJson: "[4]",
    }];
    const corrected = new Map([[4, "clean table"]]);
    assert.deepEqual(
      resolveAgendaSourcePages({
        itemNumber: "4.A",
        title: "Booster Pump Replacement",
        v2Pages: [],
        v3Rows,
        correctedPages: corrected,
      }),
      [4],
    );
  });

  it("prefers the V3 link whose pages have corrected rewrites", () => {
    const v3Rows = [
      { itemNumber: "x", title: "Booster Pump Replacement", sourcePagesJson: "[18]" },
      { itemNumber: "1", title: "Booster Pump Replacement – Base Specification", sourcePagesJson: "[4]" },
    ];
    const corrected = new Map([[4, "clean table"]]);
    assert.deepEqual(
      resolveAgendaSourcePages({
        itemNumber: "4.A",
        title: "Booster Pump Replacement",
        v2Pages: [],
        v3Rows,
        correctedPages: corrected,
      }),
      [4],
    );
  });

  it("sends corrected text before Docling and keeps Docling separate", () => {
    const extracts = buildAgendaExtracts({
      sourcePages: [4],
      correctedPages: new Map([
        [4, "| Total Bid Amount based on Alternative | NWP $163,900.00 | ABM $179,600.00 |"],
      ]),
      doclingPages: new Map([
        [4, "| Total Bid Amount | $179,994.00 $152,844.00 $163,900.00 $179,600.00 $218,900.00 |"],
      ]),
      fallback: "Amount: $214,194.00 plus HST.",
    });
    assert.match(extracts.sent, /\$163,900\.00/);
    assert.match(extracts.sent, /\$179,600\.00/);
    assert.equal(extracts.sent.includes("$214,194.00"), false);
    assert.match(extracts.docling, /\$218,900\.00/);
    assert.equal(extracts.docling.includes("$214,194.00"), false);
    assert.match(extracts.corrected, /\$179,600\.00/);
    assert.equal(extracts.corrected.includes("$218,900.00"), false);
  });

  it("sends the corrected page extract, including a table figure missing from the notes", () => {
    const text = agendaTextForItem({
      sourcePages: [4],
      pageText: new Map([
        [4, "Total Bid Amount based on Alternative | NWP $163,900.00"],
      ]),
      fallback: "Amount: $214,194.00 plus HST. The transcript said 163.",
    });
    assert.match(text, /\$163,900\.00/);
    assert.equal(text.includes("$214,194.00"), false);
  });

  it("keeps the stored notes when no corrected page is available", () => {
    const text = agendaTextForItem({
      sourcePages: [],
      pageText: new Map(),
      fallback: "Amount: $214,194.00 plus HST.",
    });
    assert.equal(text, "Amount: $214,194.00 plus HST.");
  });

  it("uses the same-date package whose pages match when this meeting has no rewrites", () => {
    const ownDocling = new Map([[4, "docling page 4"]]);
    const shortPackage = {
      doclingByPage: ownDocling,
      correctedByPage: new Map([[4, "short correction"]]),
    };
    const fullPackage = {
      doclingByPage: new Map([
        [4, "docling page 4"],
        [29, "attachment"],
      ]),
      correctedByPage: new Map([
        [4, "Ambient Mechanical table"],
        [29, "attachment correction"],
      ]),
    };
    const selected = selectCorrectedPageText({
      ownDocling,
      ownCorrected: new Map(),
      donors: [shortPackage, fullPackage],
    });
    assert.equal(selected.get(4), "Ambient Mechanical table");
    assert.equal(selected.has(29), false);
  });

  it("keeps this meeting's rewrites instead of a same-date package", () => {
    const selected = selectCorrectedPageText({
      ownDocling: new Map([[4, "docling page 4"]]),
      ownCorrected: new Map([[4, "local correction"]]),
      donors: [{
        doclingByPage: new Map([[4, "docling page 4"]]),
        correctedByPage: new Map([[4, "other meeting"]]),
      }],
    });
    assert.equal(selected.get(4), "local correction");
  });

  it("does not use V2 notes when linked pages exist but have no rewrite yet", () => {
    const extracts = buildAgendaExtracts({
      sourcePages: [4],
      correctedPages: new Map(),
      doclingPages: new Map([[4, "Docling table on page 4"]]),
      fallback: "Amount: $214,194.00 plus HST.",
    });
    assert.match(extracts.sent, /Docling table/);
    assert.equal(extracts.sent.includes("$214,194.00"), false);
    assert.equal(extracts.corrected, "");
  });
});

describe("v4 draft payload", () => {
  it("matches the user message sent on draft", () => {
    const payload = buildMeetingsV4DraftUserPayload({
      title: "Booster Pump",
      itemNumber: "4.B.1",
      bundle: {
        agendaText: "Page 4\n| Ambient | $210,994 |",
        agendaTextDocling: "docling",
        agendaTextCorrected: "Page 4\n| Ambient | $210,994 |",
        cues: [{
          index: 0,
          start: "00:00:02.000",
          end: "00:00:04.000",
          speaker: "Ben",
          text: "Booster pump.",
        }],
        attachmentPages: [],
      },
    });
    assert.equal(payload.agenda.includes("Ambient"), true);
    assert.equal(payload.transcript.length, 1);
    assert.match(meetingsV4DraftTranscriptMarkdown(payload.transcript.map((cue, index) => ({
      index,
      ...cue,
    }))), /Ben/);
    assert.match(
      meetingsV4DraftFullCallMarkdown(MEETINGS_V4_DRAFT_PROMPT, payload),
      /=== System instruction ===/,
    );
    assert.match(
      meetingsV4DraftFullCallMarkdown(MEETINGS_V4_DRAFT_PROMPT, payload),
      /"itemNumber": "4.B.1"/,
    );
  });
});

describe("v4 draft reply", () => {
  it("keeps a prior approval and a new direction together", () => {
    const parsed = readMeetingsV4Draft(JSON.stringify({
      minutes: "The board noted the prior approval and directed management to obtain legal review.",
      findings: [
        { kind: "reported_prior_approval", text: "The contractor was previously approved." },
        { kind: "direction", text: "Management will obtain legal review." },
      ],
      evidence_fit: "on_topic",
      amount: "uncertain",
      amount_basis: "Two package figures could match.",
      actions: [{ owner: "Management", description: "Obtain legal review." }],
      motion: { mover: "Pat", seconder: null, resolution: "legal review be obtained", outcome: "carried", source: "guess" },
      restricted: false,
      restricted_reason: "",
      gaps: [],
    }));
    assert.equal(parsed?.findings.length, 2);
    assert.equal(parsed?.findings[0]?.kind, "reported_prior_approval");
    assert.equal(parsed?.findings[1]?.kind, "direction");
    assert.equal(parsed?.motion.source, "unsupported");
    assert.equal(parsed?.motion.mover, null);
    assert.equal(parsed?.motion.resolution, "legal review be obtained");
    assert.equal(parsed?.motion.outcome, "carried");
    assert.equal(parsed?.amount, "uncertain");
  });

  it("keeps a mover only when the reply cites the transcript", () => {
    const parsed = readMeetingsV4Draft(JSON.stringify({
      minutes: "The board approved the seal replacement for $2,492 plus HST.",
      findings: [{ kind: "decision", text: "Approved the seal replacement." }],
      evidence_fit: "on_topic",
      amount: "$2,492 plus HST",
      amount_basis: "Spoken figure matches the agenda quote.",
      actions: [],
      motion: {
        mover: "Pat",
        seconder: "Sam",
        resolution: "the seal replacement be approved",
        outcome: "carried",
        source: "transcript",
      },
      restricted: false,
      restricted_reason: "",
      gaps: [],
    }));
    assert.equal(parsed?.motion.mover, "Pat");
    assert.equal(parsed?.motion.seconder, "Sam");
    assert.equal(parsed?.motion.resolution, "the seal replacement be approved");
  });
});

describe("v4 pipeline prompts", () => {
  it("lists draft, restricted, and assembly tabs for the minutes prompt viewer", () => {
    const ids = MEETINGS_V4_PIPELINE_PROMPT_TABS.map((tab) => tab.id);
    assert.ok(ids.includes("draft"));
    assert.ok(ids.includes("restricted"));
    assert.ok(ids.includes("assembly"));
    assert.match(MEETINGS_V4_RESTRICTED_CLASSIFICATION_PROMPT, /restricted/);
  });
});

describe("v4 assembly", () => {
  it("prints the paragraph, the action, and the formal motion", () => {
    const item = assemblyItem({
      minutes: "The board approved the seal replacement for $2,492 plus HST.",
      findings: [
        { kind: "reported_prior_approval", text: "Quoted last month." },
        { kind: "decision", text: "Approved today." },
      ],
      actions: [{ owner: "Management", description: "Issue the purchase order." }],
      motion: {
        mover: "Pat",
        seconder: "Sam",
        resolution: "the seal replacement be approved for $2,492 plus HST",
        outcome: "carried",
        source: "transcript",
      },
    });
    const assembled = assembleMeetingsV4Minutes({
      title: "Minutes - 2026-08-12 v14",
      meetingDate: "2026-08-12",
      items: [item],
    });
    assert.equal(item.findings.length, 2);
    assert.match(assembled.markdown, /\$2,492 plus HST/);
    assert.match(assembled.markdown, /Issue the purchase order/);
    assert.match(assembled.markdown, /\*\*MOTION by Pat\*\*/);
    assert.match(assembled.markdown, /\*\*Seconded by Sam\*\*/);
    assert.match(assembled.markdown, /\*\*THAT the seal replacement be approved for \$2,492 plus HST\*\*/);
    assert.match(assembled.markdown, /\*\*Motion carried\.\*\*/);
    assert.equal(assembled.document.attendance.present.length, 0);
    assert.equal(assembled.document.dateOfNextMeeting, undefined);
    const concepts = buildAiMinutesConcepts(JSON.stringify(assembled.document), [{
      id: "item-1",
      title: "Seal replacement",
      itemNumber: "4.A",
    }]);
    const seal = concepts.find((concept) => concept.heading.includes("Seal replacement"));
    assert.ok(seal);
    assert.match(seal.body, /\$2,492 plus HST/);
    assert.match(seal.body, /MOTION by Pat/);
  });

  it("compares the V4 document instead of an older draft", () => {
    const v4 = JSON.stringify({ title: "V4 minutes" });
    const older = JSON.stringify({ title: "V2 draft" });
    assert.equal(minutesJsonForGoldCompare({
      minutesSource: "v4",
      v4DocumentJson: v4,
      storedMinutesJson: older,
    }), v4);
    assert.equal(minutesJsonForGoldCompare({
      minutesSource: "v4",
      v4DocumentJson: "  ",
      storedMinutesJson: older,
    }), null);
    assert.equal(minutesJsonForGoldCompare({
      minutesSource: null,
      v4DocumentJson: v4,
      storedMinutesJson: older,
    }), older);
  });

  it("leaves a motion off the page when this meeting made no decision", () => {
    const assembled = assembleMeetingsV4Minutes({
      title: "Minutes - 2026-08-12 v14",
      meetingDate: "2026-08-12",
      items: [assemblyItem({
        minutes: "Management reported the status of the seal replacement.",
        motion: { mover: "Pat", seconder: null, resolution: null, outcome: "unrecorded", source: "transcript" },
      })],
    });
    assert.equal(assembled.markdown.includes("MOTION"), false);
    assert.equal(assembled.markdown.includes("Pat"), false);
  });

  it("numbers one presentation section and keeps later sections in discussion order", () => {
    const assembled = assembleMeetingsV4Minutes({
      title: "Minutes - 2026-08-06 v4",
      meetingDate: "2026-08-06",
      items: [
        assemblyItem({
          agendaItemId: "call",
          itemNumber: "1",
          title: "Call to Order",
          itemType: "call_to_order",
          minutes: "Proper notice having been given, Management called the meeting to order at 6:04 p.m.",
        }),
        assemblyItem({
          agendaItemId: "fuel",
          itemNumber: "2.1",
          title: "General Fuel Delivery and Exhaust System Upgrade",
          itemType: "guest_presentation",
          minutes: "Trace presented the tender review.",
        }),
        assemblyItem({
          agendaItemId: "riser",
          itemNumber: "2.2",
          title: "Riser Expansion",
          itemType: "guest_presentation",
          minutes: "Trace presented the riser expansion.",
        }),
        assemblyItem({
          agendaItemId: "close",
          itemNumber: "4",
          title: "Meeting Conclusion",
          itemType: "adjournment",
          minutes: "There being no further business to discuss, the meeting was unanimously concluded at 8:50 p.m.",
        }),
      ],
    });
    assert.match(assembled.markdown, /\*\*MINUTES\*\* of the meeting/);
    assert.match(assembled.markdown, /## 1\. CALL TO ORDER/);
    assert.match(assembled.markdown, /## 2\. PRESENTATION/);
    assert.match(assembled.markdown, /### 2\.1 General Fuel Delivery and Exhaust System Upgrade/);
    assert.match(assembled.markdown, /### 2\.2 Riser Expansion/);
    assert.match(assembled.markdown, /## 3\. MEETING CONCLUSION/);
    assert.match(assembled.markdown, /was concluded at 8:50 p\.m\./);
    assert.equal(assembled.markdown.includes("unanimously"), false);
    assert.equal(assembled.markdown.includes("DATE OF NEXT MEETING"), false);
    assert.equal(assembled.markdown.includes("was not recorded"), false);
  });

  it("keeps a restricted management letter and gives completed work its own subsection", () => {
    const assembled = assembleMeetingsV4Minutes({
      title: "Minutes - 2026-08-12 v14",
      meetingDate: "2026-08-12",
      items: [
        assemblyItem({
          agendaItemId: "a",
          itemNumber: "4.A",
          title: "Status certificates",
          itemType: "ratification_line_item",
          sectionLabel: "Management Report",
          minutes: "The status certificate was ratified.",
        }),
        assemblyItem({
          agendaItemId: "b",
          itemNumber: "4.B",
          title: "Chargeback dispute",
          itemType: "discussion_approval",
          sectionLabel: "Management Report",
          minutes: "The board considered the chargeback dispute.",
          restricted: true,
        }),
        assemblyItem({
          agendaItemId: "c",
          itemNumber: "4.C",
          title: "Lobby restoration",
          itemType: "discussion_approval",
          sectionLabel: "Management Report",
          minutes: "The lobby restoration was discussed.",
        }),
        assemblyItem({
          agendaItemId: "done",
          itemNumber: "4.D",
          title: "Roof repair",
          itemType: "completed_items",
          sectionLabel: "Items completed",
          minutes: "The roof repair was finished.",
          actions: [{ owner: "Management", description: "File the completion report." }],
        }),
      ],
    });
    const addendumAt = assembled.markdown.indexOf(RESTRICTED_ADDENDUM_TITLE);
    const publicText = assembled.markdown.slice(0, addendumAt);
    const addendumText = assembled.markdown.slice(addendumAt);
    assert.match(publicText, /\*\*\(a\)\*\* Status certificates/);
    assert.match(publicText, /\*\*\(c\)\*\* Lobby restoration/);
    assert.equal(publicText.includes("Chargeback dispute"), false);
    assert.match(publicText, /### 1\.3 Work Completed/);
    assert.match(publicText, /\*\*Action: Management File the completion report\.\*\*/);
    assert.match(addendumText, /\*\*\(b\)\*\* Chargeback dispute/);
    assert.match(addendumText, /## 1\. MANAGEMENT REPORT, CONTINUED/);
  });

  it("prints a guest departure and a recording-secretary exit on the section where they happened", () => {
    const assembled = assembleMeetingsV4Minutes({
      title: "Minutes - 2026-08-06 v4",
      meetingDate: "2026-08-06",
      items: [
        assemblyItem({
          agendaItemId: "fuel",
          itemNumber: "2.1",
          title: "General Fuel Delivery",
          itemType: "guest_presentation",
          minutes: "Trace presented the tender review.",
        }),
        assemblyItem({
          agendaItemId: "budget",
          itemNumber: "8",
          title: "Budget Discussion",
          itemType: "discussion_topic",
          minutes: "The board discussed the budget.",
        }),
      ],
      departures: [
        { name: "Ryan Ratcliff", time: "8:09 p.m.", role: "guest", afterSectionId: "presentations" },
        { name: "Gretta Averbukh", role: "recording_secretary", afterSectionId: "post:Budget Discussion" },
      ],
    });
    const presentationAt = assembled.markdown.indexOf("## 1. PRESENTATION");
    const departureAt = assembled.markdown.indexOf("Ryan Ratcliff was thanked for attending and departed the meeting at 8:09 p.m.");
    const budgetAt = assembled.markdown.indexOf("## 2. BUDGET DISCUSSION");
    const secretaryAt = assembled.markdown.indexOf("The Recording Secretary was excused.");
    assert.ok(presentationAt >= 0 && departureAt > presentationAt && budgetAt > departureAt);
    assert.ok(secretaryAt > budgetAt);
    assert.equal(assembled.markdown.includes("The guests left the meeting"), false);
  });

  it("places a restricted item in the addendum", () => {
    const assembled = assembleMeetingsV4Minutes({
      title: "Minutes - 2026-08-12 v14",
      meetingDate: "2026-08-12",
      items: [assemblyItem({
        minutes: "The board considered the chargeback dispute for Unit 712.",
        restricted: true,
      })],
    });
    const addendumAt = assembled.markdown.indexOf(RESTRICTED_ADDENDUM_TITLE);
    const topicAt = assembled.markdown.indexOf("Unit 712");
    assert.ok(addendumAt >= 0);
    assert.ok(topicAt > addendumAt);
  });
});

function assemblyItem(overrides: Partial<MeetingsV4AssemblyItem>): MeetingsV4AssemblyItem {
  return {
    agendaItemId: "item-1",
    itemNumber: "4.A",
    title: "Seal replacement",
    itemType: "discussion_topic",
    sectionLabel: "",
    bundle: { agendaText: "Seal replacement", agendaTextDocling: "", cues: [], attachmentPages: [] },
    minutes: "The board discussed the seal replacement.",
    findings: [],
    evidenceFit: "on_topic",
    amount: "not applicable",
    amountBasis: "",
    actions: [],
    motion: { mover: null, seconder: null, resolution: null, outcome: "unrecorded", source: "unsupported" },
    restricted: false,
    restrictedReason: "",
    gaps: [],
    error: null,
    ...overrides,
  };
}
