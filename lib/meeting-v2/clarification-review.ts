import { userAnswerForOpenQuestion } from "./investigation-contract";

/**
 * Whether every open question on an item has a non-empty answer in the working map.
 */
export function openQuestionsFullyAnswered(
  openQuestions: readonly string[],
  itemAnswers: Record<string, string> | undefined,
): boolean {
  if (openQuestions.length === 0) return false;
  const answers = itemAnswers ?? {};
  for (const question of openQuestions) {
    if (!userAnswerForOpenQuestion(question, answers)) return false;
  }
  return true;
}

/**
 * Whether every pipeline open question has a saved, non-dirty clarification ready for re-evaluation.
 */
export function clarificationReviewReadyForReEvaluate(input: {
  items: ReadonlyArray<{ id: string; pipelineOpenQuestions: readonly string[] }>;
  answers: Record<string, Record<string, string>>;
  dirtyItems: Record<string, boolean>;
}): boolean {
  const withQuestions = input.items.filter((item) => item.pipelineOpenQuestions.length > 0);
  if (withQuestions.length === 0) return false;
  for (const item of withQuestions) {
    if (input.dirtyItems[item.id]) return false;
    if (!openQuestionsFullyAnswered(item.pipelineOpenQuestions, input.answers[item.id])) return false;
  }
  return true;
}
