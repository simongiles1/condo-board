/**
 * V3 AI usage stage builders.
 * Run: npx tsx --test scripts/test-meeting-v3-ai-usage.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMeetingsV3DeepSeekStageRow,
  buildMeetingsV3GeminiStageRow,
  buildMeetingsV3NotApplicableStageRow,
  MEETINGS_V3_AI_USAGE_STAGE_IDS,
} from "../lib/meeting-v3/ai-usage";

describe("v3 ai usage stages", () => {
  it("sums Gemini page correction tokens", () => {
    const row = buildMeetingsV3GeminiStageRow("v3_correct", [
      {
        step: "page_vision",
        modelName: "gemini-test",
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
      },
      {
        step: "page_vision",
        modelName: "gemini-test",
        inputTokens: 50,
        outputTokens: 10,
        totalTokens: 60,
      },
    ]);
    assert.equal(row.id, "v3_correct");
    assert.equal(row.inputTokens, 150);
    assert.equal(row.outputTokens, 50);
    assert.equal(row.modelName, "gemini-test");
    assert.ok((row.totalCostUsd ?? 0) > 0);
  });

  it("sums DeepSeek agenda tokens with cache fields", () => {
    const row = buildMeetingsV3DeepSeekStageRow("v3_agenda", [
      {
        text: "{}",
        modelName: "deepseek-v4-flash",
        finishReason: "stop",
        usage: {
          inputTokens: 1000,
          outputTokens: 200,
          totalTokens: 1200,
          cacheHitTokens: 400,
          cacheMissTokens: 600,
        },
      },
    ]);
    assert.equal(row.id, "v3_agenda");
    assert.equal(row.inputTokens, 1000);
    assert.equal(row.outputTokens, 200);
    assert.equal(row.cacheHitTokens, 400);
    assert.equal(row.cacheMissTokens, 600);
  });

  it("marks Docling ingest as not applicable", () => {
    const row = buildMeetingsV3NotApplicableStageRow("v3_ingest", {
      modelName: "IBM Docling",
      usageDetail: "12 pages processed",
    });
    assert.equal(row.notApplicable, true);
    assert.equal(row.usageDetail, "12 pages processed");
  });

  it("orders stage ids for storage", () => {
    assert.deepEqual(MEETINGS_V3_AI_USAGE_STAGE_IDS, [
      "v3_ingest",
      "v3_correct",
      "v3_agenda",
      "v3_attachments",
      "v3_facts",
      "v3_transcript",
      "v3_sources",
    ]);
  });
});
