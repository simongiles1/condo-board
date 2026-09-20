/**
 * Item pipeline debugger helpers.
 * Run: npx tsx --test scripts/test-meeting-v2-item-debug.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildItemDebugAgentBundleFromRun } from "../lib/meeting-v2/item-debug-agent-bundle";
import {
  ITEM_DEBUG_STEPS,
  firstIncompleteItemDebugStepIndex,
  formatItemDebugRunLabel,
  isItemDebugStepNavigable,
  missingPrerequisite,
  recomputeItemDebugRunTotals,
  summarizeItemDebugRun,
  type ItemDebugRun,
  type ItemDebugStep,
} from "../lib/meeting-v2/item-debug-models";

function stubStep(key: ItemDebugStep["key"], status: ItemDebugStep["status"]): ItemDebugStep {
  return {
    key,
    status,
    modelId: "deepseek-v4-flash",
    thinking: false,
    systemPrompt: "",
    userPrompt: "",
    outputText: null,
    parsedOutput: null,
    usage:
      status === "completed"
        ? {
            modelId: "deepseek-v4-flash",
            apiModel: "deepseek-v4-flash",
            thinking: false,
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            costUsd: 0.002,
          }
        : null,
    durationMs: null,
    error: null,
    ranAt: null,
  };
}

describe("item debug steps", () => {
  it("orders evidence, facts, investigate, validate, then draft", () => {
    assert.deepEqual(
      ITEM_DEBUG_STEPS.map((step) => step.key),
      ["evidence", "facts", "investigate", "validate", "draft"],
    );
  });

  it("blocks later LLM steps until prerequisites complete", () => {
    const steps = ITEM_DEBUG_STEPS.map((meta) => stubStep(meta.key, "idle"));
    assert.equal(missingPrerequisite(steps, "evidence"), null);
    assert.equal(missingPrerequisite(steps, "facts"), "evidence");
    steps[0].status = "completed";
    assert.equal(missingPrerequisite(steps, "facts"), null);
    assert.equal(missingPrerequisite(steps, "investigate"), "facts");
    assert.equal(missingPrerequisite(steps, "draft"), "investigate");
  });

  it("sums token spend across completed steps", () => {
    const totals = recomputeItemDebugRunTotals([
      stubStep("evidence", "completed"),
      stubStep("facts", "completed"),
      stubStep("investigate", "idle"),
    ]);
    assert.equal(totals.totalInputTokens, 200);
    assert.equal(totals.totalOutputTokens, 100);
    assert.equal(totals.totalCostUsd, 0.004);
  });

  it("labels the newest historical run as Latest", () => {
    const run: ItemDebugRun = {
      id: "run-1",
      meetingId: "m",
      agendaItemId: "a",
      status: "idle",
      error: null,
      steps: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      createdAt: "2026-09-20T14:00:00.000Z",
      updatedAt: "2026-09-20T14:00:00.000Z",
    };
    const summary = summarizeItemDebugRun(run);
    assert.match(formatItemDebugRunLabel(summary, 0), /^Latest · /);
    assert.match(formatItemDebugRunLabel(summary, 2), /^Run 3 · /);
  });

  it("dedupes agent export: one evidence blob and refs instead of repeated prompts", () => {
    const evidencePayload = {
      sources: [{ id: "transcript:1", kind: "transcript", text: "hello" }],
      agendaItem: { title: "Test" },
    };
    const factsOutput = { facts: [], unresolvedQuestions: ["ambiguous amount"] };
    const factRequest = JSON.stringify(
      {
        agenda: { title: "Item", itemNumber: "1", itemType: "discussion" },
        sources: evidencePayload.sources,
      },
      null,
      2,
    );
    const run: ItemDebugRun = {
      id: "run-1",
      meetingId: "m",
      agendaItemId: "a",
      status: "idle",
      error: null,
      steps: [
        {
          ...stubStep("evidence", "completed"),
          userPrompt: JSON.stringify(evidencePayload, null, 2),
          outputText: JSON.stringify(evidencePayload, null, 2),
          parsedOutput: evidencePayload,
        },
        {
          ...stubStep("facts", "completed"),
          userPrompt: factRequest,
          outputText: JSON.stringify(factsOutput, null, 2),
          parsedOutput: factsOutput,
        },
        stubStep("investigate", "idle"),
      ],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      createdAt: "2026-09-20T14:00:00.000Z",
      updatedAt: "2026-09-20T14:00:00.000Z",
    };
    const bundle = buildItemDebugAgentBundleFromRun({
      meetingId: "m",
      agendaItemId: "a",
      item: {
        id: "a",
        title: "Item",
        itemNumber: "1",
        itemType: "discussion",
        sectionLabel: null,
      },
      run,
    });
    assert.equal(bundle.schemaVersion, 2);
    assert.equal(JSON.stringify(bundle.evidence), JSON.stringify(evidencePayload));
    const evidenceStep = bundle.steps.find((step) => step.key === "evidence");
    assert.equal(evidenceStep?.userPromptRef, "evidence");
    assert.equal(evidenceStep?.parsedOutput, undefined);
    assert.equal(evidenceStep?.userPrompt, undefined);
    const factsStep = bundle.steps.find((step) => step.key === "facts");
    assert.equal(factsStep?.userPromptRef, "factRequest");
    assert.equal(factsStep?.userPrompt, undefined);
    assert.deepEqual(factsStep?.parsedOutput, factsOutput);
    const investigateStep = bundle.steps.find((step) => step.key === "investigate");
    assert.equal(investigateStep?.systemPrompt, undefined);
    const serialized = JSON.stringify(bundle);
    assert.ok(serialized.length < JSON.stringify(run).length);
  });

  it("opens steps only through the current pipeline frontier", () => {
    const steps = ITEM_DEBUG_STEPS.map((meta) => stubStep(meta.key, "idle"));
    assert.equal(firstIncompleteItemDebugStepIndex(steps), 0);
    assert.equal(isItemDebugStepNavigable(steps, "evidence"), true);
    assert.equal(isItemDebugStepNavigable(steps, "facts"), false);
    steps[0].status = "completed";
    assert.equal(firstIncompleteItemDebugStepIndex(steps), 1);
    assert.equal(isItemDebugStepNavigable(steps, "facts"), true);
    assert.equal(isItemDebugStepNavigable(steps, "investigate"), false);
  });
});
