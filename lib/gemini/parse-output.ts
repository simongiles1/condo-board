import {
  detectMinutesJsonIssues,
  validateMinutesJson,
  type MinutesDocument,
} from "@/lib/minutes/schema";
import {
  detectMinutesV2Issues,
  validateMinutesV2,
  type MinutesDocumentV2,
} from "@/lib/minutes/schema-v2";
import {
  validateOmissionsAnalysis,
  validateTodoOmissionsAnalysis,
  type OmissionsAnalysisResult,
  type TodoOmissionFinding,
} from "@/lib/minutes/omissions-schema";
import {
  validateGlobalTodosMergeResult,
  type GlobalTodosMergeResult,
} from "@/lib/todos/merge-global-schema";
import {
  validateVerificationAnalysis,
  type DecisionFlag,
} from "@/lib/minutes/verification-schema";
import {
  validateGoldStandardValidation,
  type GoldStandardValidationResult,
} from "@/lib/minutes/gold-standard-schema";

export type ParsedModelOutput = {
  markdown: string;
  warnings: string[];
};

/** Gemini responds with a fenced markdown block — strip fences. */
export function unwrapMarkdownCodeBlock(raw: string): ParsedModelOutput {
  const warnings: string[] = [];
  let text = raw.trim();

  const fenced =
    /^```(?:markdown|md)?\s*\r?\n([\s\S]*)\r?\n```\s*$/im.exec(text);
  if (fenced) {
    return { markdown: fenced[1].trim(), warnings };
  }

  if (text.startsWith("```")) {
    warnings.push(
      "Model output was missing a closing markdown fence — minutes may be truncated.",
    );
    text = text.replace(/^```(?:markdown|md)?[^\n]*\n?/i, "").trim();
  }

  return { markdown: text, warnings };
}

export type ParsedJsonOutput = {
  jsonText: string;
  warnings: string[];
};

/** Strip \`\`\`json fences from model output. */
export function unwrapJsonCodeBlock(raw: string): ParsedJsonOutput {
  const warnings: string[] = [];
  let text = raw.trim();

  const fenced =
    /^```(?:json)?\s*\r?\n([\s\S]*)\r?\n```\s*$/im.exec(text);
  if (fenced) {
    return { jsonText: fenced[1].trim(), warnings };
  }

  if (text.startsWith("```")) {
    warnings.push(
      "Model output may be missing a closing JSON fence — parsing may fail.",
    );
    text = text
      .replace(/^```(?:json)?[^\n]*\n?/i, "")
      .replace(/\r?\n```\s*$/i, "")
      .trim();
  }

  return { jsonText: text, warnings };
}

/** Unwrap fences, then extract the outermost `{…}` if needed for best-effort parse. */
export function extractBestEffortJson(raw: string): ParsedJsonOutput {
  const unwrapped = unwrapJsonCodeBlock(raw);

  if (!unwrapped.jsonText) {
    return unwrapped;
  }

  try {
    JSON.parse(unwrapped.jsonText);
    return unwrapped;
  } catch {
    const start = unwrapped.jsonText.indexOf("{");
    const end = unwrapped.jsonText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = unwrapped.jsonText.slice(start, end + 1);
      try {
        JSON.parse(slice);
        return {
          jsonText: slice,
          warnings: [
            ...unwrapped.warnings,
            "Extracted JSON object from surrounding non-JSON text.",
          ],
        };
      } catch {
        /* fall through */
      }
    }
  }

  return unwrapped;
}

function jsonParseFailureDetail(jsonText: string): string {
  const trimmed = jsonText.trim();
  if (!trimmed) {
    return "Model output was empty.";
  }

  if (
    trimmed.endsWith(",") ||
    /:\s*$/.test(trimmed) ||
    /,\s*$/.test(trimmed) ||
    !trimmed.endsWith("}")
  ) {
    return "Model output looks truncated — JSON ends before the document is complete.";
  }

  return "Model output is not valid JSON.";
}

