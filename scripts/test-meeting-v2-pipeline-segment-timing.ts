/**
 * Meeting V2 pipeline segment timing and time-weighted progress.
 * Run: npx tsx --test scripts/test-meeting-v2-pipeline-segment-timing.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeIntraSegmentRatio,
  computePipelineProgressPercent,
  computeSegmentProgressBounds,
  computeSegmentWeightsFromAverages,
  getSegmentMilestonePercent,
  MEETING_V2_DEFAULT_SEGMENT_WEIGHTS,
  MEETING_V2_PIPELINE_COMPLETE_PERCENT,
} from "../lib/meeting-v2/pipeline-segment-timing";

describe("computeSegmentProgressBounds", () => {
  it("maps default weights to the legacy 0–90 pipeline span", () => {
    const bounds = computeSegmentProgressBounds(MEETING_V2_DEFAULT_SEGMENT_WEIGHTS);
    assert.equal(bounds.ingest.basePercent, 0);
    assert.equal(bounds.ingest.spanPercent, 20);
    assert.equal(bounds.extract.basePercent, 20);
    assert.equal(bounds.extract.spanPercent, 20);
    assert.equal(bounds.validate.basePercent, 80);
    assert.equal(bounds.validate.spanPercent, 10);
    assert.equal(
      getSegmentMilestonePercent(bounds, "validate", "end"),
      MEETING_V2_PIPELINE_COMPLETE_PERCENT,
    );
  });

  it("allocates more bar space to slower segments once averages exist", () => {
    const weights = computeSegmentWeightsFromAverages({
      ingest: { avgMs: 60_000, sampleCount: 3 },
      extract: { avgMs: 420_000, sampleCount: 3 },
      evidence: { avgMs: 90_000, sampleCount: 3 },
      investigate: { avgMs: 120_000, sampleCount: 3 },
      validate: { avgMs: 60_000, sampleCount: 3 },
    });
    const bounds = computeSegmentProgressBounds(weights);
    assert.ok(bounds.extract.spanPercent > bounds.ingest.spanPercent);
    assert.ok(bounds.extract.spanPercent > bounds.validate.spanPercent);
  });
});

describe("computeIntraSegmentRatio", () => {
  it("uses elapsed time when chunk progress lags behind a long-running segment", () => {
    const nowMs = 1_700_000_000_000;
    const ratio = computeIntraSegmentRatio({
      current: 4,
      total: 21,
      segmentStartedAtMs: nowMs - 6 * 60_000,
      expectedSegmentDurationMs: 7 * 60_000,
      nowMs,
    });
    assert.ok(ratio > 4 / 21);
    assert.ok(ratio < 1);
  });
});

describe("computePipelineProgressPercent", () => {
  it("reports higher extract progress mid-run when extract dominates total time", () => {
    const weights = computeSegmentWeightsFromAverages({
      ingest: { avgMs: 60_000, sampleCount: 3 },
      extract: { avgMs: 420_000, sampleCount: 3 },
      evidence: { avgMs: 90_000, sampleCount: 3 },
      investigate: { avgMs: 120_000, sampleCount: 3 },
      validate: { avgMs: 60_000, sampleCount: 3 },
    });
    const bounds = computeSegmentProgressBounds(weights);
    const nowMs = 1_700_000_000_000;
    const percent = computePipelineProgressPercent({
      segment: "extract",
      current: 4,
      total: 21,
      segmentBounds: bounds,
      segmentStartedAtMs: nowMs - 6 * 60_000,
      expectedSegmentDurationMs: 420_000,
      nowMs,
    });

    assert.ok(percent > 40);
    assert.ok(percent < 80);
  });
});
