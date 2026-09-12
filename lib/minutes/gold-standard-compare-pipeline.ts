import { generateOmissionsAnalysis } from "@/lib/gemini/client";
import {
  parseGoldStandardAlignmentsResponse,
  parseGoldStandardConceptsResponse,
  parseGoldStandardPairDiffResponse,
} from "@/lib/gemini/parse-output";
import {
  GOLD_STANDARD_ALIGN_SYSTEM_PROMPT,
  GOLD_STANDARD_PAIR_DIFF_SYSTEM_PROMPT,
  GOLD_STANDARD_SEGMENT_SYSTEM_PROMPT,
} from "@/lib/gemini/prompts";
import {
  inputTruncationWarning,
  PROMPT_INPUT_LIMITS,
  sliceForPrompt,
} from "@/lib/gemini/prompt-input-limits";
import type { TokenUsage } from "@/lib/gemini/usage";
import {
  completeAlignments,
  deriveBidirectionalFindings,
  fallbackMatchedPair,
  fallbackSegmentGoldText,
  joinConceptText,
  scoreCompareDocument,
  unmatchedPair,
} from "@/lib/minutes/gold-standard-compare";
import type { AiMinutesConcept } from "@/lib/minutes/gold-standard-schema";
import type {
  ComparePair,
  GoldStandardCompareDocument,
  GoldStandardConcept,
  GoldStandardValidationResult,
} from "@/lib/minutes/gold-standard-schema";
import { extractPdfPagesWithText } from "@/lib/meeting-v2/pdf";

const PAIR_BATCH_SIZE = 6;

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

