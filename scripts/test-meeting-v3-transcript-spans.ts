/**
 * V3 transcript spans come from the segmented topic clock ranges.
 * Run: npx tsx --test scripts/test-meeting-v3-transcript-spans.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADDITIONAL_BUSINESS_TITLE,
  agendaItemsForWizardStep,
  cuesFromVtt,
  packageAgendaItems,
  planAdditionalBusinessItem,
  readStoredItemTranscript,
  rowsFromSegmentedTopics,
  type MeetingsV3TranscriptCue,
} from "../lib/meeting-v3/transcript-spans";

const cues: MeetingsV3TranscriptCue[] = [
  {
    index: 0,
    startMs: 0,
    endMs: 1000,
    speaker: "Alex",
    text: "The booster pump quote is forty eight thousand.",
  },
  {
    index: 1,
    startMs: 1000,
    endMs: 2000,
    speaker: "Alex",
    text: "I move we approve NWP.",
  },
  {
    index: 2,
    startMs: 2000,
    endMs: 3000,
    speaker: "Blair",
    text: "Next is the roof.",
  },
];

describe("v3 transcript spans", () => {
  it("keeps a leaf stretch and quotes the first cue inside it", () => {
    const rows = rowsFromSegmentedTopics({
      cues,
      topics: [
        {
          itemNumber: "4",
          title: "Property Management Report",
          discussionTimestampRange: "00:00:00 - 00:00:03",
        },
        {
          itemNumber: "4.A",
          title: "Booster pump",
          discussionTimestampRange: "00:00:00 - 00:00:02",
        },
      ],
    });
    const pump = rows.find((row) => row.itemNumber === "4.A");
    const parent = rows.find((row) => row.itemNumber === "4");
    assert.equal(parent?.transcript.spans.length, 0);
    assert.equal(pump?.transcript.spans.length, 1);
    assert.equal(pump?.transcript.spans[0]?.overlaps, false);
    assert.equal(pump?.transcript.spans[0]?.startMs, 0);
    assert.equal(pump?.transcript.spans[0]?.endMs, 2000);
    assert.equal(pump?.transcript.spans[0]?.quote, "The booster pump quote is forty eight thousand.");
  });

  it("marks two topics that claim the same stretch and does not mark one topic against itself", () => {
    const rows = rowsFromSegmentedTopics({
      cues,
      topics: [
        {
          itemNumber: "4.A",
          title: "Booster pump",
          discussionTimestampRange: "00:00:00 - 00:00:02; 00:00:02 - 00:00:03",
        },
        {
          itemNumber: "4.B",
          title: "Roof",
          discussionTimestampRange: "00:00:01 - 00:00:03",
        },
      ],
    });
    const pump = rows.find((row) => row.itemNumber === "4.A");
    const roof = rows.find((row) => row.itemNumber === "4.B");
    assert.equal(pump?.transcript.spans.length, 1);
    assert.equal(pump?.transcript.spans[0]?.startMs, 0);
    assert.equal(pump?.transcript.spans[0]?.endMs, 3000);
    assert.equal(pump?.transcript.spans[0]?.overlaps, true);
    assert.equal(roof?.transcript.spans[0]?.overlaps, true);
  });

  it("leaves a later visit as its own span", () => {
    const rows = rowsFromSegmentedTopics({
      cues,
      topics: [
        {
          itemNumber: "4.A",
          title: "Booster pump",
          discussionTimestampRange: "00:00:00 - 00:00:01; 00:00:02.500 - 00:00:03",
        },
      ],
    });
    assert.equal(rows[0]?.transcript.spans.length, 2);
    assert.equal(rows[0]?.transcript.spans[0]?.overlaps, false);
    assert.equal(rows[0]?.transcript.spans[1]?.overlaps, false);
  });

  it("reads cues without merging the same speaker", () => {
    const parsed = cuesFromVtt(`WEBVTT

00:00:00.000 --> 00:00:01.000
<v Alex>The booster pump quote is forty eight thousand.

00:00:01.000 --> 00:00:02.000
<v Alex>I move we approve NWP.
`);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]?.endMs, 1000);
    assert.equal(parsed[1]?.startMs, 1000);
  });

  it("reads a stored item", () => {
    const stored = readStoredItemTranscript(
      JSON.stringify({
        spans: [{ startMs: 0, endMs: 1000, quote: "The booster pump quote is forty eight thousand.", overlaps: false }],
      }),
    );
    assert.equal(stored?.spans.length, 1);
  });

  it("adds additional business as 4.E before the next meeting", () => {
    const plan = planAdditionalBusinessItem(
      [
        { id: "4", itemNumber: "4", title: "Property Management Report" },
        { id: "4d", itemNumber: "4.D", title: "Items for discussion" },
        { id: "5", itemNumber: "5", title: "Date of next meeting" },
      ],
      (code) => ({ id: "new", itemNumber: code, title: ADDITIONAL_BUSINESS_TITLE }),
    );
    assert.equal(plan.code, "4.E");
    assert.equal(plan.injected?.id, "new");
    assert.equal(plan.renumberedId, null);
    assert.deepEqual(
      plan.items.map((item) => item.itemNumber),
      ["4", "4.D", "4.E", "5"],
    );
  });

  it("keeps an existing 4.E heading", () => {
    const plan = planAdditionalBusinessItem(
      [{ id: "e", itemNumber: "4.E", title: "Ad-hoc items" }],
      () => {
        throw new Error("should not create");
      },
    );
    assert.equal(plan.injected, null);
    assert.equal(plan.renumberedId, null);
    assert.equal(plan.items[0]?.itemNumber, "4.E");
  });

  it("moves a misnumbered additional-business heading onto 4.E", () => {
    const plan = planAdditionalBusinessItem(
      [
        { id: "4", itemNumber: "4", title: "Property Management Report" },
        { id: "extra", itemNumber: "7", title: "Additional Business" },
        { id: "5", itemNumber: "5", title: "Date" },
      ],
      () => {
        throw new Error("should not create");
      },
    );
    assert.equal(plan.renumberedId, "extra");
    assert.equal(plan.items.find((item) => item.id === "extra")?.itemNumber, "4.E");
    assert.deepEqual(
      plan.items.map((item) => item.itemNumber),
      ["4", "4.E", "5"],
    );
  });
});

describe("transcript-only agenda rows", () => {
  const items = [
    { id: "4", itemNumber: "4", title: "Property Management Report" },
    { id: "4d", itemNumber: "4.D", title: "Items for discussion" },
    { id: "e", itemNumber: "4.E", title: "Ad-hoc items" },
    { id: "ea", itemNumber: "4.E.a", title: "Toilet hose" },
    { id: "5", itemNumber: "5", title: "Date of next meeting" },
  ];

  it("drops the additional-business heading and its leaves from the printed package", () => {
    assert.deepEqual(
      packageAgendaItems(items).map((item) => item.itemNumber),
      ["4", "4.D", "5"],
    );
  });

  it("hides extras on earlier wizard steps and keeps them after segmentation", () => {
    assert.deepEqual(
      agendaItemsForWizardStep(items, "agenda").map((item) => item.itemNumber),
      ["4", "4.D", "5"],
    );
    assert.deepEqual(
      agendaItemsForWizardStep(items, "attachments").map((item) => item.itemNumber),
      ["4", "4.D", "5"],
    );
    assert.deepEqual(
      agendaItemsForWizardStep(items, "facts").map((item) => item.itemNumber),
      ["4", "4.D", "5"],
    );
    assert.deepEqual(
      agendaItemsForWizardStep(items, "transcript").map((item) => item.itemNumber),
      ["4", "4.D", "4.E", "4.E.a", "5"],
    );
    assert.deepEqual(
      agendaItemsForWizardStep(items, "sources").map((item) => item.itemNumber),
      ["4", "4.D", "4.E", "4.E.a", "5"],
    );
  });
});
