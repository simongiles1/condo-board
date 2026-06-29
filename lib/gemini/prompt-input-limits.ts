/** Character caps for Gemini user prompts — keep total input well within model context. */
export const PROMPT_INPUT_LIMITS = {
  referencePdf: 120_000,
  boardPackage: 150_000,
  transcript: 600_000,
  minutesJson: 120_000,
  todosMarkdown: 80_000,
  goldStandardPdf: 150_000,
} as const;

export type PromptInputSliceResult = {
  text: string;
  truncated: boolean;
  omittedChars: number;
  originalLength: number;
};

export function sliceForPrompt(
  text: string,
  maxChars: number,
): PromptInputSliceResult {
  const originalLength = text.length;
  if (originalLength <= maxChars) {
    return {
      text,
      truncated: false,
      omittedChars: 0,
      originalLength,
    };
  }

  return {
    text: text.slice(0, maxChars),
    truncated: true,
    omittedChars: originalLength - maxChars,
    originalLength,
  };
}

export function inputTruncationWarning(
  label: string,
  result: PromptInputSliceResult,
  maxChars: number,
): string {
  return `${label} was truncated for the prompt (${result.originalLength.toLocaleString()} chars → ${maxChars.toLocaleString()} chars; ${result.omittedChars.toLocaleString()} chars at the end omitted). Later content may be missing from the AI input.`;
}