export async function extractGoldStandardMinutesText(options: {
  buffer: Buffer;
  pdfPath: string;
}): Promise<{ text: string; pageCount: number; doclingPageCount: number }> {
  const extracted = await extractPdfPagesWithText(options.buffer, {
    pdfPath: options.pdfPath,
    maxDoclingPages: 40,
  });
  const text = extracted.pages
    .map((page) => page.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return {
    text,
    pageCount: extracted.pageCount,
    doclingPageCount: extracted.doclingPageCount,
  };
}

async function generateJson(options: {
  systemInstruction: string;
  userText: string;
}) {
  return generateOmissionsAnalysis(options);
}

function compactConcept(concept: { id: string; heading: string; body: string; kind: string }) {
  return {
    id: concept.id,
    heading: concept.heading,
    kind: concept.kind,
    body: concept.body.length > 900 ? `${concept.body.slice(0, 900).trimEnd()}…` : concept.body,
  };
}

export async function runGoldStandardComparePipeline(options: {
  goldText: string;
  aiConcepts: AiMinutesConcept[];
  meetingTitle: string;
  meetingDate: string;
}): Promise<{
  validation: GoldStandardValidationResult;
  usage: TokenUsage;
  modelName: string;
  warnings: string[];
  truncated: boolean;
  retryCount: number;
}> {
  const warnings: string[] = [];
  let usage = emptyUsage();
  let modelName = "";
  let truncated = false;
  let retryCount = 0;

  const goldSlice = sliceForPrompt(options.goldText, PROMPT_INPUT_LIMITS.goldStandardPdf);
  if (goldSlice.truncated) {
    warnings.push(
      inputTruncationWarning(
        "Gold standard minutes text",
        goldSlice,
        PROMPT_INPUT_LIMITS.goldStandardPdf,
      ),
    );
  }

  const segmentGeneration = await generateJson({
    systemInstruction: GOLD_STANDARD_SEGMENT_SYSTEM_PROMPT,
    userText: `Meeting: ${options.meetingTitle}
Meeting date: ${options.meetingDate}

GOLD STANDARD MINUTES TEXT
<<<
${goldSlice.text}
>>>`,
  });
  usage = addUsage(usage, segmentGeneration.usage);
  modelName = segmentGeneration.modelName;
  truncated = truncated || segmentGeneration.truncated;
  retryCount += segmentGeneration.retryCount;

  const segmented = parseGoldStandardConceptsResponse(segmentGeneration.text);
  warnings.push(...segmented.warnings);
  const goldConcepts: GoldStandardConcept[] =
    segmented.concepts.length > 0
      ? segmented.concepts
      : fallbackSegmentGoldText(goldSlice.text);
  if (segmented.concepts.length === 0) {
    warnings.push(
      "Gold concept segmentation fell back to heading splits because the model returned no usable concepts.",
    );
  }

  if (goldConcepts.length === 0) {
    throw new Error("Gold standard minutes could not be split into concepts.");
  }
  if (options.aiConcepts.length === 0) {
    throw new Error("AI minutes could not be split into concepts.");
  }

  const alignGeneration = await generateJson({
    systemInstruction: GOLD_STANDARD_ALIGN_SYSTEM_PROMPT,
    userText: `Meeting: ${options.meetingTitle}

GOLD CONCEPTS
${JSON.stringify(goldConcepts.map(compactConcept), null, 2)}

AI MINUTES CONCEPTS
${JSON.stringify(options.aiConcepts.map(compactConcept), null, 2)}`,
  });
  usage = addUsage(usage, alignGeneration.usage);
  modelName = alignGeneration.modelName || modelName;
  truncated = truncated || alignGeneration.truncated;
  retryCount += alignGeneration.retryCount;

  const aligned = parseGoldStandardAlignmentsResponse(alignGeneration.text);
  warnings.push(...aligned.warnings);
  const alignments = completeAlignments(
    goldConcepts,
    options.aiConcepts,
    aligned.alignments,
  );

  const goldById = new Map(goldConcepts.map((row) => [row.id, row]));
  const aiById = new Map(options.aiConcepts.map((row) => [row.id, row]));
  const pairs: ComparePair[] = [];
  const matchedAlignments = alignments.filter(
    (row) => row.kind !== "gold_only" && row.kind !== "ai_only",
  );
  const unmatchedAlignments = alignments.filter(
    (row) => row.kind === "gold_only" || row.kind === "ai_only",
  );

  for (const alignment of unmatchedAlignments) {
    pairs.push(
      unmatchedPair(
        alignment,
        alignment.goldConceptIds.map((id) => goldById.get(id)!).filter(Boolean),
        alignment.aiConceptIds.map((id) => aiById.get(id)!).filter(Boolean),
      ),
    );
  }

  for (let index = 0; index < matchedAlignments.length; index += PAIR_BATCH_SIZE) {
    const batch = matchedAlignments.slice(index, index + PAIR_BATCH_SIZE);
    const payload = batch.map((alignment) => {
      const goldRows = alignment.goldConceptIds
        .map((id) => goldById.get(id))
        .filter((row): row is GoldStandardConcept => Boolean(row));
      const aiRows = alignment.aiConceptIds
        .map((id) => aiById.get(id))
        .filter((row): row is AiMinutesConcept => Boolean(row));
      return {
        alignment_id: alignment.id,
        label: alignment.label,
        kind: alignment.kind,
        gold_text: joinConceptText(goldRows),
        ai_text: joinConceptText(aiRows),
      };
    });

    const diffGeneration = await generateJson({
      systemInstruction: GOLD_STANDARD_PAIR_DIFF_SYSTEM_PROMPT,
      userText: `Meeting: ${options.meetingTitle}

PAIRS TO DIFF
${JSON.stringify(payload, null, 2)}`,
    });
    usage = addUsage(usage, diffGeneration.usage);
    modelName = diffGeneration.modelName || modelName;
    truncated = truncated || diffGeneration.truncated;
    retryCount += diffGeneration.retryCount;

    const parsedPairs = parseGoldStandardPairDiffResponse(diffGeneration.text);
    warnings.push(...parsedPairs.warnings);
    const pairByAlignmentId = new Map(
      parsedPairs.pairs.map((pair) => [pair.alignmentId, pair]),
    );
    for (const alignment of batch) {
      const goldRows = alignment.goldConceptIds
        .map((id) => goldById.get(id))
        .filter((row): row is GoldStandardConcept => Boolean(row));
      const aiRows = alignment.aiConceptIds
        .map((id) => aiById.get(id))
        .filter((row): row is AiMinutesConcept => Boolean(row));
      pairs.push(
        pairByAlignmentId.get(alignment.id) ??
          fallbackMatchedPair(alignment, goldRows, aiRows),
      );
    }
  }

  const pairOrder = new Map(alignments.map((row, index) => [row.id, index]));
  pairs.sort(
    (left, right) =>
      (pairOrder.get(left.alignmentId) ?? 0) - (pairOrder.get(right.alignmentId) ?? 0),
  );

  const compare: GoldStandardCompareDocument = {
    goldConcepts,
    aiConcepts: options.aiConcepts,
    alignments,
    pairs,
  };
  const findings = deriveBidirectionalFindings(compare);
  const scored = scoreCompareDocument(compare);
  const analyzedAt = new Date().toISOString();

  const validation: GoldStandardValidationResult = {
    schemaVersion: "compare_v2",
    analyzedAt,
    validationScore: scored.validationScore,
    scoreRationale: scored.scoreRationale,
    generatedOnly: findings.generatedOnly,
    goldOnly: findings.goldOnly,
    ...(findings.generatedOnly.length === 0 &&
    findings.goldOnly.length === 0 &&
    scored.validationScore >= 95
      ? { noSignificantDifferences: true }
      : {}),
    compare,
  };

  return {
    validation,
    usage,
    modelName,
    warnings,
    truncated,
    retryCount,
  };
}
