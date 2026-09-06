/**
 * Meeting V2 status polling: only poll while automated work may be in flight.
 * Run: npx tsx --test scripts/test-meeting-v2-status-poll.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldPollMeetingV2Status } from "../lib/meeting-v2/workflow-progress";

describe("shouldPollMeetingV2Status", () => {
  it("polls during active pipeline stages", () => {
    for (const state of [
      "ingesting",
      "extracting",
      "gathering_evidence",
      "investigating",
      "validating",
    ]) {
      assert.equal(
        shouldPollMeetingV2Status({ pipelineState: state }),
        true,
        state,
      );
    }
  });

  it("does not poll when validated and waiting on agenda review", () => {
    assert.equal(
      shouldPollMeetingV2Status({ pipelineState: "validated" }),
      false,
    );
  });

  it("does not poll when created, failed, or halted mid-run", () => {
    assert.equal(shouldPollMeetingV2Status({ pipelineState: "created" }), false);
    assert.equal(shouldPollMeetingV2Status({ pipelineState: "failed" }), false);
    assert.equal(
      shouldPollMeetingV2Status({
        pipelineState: "extracting",
        pipelineHalted: true,
      }),
      false,
    );
  });

  it("polls when user-triggered background work is pending", () => {
    assert.equal(
      shouldPollMeetingV2Status({
        pipelineState: "validated",
        awaitingBackgroundWork: true,
      }),
      true,
    );
  });
});