export type ParsedMinutesJsonResult = {
  document: MinutesDocument | null;
  warnings: string[];
  errors: string[];
};

export type ParsedMinutesV2Result = {
  document: MinutesDocumentV2 | null;
  warnings: string[];
  errors: string[];
};

/** Parse native JSON minutes response and validate v2 schema. */
export function parseMinutesV2Response(raw: string): ParsedMinutesV2Result {
  const { jsonText, warnings: unwrapWarnings } = unwrapJsonCodeBlock(raw);
  const warnings: string[] = [...unwrapWarnings];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return {
      document: null,
      warnings,
      errors: ["Model output is not valid JSON."],
    };
  }

  const validated = validateMinutesV2(parsed);
  const allWarnings = [...warnings, ...validated.warnings];

  if (!validated.value) {
    return {
      document: null,
      warnings: allWarnings,
      errors: validated.errors,
    };
  }

  allWarnings.push(...detectMinutesV2Issues(validated.value));

  return {
    document: validated.value,
    warnings: allWarnings,
    errors: [],
  };
}

/** Unwrap fence, parse JSON, validate and run heuristics. */
export function parseMinutesJsonResponse(raw: string): ParsedMinutesJsonResult {
  const { jsonText, warnings } = unwrapJsonCodeBlock(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return {
      document: null,
      warnings,
      errors: ["Model output is not valid JSON after stripping fences."],
    };
  }

  const validated = validateMinutesJson(parsed);
  const allWarnings = [...warnings, ...validated.warnings];

  if (!validated.value) {
    return {
      document: null,
      warnings: allWarnings,
      errors: validated.errors,
    };
  }

  allWarnings.push(...detectMinutesJsonIssues(validated.value));

  return {
    document: validated.value,
    warnings: allWarnings,
    errors: [],
  };
}

export function detectTruncatedMinutes(markdown: string): string[] {
  const warnings: string[] = [];
  const trimmed = markdown.trim();

  if (!trimmed) {
    warnings.push("Minutes output was empty.");
    return warnings;
  }

  if (/["“][^"”\n]*$/.test(trimmed)) {
    warnings.push("Minutes appear to end mid-sentence.");
  }

  if (
    trimmed.length < 2500 &&
    !/adjourn|concluded|meeting was (adjourned|concluded)/i.test(trimmed)
  ) {
    warnings.push(
      "Minutes look unusually short and may be incomplete (no adjournment found).",
    );
  }

  return warnings;
}

export function validateMinutesOutput(md: string): string[] {
  const w: string[] = [];
  if (!/motion\s+by/i.test(md)) {
    w.push("No MOTION pattern detected.");
  }
  return w;
}

export function validateTodosOutput(md: string): string[] {
  const w: string[] = [];
  if (!/^###\s+/m.test(md)) {
    w.push('Expected headings like "### Name - Role".');
  }
  if (!/^-\s*\[\s?\]/m.test(md)) {
    w.push("Expected markdown checklists `- [ ]`.");
  }
  return w;
}

export type ParsedOmissionsResult = {
  analysis: OmissionsAnalysisResult | null;
  warnings: string[];
  errors: string[];
};

/** Parse native JSON omissions analysis response and validate schema. */
export function parseOmissionsResponse(raw: string): ParsedOmissionsResult {
  const { jsonText, warnings: unwrapWarnings } = extractBestEffortJson(raw);
  const warnings: string[] = [...unwrapWarnings];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return {
      analysis: null,
      warnings,
      errors: [jsonParseFailureDetail(jsonText)],
    };
  }

  const validated = validateOmissionsAnalysis(parsed);
  const allWarnings = [...warnings, ...validated.warnings];

  if (!validated.value) {
    return {
      analysis: null,
      warnings: allWarnings,
      errors: validated.errors,
    };
  }

  return {
    analysis: validated.value,
    warnings: allWarnings,
    errors: [],
  };
}

