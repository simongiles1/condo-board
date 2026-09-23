import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clarificationReviewReadyForReEvaluate,
  openQuestionsFullyAnswered,
} from "@/lib/meeting-v2/clarification-review";
import { factResolutionClarificationPrompts } from "@/lib/meeting-v2/evidence-contract";
import {
  omitOpenQuestionsAnsweredByUser,
  userAnswerForOpenQuestion,
} from "@/lib/meeting-v2/investigation-contract";

test("openQuestionsFullyAnswered requires every question", () => {
  assert.equal(openQuestionsFullyAnswered(["Q1", "Q2"], { Q1: "yes" }), false);
  assert.equal(openQuestionsFullyAnswered(["Q1", "Q2"], { Q1: "yes", Q2: "no" }), true);
  assert.equal(openQuestionsFullyAnswered([], { Q1: "yes" }), false);
});

test("clarificationReviewReadyForReEvaluate blocks dirty or partial items", () => {
  const items = [
    { id: "a", pipelineOpenQuestions: ["Q1"] },
    { id: "b", pipelineOpenQuestions: ["Q2"] },
  ];
  assert.equal(
    clarificationReviewReadyForReEvaluate({
      items,
      answers: { a: { Q1: "x" }, b: { Q2: "y" } },
      dirtyItems: {},
    }),
    true,
  );
  assert.equal(
    clarificationReviewReadyForReEvaluate({
      items,
      answers: { a: { Q1: "x" }, b: { Q2: "" } },
      dirtyItems: {},
    }),
    false,
  );
  assert.equal(
    clarificationReviewReadyForReEvaluate({
      items,
      answers: { a: { Q1: "x" }, b: { Q2: "y" } },
      dirtyItems: { b: true },
    }),
    false,
  );
});

test("userAnswerForOpenQuestion matches normalized question text", () => {
  const answers = { "Was the $12,500 quote approved?": "Yes, the board approved the quote." };
  assert.equal(
    userAnswerForOpenQuestion("Was the 12500 quote approved", answers),
    "Yes, the board approved the quote.",
  );
  const visible = omitOpenQuestionsAnsweredByUser(
    [{ question: "Was the 12500 quote approved", recommended_answer: "", confidence: "low", context_notes: [] }],
    answers,
  );
  assert.equal(visible.length, 0);
});

test("factResolutionClarificationPrompts lists unresolved ledger fields", () => {
  const prompts = factResolutionClarificationPrompts({
    facts: [
      {
        field: "date",
        scope: "current_decision",
        candidates: [{ value: "Oct 19", sourceId: "t:1", quote: "October 19" }],
        selected: null,
        explanation: "",
      },
    ],
    unresolvedQuestions: ["Which auditor was confirmed?"],
  });
  assert.equal(prompts.length, 2);
});
