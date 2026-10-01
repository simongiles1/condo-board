/**
 * Meeting conclusions come from the full transcript stretch, not the preview quote.
 * Run: npx tsx --test scripts/test-meeting-v3-meeting-conclusions.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyPackageReference,
  concludeFromDiscussion,
  discussionTextForSpans,
  readStoredItemConclusion,
} from "../lib/meeting-v3/meeting-conclusions";
import type { MeetingsV3TranscriptCue, MeetingsV3TranscriptSpan } from "../lib/meeting-v3/transcript-spans";

const cues: MeetingsV3TranscriptCue[] = [
  { index: 0, startMs: 0, endMs: 1000, speaker: "A", text: "The package says it was approved by email." },
  { index: 1, startMs: 1000, endMs: 2000, speaker: "B", text: "I move that we ratify that approval." },
];

const span: MeetingsV3TranscriptSpan = {
  startMs: 0,
  endMs: 2000,
  quote: "The package says it was approved by email.",
  overlaps: false,
};

describe("v3 meeting conclusions", () => {
  it("joins every cue in the stretch and does not stop at the preview quote", () => {
    const discussion = discussionTextForSpans([span], cues);
    assert.match(discussion, /ratify/);
    const conclusion = concludeFromDiscussion(discussion);
    assert.equal(conclusion.status, "discussed");
    assert.match(conclusion.quote ?? "", /move/);
  });

  it("does not treat a negated, defeated, or future ratification as a decision", () => {
    assert.equal(concludeFromDiscussion("We did not ratify this proposal.").status, "discussed");
    assert.equal(concludeFromDiscussion("So moved. The motion was defeated.").status, "discussed");
    assert.equal(concludeFromDiscussion("We will defer it. Later we can ratify it.").status, "deferred");
    assert.equal(concludeFromDiscussion("We approved this in March.").status, "discussed");
  });

  it("records an explicit approval, and lets a later sentence replace it", () => {
    assert.equal(
      concludeFromDiscussion("The board approved the new contract unanimously.").status,
      "ratified",
    );
    assert.equal(
      concludeFromDiscussion("I move that we ratify that approval. The motion carried.").status,
      "ratified",
    );
    assert.equal(
      concludeFromDiscussion("The board approved the contract. The motion was withdrawn.").status,
      "discussed",
    );
  });

  it("uses a package recommendation to name what the discussion pointed at", () => {
    const conclusion = applyPackageReference(
      concludeFromDiscussion("Proceed with the engineer's recommended option."),
      [{ role: "recommendation", quote: "The engineer recommends option 2 at $100." }],
    );
    assert.equal(conclusion.status, "ratified");
    assert.match(conclusion.packageQuote ?? "", /option 2/);
    assert.equal(conclusion.openReference, false);
    const open = applyPackageReference(conclusion, []);
    assert.equal(open.openReference, true);
    assert.equal(open.status, "ratified");
  });

  it("does not treat package wording as a meeting decision when the stretch is empty", () => {
    const conclusion = concludeFromDiscussion("");
    assert.equal(conclusion.status, "unclear");
  });

  it("drops a stored quote that is not in the discussion", () => {
    const stored = readStoredItemConclusion(JSON.stringify({
      status: "ratified",
      discussion: "The board talked about the pump.",
      quote: "we ratify",
    }));
    assert.equal(stored?.quote, null);
    assert.equal(stored?.status, "ratified");
  });
});
