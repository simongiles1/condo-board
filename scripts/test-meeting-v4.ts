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
} from "../lib/meeting-v4/agenda-text";
import { assembleMeetingsV4Minutes } from "../lib/meeting-v4/assemble";
import { minutesJsonForGoldCompare } from "../lib/meeting-v4/workspace";
import { buildAiMinutesConcepts } from "../lib/minutes/gold-standard-ai-concepts";
import { bundleCuesForItem, inventoryMeetingsV4 } from "../lib/meeting-v4/inventory";
import { readMeetingsV4Draft } from "../lib/meeting-v4/prompt";
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
    assert.deepEqual(
      resolveAgendaSourcePages({ itemNumber: "4.A", title: "Booster pump", v2Pages: [], v3Rows }),
      [4],
    );
  });

  it("matches V3 pages by title when V2 and V3 item numbers differ", () => {
    const v3Rows = [{
      itemNumber: "1",
      title: "Booster Pump Replacement – Base Specification and Alternative Options",
      sourcePagesJson: "[4]",
    }];
    assert.deepEqual(
      resolveAgendaSourcePages({
        itemNumber: "4.A",
        title: "Booster Pump Replacement",
        v2Pages: [],
        v3Rows,
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
      sourcePages: [4],
      pageText: new Map(),
      fallback: "Amount: $214,194.00 plus HST.",
    });
    assert.equal(text, "Amount: $214,194.00 plus HST.");
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
