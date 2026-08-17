import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import {
  getOrgHighlightModelMeta,
  getOrgHighlightPassConfig,
  resolveOrgHighlightModel,
  type OrgHighlightModelId,
  type OrgHighlightPass,
} from "@/lib/email-analysis/org-highlight-models";
import {
  buildOrgFingerprintMergeSystemPrompt,
  buildOrgFingerprintMergeUserPrompt,
  buildOrgFingerprintSystemPrompt,
  buildOrgFingerprintUserPrompt,
  buildOrgHighlightSecondPassSystemPrompt,
  buildOrgHighlightSecondPassUserPrompt,
  buildOrgHighlightSystemPrompt,
  buildOrgHighlightUserPrompt,
  chunkOrgHighlightText,
  coalesceOrgEntityCards,
  diffOrgHighlightExtractions,
  emptyOrgHighlightExtraction,
  mergeOrgHighlightExtractions,
  parseOrgFingerprintJson,
  parseOrgHighlightJson,
  type OrgEntityCard,
  type OrgFingerprintEmailContext,
  type OrgHighlightExtraction,
  type SourcedOrgEntityCard,
} from "@/lib/email-analysis/org-highlight-shared";

export {
  emptyOrgFingerprintResult,
  emptyOrgHighlightExtraction,
  type OrgEntityCard,
  type OrgFingerprintEmailContext,
  type OrgHighlightExtraction,
  type SourcedOrgEntityCard,
} from "@/lib/email-analysis/org-highlight-shared";

type OrgHighlightCallResult = {
  extraction: OrgHighlightExtraction;
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
};

type OrgFingerprintCallResult = {
  entityCards: OrgEntityCard[];
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
};

async function runOrgHighlightLlm(params: {
  systemInstruction: string;
  userText: string;
  modelId: OrgHighlightModelId;
  pass: OrgHighlightPass;
  step: string;
}): Promise<{
  text: string;
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
}> {
  const meta = getOrgHighlightModelMeta(params.modelId);
  const passConfig = getOrgHighlightPassConfig(params.modelId, params.pass);
  const result =
    meta.provider === "deepseek"
      ? await generateDeepSeekJson({
          systemInstruction: params.systemInstruction,
          userText: params.userText,
          modelName: passConfig.apiModelName,
          maxOutputTokens: passConfig.maxOutputTokens,
          thinking: passConfig.thinking,
        })
      : await generateEmailExtraction({
          systemInstruction: params.systemInstruction,
          userText: params.userText,
          modelName: passConfig.apiModelName,
          maxOutputTokens: passConfig.maxOutputTokens,
          step: params.step,
        });

  return {
    text: result.text,
    modelName: result.modelName,
    usage: result.usage,
    costUsd: estimateCostUsd(result.modelName, result.usage),
  };
}

function emptyUsageResult(modelName: string): OrgHighlightCallResult {
  return {
    extraction: emptyOrgHighlightExtraction(),
    modelName,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    costUsd: 0,
  };
}

function resolveExcerptChunks(
  highlightedText: string,
  modelId: OrgHighlightModelId,
): string[] {
  const meta = getOrgHighlightModelMeta(modelId);
  const trimmed = highlightedText.trim();
  if (!trimmed) return [];
  if (!meta.chunking) return [trimmed];
  const chunks = chunkOrgHighlightText(trimmed, meta.chunking);
  return chunks.length > 0 ? chunks : [trimmed];
}

/**
 * One or more LLM calls for an excerpt (chunked models = N calls, usage summed).
 */
async function runOrgHighlightOverExcerpt(params: {
  highlightedText: string;
  modelId: OrgHighlightModelId;
  pass: OrgHighlightPass;
  buildUserText: (chunk: string) => string;
  systemInstruction: string;
  step: string;
}): Promise<OrgHighlightCallResult> {
  const chunks = resolveExcerptChunks(params.highlightedText, params.modelId);
  if (chunks.length === 0) {
    return emptyUsageResult(
      getOrgHighlightPassConfig(params.modelId, params.pass).apiModelName,
    );
  }

  const parts: OrgHighlightCallResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const step =
      chunks.length === 1
        ? params.step
        : `${params.step}_chunk_${i + 1}_of_${chunks.length}`;
    const llm = await runOrgHighlightLlm({
      systemInstruction: params.systemInstruction,
      userText: params.buildUserText(chunk),
      modelId: params.modelId,
      pass: params.pass,
      step,
    });
    parts.push({
      extraction: parseOrgHighlightJson(llm.text),
      modelName: llm.modelName,
      usage: llm.usage,
      costUsd: llm.costUsd,
    });
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let modelName = parts[0]?.modelName ?? params.modelId;
  for (const part of parts) {
    inputTokens += part.usage.inputTokens;
    outputTokens += part.usage.outputTokens;
    totalTokens += part.usage.totalTokens;
    costUsd += part.costUsd;
    if (part.modelName) modelName = part.modelName;
  }

  return {
    extraction: mergeOrgHighlightExtractions(parts.map((p) => p.extraction)),
    modelName,
    usage: { inputTokens, outputTokens, totalTokens },
    costUsd,
  };
}

