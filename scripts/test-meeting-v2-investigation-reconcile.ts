/**
 * Investigation post-process: wrap-up inject, package notes, guest vs PM.
 * Run: npx tsx --test scripts/test-meeting-v2-investigation-reconcile.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyRevisedNotes,
  isGuestPresentationItem,
  recommendedAnswerAddsNewFact,
  replaceLabeledLine,
} from "../lib/meeting-v2/investigation-reconcile";

describe("recommendedAnswerAddsNewFact", () => {
  it("skips a 1.B-style wrap-up that restates the summary", () => {
    const summary =
      "The Board noted that the meeting with Eng. Ryan Ratcliff of TCG regarding the riser expansion had already taken place and was completed, as referenced in the previous management report. No substantive discussion or decision was undertaken with respect to the riser expansion at this meeting, it having been previously addressed.";
    const answer =
      "The riser expansion was previously discussed with Eng. Ryan Ratcliff of TCG and was noted as completed; no further action was required at this meeting.";
    assert.equal(recommendedAnswerAddsNewFact(summary, answer), false);
  });

  it("skips a 1.C-style wrap-up that restates the summary", () => {
    const summary =
      "The Board noted, in passing, that the meeting with Eng. Ryan Ratcliff of TCG regarding the generator fuel delivery upgrade and exhaust project had already been held and was complete. No substantive discussion, deliberation, or decision was undertaken with respect to this item during the meeting.";
    const answer =
      "The Board was advised that the meeting with Eng. Ryan Ratcliff of TCG respecting the generator fuel delivery upgrade and exhaust project had already been held and was complete; no further action was required at this meeting.";
    assert.equal(recommendedAnswerAddsNewFact(summary, answer), false);
  });

  it("skips restating a CCDC action already in the summary", () => {
    const summary =
      "The Board noted that the meeting with Engineer Ryan Ratcliff of TCG regarding projects, including the booster pump, had already been completed. In additional business, Management advised that a CCDC contract for the booster pump would require review by legal counsel (Joseph) prior to signing, and the Board discussed the threshold for legal review of contracts, with Management indicating that contracts of $50,000 and above are referred for legal review.";
    const answer =
      "Management is directed to forward the CCDC contract for the booster pump to legal counsel for review prior to execution, consistent with the practice of referring contracts of $50,000 and above for legal review.";
    assert.equal(recommendedAnswerAddsNewFact(summary, answer), false);
  });

  it("injects when the answer adds a dollar figure the summary lacks", () => {
    const summary =
      "The Board considered the booster pump replacement and elected to skip the item as it was covered by separate minutes.";
    const answer =
      "The Board acknowledged prior approval of the booster pump replacement at approximately $163,000.";
    assert.equal(recommendedAnswerAddsNewFact(summary, answer), true);
  });

  it("injects when the answer names a party the summary lacks", () => {
    const summary = "The Board discussed forwarding the booster pump contract for legal review.";
    const answer = "Management is directed to forward the CCDC contract to Joseph for legal review.";
    assert.equal(recommendedAnswerAddsNewFact(summary, answer), true);
  });
});

describe("applyRevisedNotes", () => {
  it("rewrites the Notes line in source text and assembled context", () => {
    const sourceText = [
      "Discussion status: discussed",
      "Discussion timing: 00:15:58 - 00:16:44",
      "Notes: Amount: $214,194.00 plus HST; Recommendation: Award to Ambient Mechanical",
    ].join("\n");
    const assembled = "Agenda item: Booster Pump\n\nNotes: Amount: $214,194.00 plus HST; Recommendation: Award to Ambient Mechanical\n\nChunk text";
    const result = applyRevisedNotes({
      notes: [
        "Amount: approximately $163,000 (New Water Plumbing, August 6 approval)",
        "Mentioned as previously approved; skipped in this meeting.",
      ],
      sourceText,
      assembledContextText: assembled,
    });
    assert.deepEqual(result.notes, [
      "Amount: approximately $163,000 (New Water Plumbing, August 6 approval)",
      "Mentioned as previously approved; skipped in this meeting.",
    ]);
    assert.match(result.sourceText, /Amount: approximately \$163,000/);
    assert.doesNotMatch(result.sourceText, /214,194/);
    assert.match(result.assembledContextText, /Amount: approximately \$163,000/);
    assert.doesNotMatch(result.assembledContextText, /214,194/);
  });

  it("removes the Notes line when the revised list is empty", () => {
    const result = applyRevisedNotes({
      notes: [],
      sourceText: "Discussion status: discussed\nNotes: Amount: $214,194.00 plus HST",
      assembledContextText: "Notes: Amount: $214,194.00 plus HST\n\nChunk",
    });
    assert.deepEqual(result.notes, []);
    assert.doesNotMatch(result.sourceText, /Notes:/);
    assert.doesNotMatch(result.assembledContextText, /Notes:/);
  });
});

describe("replaceLabeledLine", () => {
  it("appends a Notes line when none exists", () => {
    const next = replaceLabeledLine("Discussion status: discussed", "Notes", "Amount: $163,000");
    assert.equal(next, "Discussion status: discussed\nNotes: Amount: $163,000");
  });
});

describe("isGuestPresentationItem", () => {
  it("matches guest_presentation and ignores other types", () => {
    assert.equal(isGuestPresentationItem("guest_presentation"), true);
    assert.equal(isGuestPresentationItem("discussion_approval"), false);
    assert.equal(isGuestPresentationItem(null), false);
  });
});
