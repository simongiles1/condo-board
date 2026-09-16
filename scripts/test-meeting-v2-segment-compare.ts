/**
 * Segment-compare catalog + overlay helpers.
 * Run: npx tsx --test scripts/test-meeting-v2-segment-compare.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  overlaysFromTopics,
  transcriptSegmentsToCues,
} from "../lib/meeting-v2/segment-compare";
import {
  buildSegmentCompareCostBaseline,
  estimateSegmentCompareCombinationCostUsd,
} from "../lib/meeting-v2/segment-compare-cost-estimates";
import {
  enumerateSegmentCompareCombinations,
  formatSegmentCompareChoice,
  isSegmentCompareModelId,
  segmentCompareCombinationKey,
  segmentCompareMatrixSlots,
  segmentCompareModel,
  SEGMENT_COMPARE_MATRIX_CELL_COUNT,
} from "../lib/meeting-v2/segment-compare-models";
import {
  DEEPSEEK_THINKING_OUTPUT_CAP,
  thinkingAwareMaxOutputTokens,
} from "../lib/meeting-v2/segment-json";
import { pickSectionsForTime } from "../lib/transcript/section-overlay";

describe("segment compare catalog", () => {
  it("maps picker ids to API slugs", () => {
    assert.equal(segmentCompareModel("deepseek-v4-flash").apiModel, "deepseek-v4-flash");
    assert.equal(segmentCompareModel("deepseek-v4.1-flash").apiModel, "deepseek-flash");
    assert.equal(segmentCompareModel("gemini-3.8-flash").apiModel, "gemini-3.8-flash");
    assert.equal(isSegmentCompareModelId("gemini-3.7-flash"), false);
  });

  it("builds a stable combination key and 3×3 matrix", () => {
    const key = segmentCompareCombinationKey(
      { modelId: "deepseek-v4-flash", thinking: false },
      { modelId: "gemini-3.8-flash", thinking: true },
    );
    assert.equal(key, "deepseek-v4-flash|0|gemini-3.8-flash|1");
    assert.equal(enumerateSegmentCompareCombinations().length, 9);
    assert.equal(segmentCompareMatrixSlots().length, 6);
    assert.equal(SEGMENT_COMPARE_MATRIX_CELL_COUNT, 36);
  });

  it("labels thinking in the run title", () => {
    assert.equal(
      formatSegmentCompareChoice({ modelId: "gemini-3.8-flash", thinking: true }),
      "Gemini 3.8 Flash · thinking",
    );
  });

  it("leaves non-thinking output budgets unchanged", () => {
    assert.equal(
      thinkingAwareMaxOutputTokens({
        requested: 12288,
        thinking: false,
        provider: "deepseek",
      }),
      12288,
    );
  });

  it("raises DeepSeek thinking max_tokens so reasoning cannot exhaust JSON", () => {
    const raised = thinkingAwareMaxOutputTokens({
      requested: 12288,
      thinking: true,
      provider: "deepseek",
    });
    assert.ok((raised ?? 0) > 12288);
    assert.ok((raised ?? 0) <= DEEPSEEK_THINKING_OUTPUT_CAP);
  });

  it("raises tiny Gemini thinking judge budgets past 512", () => {
    const raised = thinkingAwareMaxOutputTokens({
      requested: 512,
      thinking: true,
      provider: "gemini",
    });
    assert.ok((raised ?? 0) > 512);
    assert.ok((raised ?? 0) >= 2048);
  });
});

describe("segment compare cost estimates", () => {
  it("reprices baseline walk/edge tokens for another model pair", () => {
    const baseline = buildSegmentCompareCostBaseline(
      [
        {
          id: "run-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:10:00.000Z",
          status: "completed",
          progressLabel: null,
          error: null,
          walk: { modelId: "deepseek-v4-flash", thinking: false },
          edge: { modelId: "deepseek-v4-flash", thinking: false },
          overlays: [],
          walkUsage: {
            modelId: "deepseek-v4-flash",
            apiModel: "deepseek-v4-flash",
            thinking: false,
            inputTokens: 100_000,
            outputTokens: 10_000,
            totalTokens: 110_000,
            costUsd: 0.05,
          },
          edgeUsage: {
            modelId: "deepseek-v4-flash",
            apiModel: "deepseek-v4-flash",
            thinking: false,
            inputTokens: 40_000,
            outputTokens: 4_000,
            totalTokens: 44_000,
            costUsd: 0.02,
          },
          totalCostUsd: 0.07,
        },
      ],
      null,
    );
    assert.ok(baseline);
    assert.equal(baseline?.source, "v4_lab_run");
    const geminiPlain = estimateSegmentCompareCombinationCostUsd(
      { modelId: "gemini-3.8-flash", thinking: false },
      { modelId: "gemini-3.8-flash", thinking: false },
      baseline!,
    );
    assert.ok(geminiPlain > 0);
    const geminiThinkBoth = estimateSegmentCompareCombinationCostUsd(
      { modelId: "gemini-3.8-flash", thinking: true },
      { modelId: "gemini-3.8-flash", thinking: true },
      baseline!,
    );
    assert.ok(geminiThinkBoth > geminiPlain * 2);
  });
});

describe("segment compare overlays", () => {
  it("keeps two cue rows aligned by clock while boxes differ", () => {
    const topics = [
      {
        title: "Financials",
        sectionLabel: "Reports",
        itemType: "report",
        itemNumber: "2",
        visibility: "PUBLIC" as const,
        sourcePages: [],
        sourceChunkIds: [],
        sourceTranscriptRanges: [[1, 2]] as Array<[number, number]>,
        discussionStatus: "discussed" as const,
        discussionTimestampRange: "00:00:10 - 00:00:40",
        consolidationReason: null,
        sourceText: null,
        aliases: [],
        notes: [],
        confidence: 1,
        confidenceReason: null,
        evidenceStrength: "DIRECT" as const,
        openQuestions: [],
        needsHumanReview: false,
        humanReviewReason: null,
      },
      {
        title: "Booster",
        sectionLabel: "Reports",
        itemType: "report",
        itemNumber: "4.A.1",
        visibility: "PUBLIC" as const,
        sourcePages: [],
        sourceChunkIds: [],
        sourceTranscriptRanges: [[3, 4]] as Array<[number, number]>,
        discussionStatus: "discussed" as const,
        discussionTimestampRange: "00:00:40 - 00:01:10",
        consolidationReason: null,
        sourceText: null,
        aliases: [],
        notes: [],
        confidence: 1,
        confidenceReason: null,
        evidenceStrength: "DIRECT" as const,
        openQuestions: [],
        needsHumanReview: false,
        humanReviewReason: null,
      },
    ];
    const overlays = overlaysFromTopics(topics);
    const cues = transcriptSegmentsToCues([
      {
        startTimestamp: "00:00:20.000",
        endTimestamp: "00:00:22.000",
        speakerLabel: "Paul",
        text: "on the financials",
      },
      {
        startTimestamp: "00:00:50.000",
        endTimestamp: "00:00:52.000",
        speakerLabel: "Haider",
        text: "booster pump",
      },
    ]);
    assert.equal(cues.length, 2);
    const first = pickSectionsForTime(20, overlays, 22);
    const second = pickSectionsForTime(50, overlays, 52);
    assert.equal(first[0]?.code, "2");
    assert.equal(second[0]?.code, "4.A.1");
  });
});