export type ParsedTodoOmissionsResult = {
  omissions: TodoOmissionFinding[];
  noSignificantTodosOmissions?: boolean;
  analyzedAt?: string;
  warnings: string[];
  errors: string[];
};

/** Parse native JSON todos omissions response. */
export function parseTodoOmissionsResponse(raw: string): ParsedTodoOmissionsResult {
  const { jsonText, warnings: unwrapWarnings } = extractBestEffortJson(raw);
  const warnings: string[] = [...unwrapWarnings];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return {
      omissions: [],
      warnings,
      errors: [jsonParseFailureDetail(jsonText)],
    };
  }

  const validated = validateTodoOmissionsAnalysis(parsed);
  const allWarnings = [...warnings, ...validated.warnings];

  if (!validated.value) {
    return {
      omissions: [],
      warnings: allWarnings,
      errors: validated.errors,
    };
  }

  return {
    omissions: validated.value.todosOmissions,
    noSignificantTodosOmissions: validated.value.noSignificantTodosOmissions,
    analyzedAt: validated.value.analyzedAt,
    warnings: allWarnings,
    errors: [],
  };
}

export type ParsedVerificationResult = {
  flags: DecisionFlag[];
  noIssues: boolean;
  analyzedAt?: string;
  warnings: string[];
  errors: string[];
};

/** Parse native JSON decision-verification response. */
export function parseVerificationResponse(raw: string): ParsedVerificationResult {
  const { jsonText, warnings: unwrapWarnings } = extractBestEffortJson(raw);
  const warnings: string[] = [...unwrapWarnings];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return {
      flags: [],
      noIssues: false,
      warnings,
      errors: [jsonParseFailureDetail(jsonText)],
    };
  }

  const validated = validateVerificationAnalysis(parsed);
  const allWarnings = [...warnings, ...validated.warnings];

  if (validated.errors.length > 0) {
    return {
      flags: [],
      noIssues: false,
      analyzedAt: validated.analyzedAt || undefined,
      warnings: allWarnings,
      errors: validated.errors,
    };
  }

  return {
    flags: validated.flags,
    noIssues: validated.noIssues,
    analyzedAt: validated.analyzedAt || undefined,
    warnings: allWarnings,
    errors: [],
  };
}

export type ParsedGlobalTodosMerge = {
  result: GlobalTodosMergeResult | null;
  warnings: string[];
  errors: string[];
};

export function parseGlobalTodosMergeResponse(raw: string): ParsedGlobalTodosMerge {
  const { jsonText, warnings } = unwrapJsonCodeBlock(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return {
      result: null,
      warnings,
      errors: ["Model output is not valid JSON."],
    };
  }

  const validated = validateGlobalTodosMergeResult(parsed);

  if (!validated.ok) {
    return {
      result: null,
      warnings,
      errors: [validated.error],
    };
  }

  return {
    result: validated.result,
    warnings,
    errors: [],
  };
}

export type ParsedGoldStandardValidationResult = {
  validation: GoldStandardValidationResult | null;
  warnings: string[];
  errors: string[];
};

export function parseGoldStandardValidationResponse(
  raw: string,
): ParsedGoldStandardValidationResult {
  const { jsonText, warnings: unwrapWarnings } = extractBestEffortJson(raw);
  const warnings: string[] = [...unwrapWarnings];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return {
      validation: null,
      warnings,
      errors: [jsonParseFailureDetail(jsonText)],
    };
  }

  const validated = validateGoldStandardValidation(parsed);
  const allWarnings = [...warnings, ...validated.warnings];

  if (!validated.value) {
    return {
      validation: null,
      warnings: allWarnings,
      errors: validated.errors,
    };
  }

  return {
    validation: validated.value,
    warnings: allWarnings,
    errors: [],
  };
}
