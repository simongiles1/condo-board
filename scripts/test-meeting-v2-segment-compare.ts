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
  cellRunningCostDisplay,
  estimateSegmentCompareCombinationCostUsd,
  extrapolateSegmentCompareRunTotalCostUsd,
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
import {
  agendaConceptRows,
  overlaysFromGoldSpans,
  scoreOverlaysAgainstGold,
  sequenceRangesForTimeSpans,
  unionChildSequenceRanges,
  goldCueIndexFromBoxes,
  goldResizeHandlesAtCue,
  goldSpanBorderRoleAtIndex,
  goldSpanEdgeAtIndex,
  addGoldSpanReplacingOverlaps,
  buildGoldLabelCueSegmentMeta,
  goldSpanFromCueIndexRange,
  resolveGoldSpanCueIndices,
} from "../lib/meeting-v2/segment-gold-standard";

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

  it("extrapolates in-flight spend from walk step counters", () => {
    assert.equal(
      extrapolateSegmentCompareRunTotalCostUsd(0.21, "Walk 7/21"),
      0.63,
    );
    const display = cellRunningCostDisplay(
      {
        id: "run-live",
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: null,
        status: "running",
        progressLabel: "Walk 7/21",
        error: null,
        walk: { modelId: "deepseek-v4-flash", thinking: false },
        edge: { modelId: "deepseek-v4-flash", thinking: false },
        overlays: [],
        walkUsage: null,
        edgeUsage: null,
        totalCostUsd: 0.21,
      },
      { modelId: "deepseek-v4-flash", thinking: false },
      { modelId: "deepseek-v4-flash", thinking: false },
      null,
    );
    assert.equal(display.spentText, "$0.210");
    assert.equal(display.estimatedText, "Est. $0.630");
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

describe("segment gold standard", () => {
  it("scores identical overlays at 100% IoU", () => {
    const gold = overlaysFromGoldSpans(
      [{ id: "a", code: "4.A.1", title: "Booster", isLeaf: true, depth: 2 }],
      [{ agendaItemId: "a", startSeconds: 40, endSeconds: 110 }],
    );
    const score = scoreOverlaysAgainstGold(gold, gold);
    assert.equal(score?.meanIou, 1);
  });

  it("scores a half-overlap as 1/3 IoU", () => {
    const gold = overlaysFromGoldSpans(
      [{ id: "a", code: "2", title: "Minutes", isLeaf: true, depth: 0 }],
      [{ agendaItemId: "a", startSeconds: 0, endSeconds: 100 }],
    );
    const predicted = overlaysFromGoldSpans(
      [{ id: "x", code: "2", title: "Minutes", isLeaf: true, depth: 0 }],
      [{ agendaItemId: "x", startSeconds: 50, endSeconds: 150 }],
    );
    const score = scoreOverlaysAgainstGold(predicted, gold);
    assert.ok(score);
    assert.ok(Math.abs(score.meanIou - 50 / 150) < 1e-9);
  });

  it("labels a single clicked cue row without time-overlap bleed on the next row", () => {
    const cues = transcriptSegmentsToCues([
      {
        startTimestamp: "00:10:00.000",
        endTimestamp: "00:10:05.000",
        speakerLabel: "Haider",
        text: "First line",
      },
      {
        startTimestamp: "00:10:04.500",
        endTimestamp: "00:10:09.000",
        speakerLabel: "Paul",
        text: "Second line",
      },
    ]);
    const concepts = [{ id: "b", code: "4.B.5", title: "Topic", isLeaf: true, depth: 2 }];
    const span = goldSpanFromCueIndexRange("b", 0, 0, cues);
    const meta = buildGoldLabelCueSegmentMeta(cues, concepts, [span]);
    assert.equal(meta[0]?.sections[0]?.code, "4.B.5");
    assert.equal(meta[1]?.sections.length, 0);
  });

  it("keeps disjoint spans for the same agenda item when labeling again", () => {
    const cues = transcriptSegmentsToCues([
      {
        startTimestamp: "00:05:00.000",
        endTimestamp: "00:05:05.000",
        speakerLabel: "A",
        text: "first visit",
      },
      {
        startTimestamp: "00:08:00.000",
        endTimestamp: "00:08:05.000",
        speakerLabel: "B",
        text: "other topic",
      },
      {
        startTimestamp: "00:12:00.000",
        endTimestamp: "00:12:05.000",
        speakerLabel: "A",
        text: "revisit",
      },
    ]);
    const first = goldSpanFromCueIndexRange("leaf", 0, 0, cues);
    const second = goldSpanFromCueIndexRange("leaf", 2, 2, cues);
    const merged = addGoldSpanReplacingOverlaps([first], second, cues);
    assert.equal(merged.length, 2);
    assert.equal(merged.every((span) => span.agendaItemId === "leaf"), true);
    const meta = buildGoldLabelCueSegmentMeta(
      cues,
      [{ id: "leaf", code: "4.A.1", title: "T", isLeaf: true, depth: 0 }],
      merged,
    );
    assert.equal(meta[0]?.sections.length, 1);
    assert.equal(meta[1]?.sections.length, 0);
    assert.equal(meta[2]?.sections.length, 1);
  });

  it("shrinks a span to one cue row when dragging the end handle up", () => {
    const cues = transcriptSegmentsToCues([
      {
        startTimestamp: "00:10:00.000",
        endTimestamp: "00:10:05.000",
        speakerLabel: "Haider",
        text: "A",
      },
      {
        startTimestamp: "00:10:05.500",
        endTimestamp: "00:10:10.000",
        speakerLabel: "Paul",
        text: "B",
      },
    ]);
    const span = goldSpanFromCueIndexRange("b", 0, 1, cues);
    const shrunk = goldSpanFromCueIndexRange(
      "b",
      resolveGoldSpanCueIndices(span, cues).lo,
      0,
      cues,
    );
    assert.equal(shrunk.endCueIndex, 0);
    const meta = buildGoldLabelCueSegmentMeta(cues, [{ id: "b", code: "4.B.5", title: "T", isLeaf: true, depth: 0 }], [shrunk]);
    assert.equal(meta.filter((row) => row.sections.length > 0).length, 1);
  });

  it("maps overlapping cues to closed sequence ranges", () => {
    const ranges = sequenceRangesForTimeSpans(
      [{ startSeconds: 10, endSeconds: 25 }],
      [
        { sequence: 1, startTimestamp: "00:00:00.000", endTimestamp: "00:00:08.000" },
        { sequence: 2, startTimestamp: "00:00:09.000", endTimestamp: "00:00:14.000" },
        { sequence: 3, startTimestamp: "00:00:15.000", endTimestamp: "00:00:22.000" },
        { sequence: 4, startTimestamp: "00:00:30.000", endTimestamp: "00:00:40.000" },
      ],
    );
    assert.deepEqual(ranges, [[2, 3]]);
  });

  it("excludes a transcript segment that only touches the span end instant", () => {
    const ranges = sequenceRangesForTimeSpans(
      [{ startSeconds: 9, endSeconds: 14 }],
      [
        { sequence: 2, startTimestamp: "00:00:09.000", endTimestamp: "00:00:14.000" },
        { sequence: 3, startTimestamp: "00:00:14.000", endTimestamp: "00:00:22.000" },
      ],
    );
    assert.deepEqual(ranges, [[2, 2]]);
  });

  it("excludes cross-talk boundary segments when mapping spans to sequence ranges", () => {
    const ranges = sequenceRangesForTimeSpans(
      [{ startSeconds: 949.414, endSeconds: 996.374 }],
      [
        { sequence: 183, startTimestamp: "00:15:44.614", endTimestamp: "00:15:49.654" }, // ends 0.24s after span start
        { sequence: 184, startTimestamp: "00:15:49.414", endTimestamp: "00:15:58.614" },
        { sequence: 189, startTimestamp: "00:16:32.054", endTimestamp: "00:16:36.374" },
        { sequence: 190, startTimestamp: "00:16:35.014", endTimestamp: "00:16:38.934" }, // starts 1.36s before span end
      ],
    );
    assert.deepEqual(ranges, [[184, 189]]);
  });

  it("unions leaf ranges onto parent outline items", () => {
    const items = [
      { id: "parent", itemNumber: "4", title: "Projects" },
      { id: "child", itemNumber: "4.A", title: "Booster" },
    ];
    const rows = agendaConceptRows(items);
    assert.equal(rows.find((row) => row.id === "parent")?.isLeaf, false);
    assert.equal(rows.find((row) => row.id === "child")?.isLeaf, true);
    const unioned = unionChildSequenceRanges(
      items,
      new Map([["child", [[10, 20] as [number, number]]]]),
    );
    assert.deepEqual(unioned.get("parent"), [[10, 20]]);
  });

  it("keeps an end-edge drag on the upper cue when the pointer is in the gap below it but above midpoint", () => {
    const boxes = [
      { index: 10, top: 100, bottom: 140 },
      { index: 11, top: 152, bottom: 192 },
    ];
    // Midpoint is 146
    assert.equal(goldCueIndexFromBoxes(140, "end", boxes), 10);
    assert.equal(goldCueIndexFromBoxes(145, "end", boxes), 10);
    assert.equal(goldCueIndexFromBoxes(152, "end", boxes), 11);
  });

  it("maps start-edge drag symmetrically using continuous midpoint bands without gap dead-zones", () => {
    const boxes = [
      { index: 10, top: 100, bottom: 140 },
      { index: 11, top: 152, bottom: 192 },
    ];
    // Midpoint is 146: dragging up past 146 cleanly transitions to cue 10
    assert.equal(goldCueIndexFromBoxes(152, "start", boxes), 11);
    assert.equal(goldCueIndexFromBoxes(148, "start", boxes), 11);
    assert.equal(goldCueIndexFromBoxes(145, "start", boxes), 10);
    assert.equal(goldCueIndexFromBoxes(140, "start", boxes), 10);
  });

  it("maps dead space below a long cue box to that cue row when resizing the span end", () => {
    const boxes = [
      { index: 4, top: 400, bottom: 600 },
      { index: 5, top: 600, bottom: 630 },
    ];
    assert.equal(goldCueIndexFromBoxes(580, "end", boxes), 4);
    assert.equal(goldCueIndexFromBoxes(610, "start", boxes), 5);
  });

  it("treats nested and identical gold spans as separate first/last edges", () => {
    const outer = [true, true, true, true];
    const inner = [false, true, true, false];
    assert.equal(goldSpanEdgeAtIndex(0, outer), "start");
    assert.equal(goldSpanEdgeAtIndex(1, outer), "none");
    assert.equal(goldSpanEdgeAtIndex(1, inner), "start");
    assert.equal(goldSpanEdgeAtIndex(2, inner), "end");
    assert.equal(goldSpanBorderRoleAtIndex(1, inner), "first");
    assert.equal(goldSpanBorderRoleAtIndex(2, inner), "last");
    const same = [true, true, true];
    assert.equal(goldSpanEdgeAtIndex(0, same), "start");
    assert.equal(goldSpanEdgeAtIndex(2, same), "end");
  });

  it("suppresses resize handles so an unlabeled leaf can be clicked inside another span", () => {
    const coverageByItem = new Map([
      ["a", [true, true, true]],
    ]);
    assert.deepEqual(
      goldResizeHandlesAtCue({
        cueIndex: 0,
        coverageByItem,
        preferredAgendaItemId: "b",
        suppressHandles: true,
      }),
      { startAgendaItemId: null, endAgendaItemId: null },
    );
  });

  it("splits coincident abutting edges onto the two items that own them", () => {
    const coverageByItem = new Map([
      ["a", [true, true, false, false]],
      ["b", [false, false, true, true]],
    ]);
    assert.deepEqual(
      goldResizeHandlesAtCue({
        cueIndex: 1,
        coverageByItem,
        preferredAgendaItemId: null,
        suppressHandles: false,
      }),
      { startAgendaItemId: null, endAgendaItemId: "a" },
    );
    assert.deepEqual(
      goldResizeHandlesAtCue({
        cueIndex: 2,
        coverageByItem,
        preferredAgendaItemId: null,
        suppressHandles: false,
      }),
      { startAgendaItemId: "b", endAgendaItemId: null },
    );
  });
});
