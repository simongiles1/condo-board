/**
 * V3 transcript spans must quote the cues inside that window.
 * Run: npx tsx --test scripts/test-meeting-v3-transcript-spans.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptQuotedSpans,
  ADDITIONAL_BUSINESS_TITLE,
  chunkTranscriptCues,
  cuesFromVtt,
  planAdditionalBusinessItem,
  readProposedSpans,
  readStoredItemTranscript,
  TRANSCRIPT_CUE_BATCH,
  TRANSCRIPT_SEGMENT_MAX_OUTPUT_TOKENS,
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

const ids = new Set(["pump", "roof"]);

describe("v3 transcript spans", () => {
  it("keeps a span whose quote is inside cue boundaries", () => {
    const accepted = acceptQuotedSpans({
      cues,
      agendaItemIds: ids,
      proposed: [
        {
          agendaItemId: "pump",
          startMs: 0,
          endMs: 2000,
          quote: "I move we approve NWP.",
        },
      ],
    });
    const spans = accepted.get("pump")?.spans ?? [];
    assert.equal(spans.length, 1);
    assert.equal(spans[0]?.overlaps, false);
    assert.equal(spans[0]?.quote, "I move we approve NWP.");
  });

  it("drops a quote that is outside the named window", () => {
    const accepted = acceptQuotedSpans({
      cues,
      agendaItemIds: ids,
      proposed: [
        {
          agendaItemId: "pump",
          startMs: 0,
          endMs: 2000,
          quote: "Next is the roof.",
        },
      ],
    });
    assert.equal(accepted.get("pump"), undefined);
  });

  it("drops a window that does not start and end on cue boundaries", () => {
    const accepted = acceptQuotedSpans({
      cues,
      agendaItemIds: ids,
      proposed: [
        {
          agendaItemId: "pump",
          startMs: 500,
          endMs: 2000,
          quote: "I move we approve NWP.",
        },
      ],
    });
    assert.equal(accepted.size, 0);
  });

  it("marks two topics that claim the same stretch", () => {
    const accepted = acceptQuotedSpans({
      cues,
      agendaItemIds: ids,
      proposed: [
        {
          agendaItemId: "pump",
          startMs: 0,
          endMs: 2000,
          quote: "The booster pump quote is forty eight thousand.",
        },
        {
          agendaItemId: "roof",
          startMs: 1000,
          endMs: 3000,
          quote: "Next is the roof.",
        },
      ],
    });
    assert.equal(accepted.get("pump")?.spans[0]?.overlaps, true);
    assert.equal(accepted.get("roof")?.spans[0]?.overlaps, true);
  });

  it("joins abutting spans of the same topic", () => {
    const accepted = acceptQuotedSpans({
      cues,
      agendaItemIds: ids,
      proposed: [
        {
          agendaItemId: "pump",
          startMs: 0,
          endMs: 1000,
          quote: "The booster pump quote is forty eight thousand.",
        },
        {
          agendaItemId: "pump",
          startMs: 1000,
          endMs: 2000,
          quote: "I move we approve NWP.",
        },
      ],
    });
    const spans = accepted.get("pump")?.spans ?? [];
    assert.equal(spans.length, 1);
    assert.equal(spans[0]?.startMs, 0);
    assert.equal(spans[0]?.endMs, 2000);
    assert.equal(spans[0]?.quote, "The booster pump quote is forty eight thousand.");
  });

  it("leaves a later visit as its own span", () => {
    const accepted = acceptQuotedSpans({
      cues,
      agendaItemIds: ids,
      proposed: [
        {
          agendaItemId: "pump",
          startMs: 0,
          endMs: 1000,
          quote: "The booster pump quote is forty eight thousand.",
        },
        {
          agendaItemId: "roof",
          startMs: 1000,
          endMs: 2000,
          quote: "I move we approve NWP.",
        },
        {
          agendaItemId: "pump",
          startMs: 2000,
          endMs: 3000,
          quote: "Next is the roof.",
        },
      ],
    });
    assert.equal(accepted.get("pump")?.spans.length, 2);
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

  it("reads proposed spans and a stored item", () => {
    const proposed = readProposedSpans(
      JSON.stringify({
        items: [
          {
            agendaItemId: "pump",
            spans: [{ startMs: 0, endMs: 1000, quote: "The booster pump quote is forty eight thousand." }],
          },
        ],
      }),
    );
    assert.equal(proposed[0]?.agendaItemId, "pump");
    const stored = readStoredItemTranscript(
      JSON.stringify({
        spans: [{ startMs: 0, endMs: 1000, quote: "The booster pump quote is forty eight thousand.", overlaps: false }],
      }),
    );
    assert.equal(stored?.spans.length, 1);
    assert.equal(chunkTranscriptCues(cues, 2).length, 2);
    assert.equal(TRANSCRIPT_CUE_BATCH, 40);
    assert.ok(TRANSCRIPT_SEGMENT_MAX_OUTPUT_TOKENS > 4096);
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
