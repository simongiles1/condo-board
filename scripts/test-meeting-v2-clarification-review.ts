import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clarificationReviewReadyForReEvaluate,
  openQuestionsFullyAnswered,
} from "@/lib/meeting-v2/clarification-review";
import { factResolutionClarificationPrompts, parseFactResolution, type EvidenceSource } from "@/lib/meeting-v2/evidence-contract";
import {
  isConfirmingClarification,
  omitOpenQuestionsAnsweredByUser,
  UNKNOWN_CLARIFICATION,
  userAnswerForOpenQuestion,
} from "@/lib/meeting-v2/investigation-contract";
import {
  buildItemReviewQuestions,
  normalizeDrawerClarifications,
  storedAnswerForReviewQuestion,
} from "@/lib/meeting-v2/review-questions";

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

test("I don't know does not confirm a question", () => {
  assert.equal(isConfirmingClarification(UNKNOWN_CLARIFICATION), false);
  assert.equal(openQuestionsFullyAnswered(["Q1"], { Q1: UNKNOWN_CLARIFICATION }), false);
  const visible = omitOpenQuestionsAnsweredByUser(
    [{ question: "Was the project approved today?", recommended_answer: "", confidence: "low", context_notes: [] }],
    { "Was the project approved today?": UNKNOWN_CLARIFICATION },
  );
  assert.equal(visible.length, 1);
});

test("review questions keep one id when the prompt is reworded", () => {
  const built = buildItemReviewQuestions({
    factResolution: {
      facts: [
        {
          field: "approval",
          scope: "current_decision",
          selected: null,
          candidates: [
            { value: "Either way, we approve.", sourceId: "transcript:1", quote: "Either way, we approve." },
            { value: "I just wanted to get approval.", sourceId: "transcript:2", quote: "I just wanted to get approval." },
          ],
        },
        {
          field: "approval",
          scope: "prior_approval",
          selected: null,
          candidates: [
            { value: "Approved at the last meeting.", sourceId: "transcript:3", quote: "We approved it at the last meeting." },
          ],
        },
      ],
      unresolvedQuestions: [
        "Whether the board made a current decision to approve moving forward with the Stairwell F maglock project at this meeting.",
        "Whether the board previously approved the Stairwell F maglock project at an earlier meeting.",
        "Could not use a malformed fact record for auditor availability confirmation.",
      ],
    },
    openQuestions: [
      {
        question: "Did the board approve proceeding at this meeting?",
        recommended_answer: "The board approved proceeding.",
        answer_options: ["The board approved proceeding.", "No decision at this meeting."],
        confidence: "low",
        context_notes: [{ fact: "Shawna said I'll make it work.", source: "transcript" }],
      },
    ],
  });
  assert.equal(built.questions.filter((question) => question.id.includes("approval")).length, 2);
  assert.equal(built.questions.some((question) => question.prompt.includes("·")), false);
  assert.equal(built.processingFailures.length, 1);
  const current = built.questions.find((question) => question.id === "fact:current-decision:approval");
  assert.ok(current);
  assert.equal(current.options.includes("Either way, we approve."), true);
  assert.equal(
    storedAnswerForReviewQuestion(
      { id: current.id, prompt: "A completely different sentence?" },
      { [current.id]: "Either way, we approve." },
    ),
    "Either way, we approve.",
  );
});

test("a shorter package name is a question, not an internal error", () => {
  const sources: EvidenceSource[] = [
    { id: "document:1", kind: "document", association: "direct", text: "Absolute Interior will perform the work." },
    { id: "transcript:1", kind: "transcript", association: "direct", text: "Absolute can do the work." },
  ];
  const parsed = parseFactResolution({
    facts: [{
      field: "contractor",
      scope: "discussion",
      explanation: "Speakers used a short name.",
      selected: 0,
      candidates: [
        { value: "Absolute Interior", sourceId: "document:1", quote: "Absolute Interior will perform the work." },
        { value: "Absolute", sourceId: "transcript:1", quote: "Absolute can do the work." },
      ],
    }],
    unresolvedQuestions: [],
  }, sources);
  assert.equal(parsed.facts[0].selected, null);
  assert.equal(parsed.processingFailures?.length ?? 0, 0);
  assert.equal(parsed.unresolvedQuestions.some((question) => /package evidence/.test(question)), false);
  const review = buildItemReviewQuestions({ factResolution: parsed });
  assert.equal(review.questions.length, 1);
  assert.equal(review.questions[0].id, "fact:discussion:contractor");
  assert.deepEqual(review.questions[0].options, ["Absolute Interior", "Absolute"]);
});

test("a stored package-conflict message does not hide the name question", () => {
  const review = buildItemReviewQuestions({
    factResolution: {
      facts: [{
        field: "contractor",
        scope: "discussion",
        explanation: "Speakers used a short name.",
        selected: null,
        candidates: [
          { value: "Absolute Interior", sourceId: "document:1", quote: "Absolute Interior" },
          { value: "Absolute", sourceId: "transcript:1", quote: "Absolute" },
        ],
      }],
      unresolvedQuestions: [
        "Could not accept package evidence over meeting evidence for contractor.",
      ],
    },
  });
  assert.equal(review.processingFailures.length, 0);
  assert.equal(review.questions.length, 1);
  assert.deepEqual(review.questions[0].options, ["Absolute Interior", "Absolute"]);
  assert.equal(review.questions[0].notes.some((note) => /package evidence/.test(note.fact)), false);
});

test("legacy factClarificationsNeeded maps malformed rows to retry", () => {
  const normalized = normalizeDrawerClarifications({
    openQuestions: [],
    factClarificationsNeeded: [
      "Could not use a malformed fact record for auditor availability confirmation.",
      "Could not use a malformed fact record for notify Michael and Condo Nexus.",
    ],
  });
  assert.equal(normalized.reviewQuestions.length, 0);
  assert.equal(normalized.processingFailures.length, 2);
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
