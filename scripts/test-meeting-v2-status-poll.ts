/**
 * Meeting V2 status polling: only poll while automated work may be in flight.
 * Run: npx tsx --test scripts/test-meeting-v2-status-poll.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMeetingV2DisplayProgress,
  buildMeetingV2WorkflowProgress,
  getMeetingV2CurrentStepPosition,
  isMeetingV2PipelineActivelyRunning,
  shouldPollMeetingV2Status,
} from "../lib/meeting-v2/workflow-progress";

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

  it("detects actively running pipeline states", () => {
    assert.equal(
      isMeetingV2PipelineActivelyRunning({
        pipelineState: "validating",
        lastError: null,
      }),
      true,
    );
    assert.equal(
      isMeetingV2PipelineActivelyRunning({
        pipelineState: "validating",
        lastError: "halted",
      }),
      false,
    );
  });

  it("uses stored phase progress while the pipeline is actively running", () => {
    const display = buildMeetingV2DisplayProgress({
      pipelineNotStarted: false,
      pipelineActivelyRunning: true,
      pipelineState: "investigating",
      storedProgressPercent: 72,
      storedCurrentStep: "Investigating items (18/30)",
      workflowProgress: {
        steps: [],
        completedCount: 3,
        totalCount: 7,
        progressPercent: 43,
        currentLabel: "Investigate",
        currentStep: "0/30 agenda items have investigation output.",
        isFullyComplete: false,
      },
    });

    assert.equal(display.progressPercent, 72);
    assert.equal(display.currentStep, "Investigating items (18/30)");
    assert.equal(display.currentLabel, "Investigate");
  });

  it("reports agenda review as step 6 of 7 after pipeline validation", () => {
    const workflowProgress = buildMeetingV2WorkflowProgress({
      pipelineStages: [
        { key: "ingest", label: "Ingest", status: "complete", note: "" },
        { key: "extract", label: "Extract", status: "complete", note: "" },
        { key: "evidence", label: "Evidence", status: "complete", note: "" },
        { key: "investigate", label: "Investigate", status: "complete", note: "" },
        { key: "validate", label: "Validate", status: "complete", note: "" },
      ],
      agendaItemCount: 12,
      needsClarificationCount: 2,
      flaggedCount: 0,
      draftCount: 0,
      hasLatestDraft: false,
    });

    assert.equal(workflowProgress.currentLabel, "Agenda review");
    assert.deepEqual(getMeetingV2CurrentStepPosition(workflowProgress), {
      stepNumber: 6,
      totalCount: 7,
      activeStatus: "in_progress",
    });
  });
});