export async function extractOrgHighlightsFromText(
  highlightedText: string,
  modelId?: string | null,
): Promise<OrgHighlightCallResult> {
  const resolvedModel = resolveOrgHighlightModel(modelId);
  return runOrgHighlightOverExcerpt({
    highlightedText,
    modelId: resolvedModel,
    pass: 1,
    systemInstruction: buildOrgHighlightSystemPrompt(),
    buildUserText: (chunk) => buildOrgHighlightUserPrompt(chunk),
    step: "org_highlight_extraction",
  });
}

/**
 * Second pass: same excerpt + prior extractions → return only values
 * missing from the first pass (server-side filtered for safety).
 */
export async function extractOrgHighlightsSecondPass(
  highlightedText: string,
  priorExtraction: OrgHighlightExtraction,
  modelId?: string | null,
): Promise<OrgHighlightCallResult> {
  const resolvedModel = resolveOrgHighlightModel(modelId);
  const result = await runOrgHighlightOverExcerpt({
    highlightedText,
    modelId: resolvedModel,
    pass: 2,
    systemInstruction: buildOrgHighlightSecondPassSystemPrompt(),
    buildUserText: (chunk) =>
      buildOrgHighlightSecondPassUserPrompt(chunk, priorExtraction),
    step: "org_highlight_extraction_second_pass",
  });

  return {
    ...result,
    extraction: diffOrgHighlightExtractions(priorExtraction, result.extraction),
  };
}

/**
 * Third pass: full single-message email (headers + body) + merged prior
 * extractions → organization fingerprint entity cards. Never chunked.
 */
export async function extractOrgFingerprints(
  email: OrgFingerprintEmailContext,
  priorExtraction: OrgHighlightExtraction,
  modelId?: string | null,
): Promise<OrgFingerprintCallResult> {
  const resolvedModel = resolveOrgHighlightModel(modelId);
  const hasBody = email.bodyText.trim().length > 0;
  const hasHeaders = Boolean(
    email.fromAddress.trim() ||
      email.toAddresses.length > 0 ||
      email.ccAddresses.length > 0,
  );

  if (!hasBody && !hasHeaders) {
    return {
      entityCards: [],
      modelName: getOrgHighlightPassConfig(resolvedModel, 3).apiModelName,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
    };
  }

  const llm = await runOrgHighlightLlm({
    systemInstruction: buildOrgFingerprintSystemPrompt(),
    userText: buildOrgFingerprintUserPrompt(email, priorExtraction),
    modelId: resolvedModel,
    pass: 3,
    step: "org_highlight_fingerprint",
  });

  const parsed = parseOrgFingerprintJson(llm.text);
  return {
    entityCards: parsed.entity_cards,
    modelName: llm.modelName,
    usage: llm.usage,
    costUsd: llm.costUsd,
  };
}

/**
 * Fourth pass: merge all pass-3 entity cards across emails into unique orgs.
 * Never chunked. Server also coalesces by email/name as a safety net.
 */
export async function mergeOrgFingerprints(
  cards: SourcedOrgEntityCard[],
  modelId?: string | null,
): Promise<OrgFingerprintCallResult> {
  const resolvedModel = resolveOrgHighlightModel(modelId);

  if (cards.length === 0) {
    return {
      entityCards: [],
      modelName: getOrgHighlightPassConfig(resolvedModel, 4).apiModelName,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
    };
  }

  if (cards.length === 1) {
    return {
      entityCards: coalesceOrgEntityCards([
        {
          name: cards[0]!.name,
          organization_role: cards[0]!.organization_role,
          email: cards[0]!.email,
          phone: cards[0]!.phone,
          website: cards[0]!.website,
        },
      ]),
      modelName: getOrgHighlightPassConfig(resolvedModel, 4).apiModelName,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
    };
  }

  const llm = await runOrgHighlightLlm({
    systemInstruction: buildOrgFingerprintMergeSystemPrompt(),
    userText: buildOrgFingerprintMergeUserPrompt(cards),
    modelId: resolvedModel,
    pass: 4,
    step: "org_highlight_fingerprint_merge",
  });

  const parsed = parseOrgFingerprintJson(llm.text);
  return {
    entityCards: coalesceOrgEntityCards(parsed.entity_cards),
    modelName: llm.modelName,
    usage: llm.usage,
    costUsd: llm.costUsd,
  };
}

export type { OrgHighlightModelId };
