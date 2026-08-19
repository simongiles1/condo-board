import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import {
  getContactHighlightModelMeta,
  getContactHighlightPassConfig,
  resolveContactHighlightModel,
  type ContactHighlightModelId,
  type ContactHighlightPass,
} from "@/lib/email-analysis/contact-highlight-models";
import {
  buildContactFingerprintMergeSystemPrompt,
  buildContactFingerprintMergeUserPrompt,
  buildContactFingerprintSystemPrompt,
  buildContactFingerprintUserPrompt,
  buildContactHighlightSecondPassSystemPrompt,
  buildContactHighlightSecondPassUserPrompt,
  buildContactHighlightSystemPrompt,
  buildContactHighlightUserPrompt,
  chunkContactHighlightText,
  coalesceEntityCardsByEmail,
  diffContactHighlightExtractions,
  emptyContactHighlightExtraction,
  mergeContactHighlightExtractions,
  parseContactFingerprintJson,
  parseContactHighlightJson,
  type ContactEntityCard,
  type ContactFingerprintEmailContext,
  type ContactHighlightExtraction,
  type SourcedContactEntityCard,
} from "@/lib/email-analysis/contact-highlight-shared";

export {
  emptyContactFingerprintResult,
  emptyContactHighlightExtraction,
  type ContactEntityCard,
  type ContactFingerprintEmailContext,
  type ContactHighlightExtraction,
  type SourcedContactEntityCard,
} from "@/lib/email-analysis/contact-highlight-shared";

type ContactHighlightCallResult = {
  extraction: ContactHighlightExtraction;
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
};

type ContactFingerprintCallResult = {
  entityCards: ContactEntityCard[];
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
};

async function runContactHighlightLlm(params: {
  systemInstruction: string;
  userText: string;
  modelId: ContactHighlightModelId;
  pass: ContactHighlightPass;
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
  const meta = getContactHighlightModelMeta(params.modelId);
  const passConfig = getContactHighlightPassConfig(
    params.modelId,
    params.pass,
  );
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

function emptyUsageResult(modelName: string): ContactHighlightCallResult {
  return {
    extraction: emptyContactHighlightExtraction(),
    modelName,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    costUsd: 0,
  };
}

function resolveExcerptChunks(
  highlightedText: string,
  modelId: ContactHighlightModelId,
): string[] {
  const meta = getContactHighlightModelMeta(modelId);
  const trimmed = highlightedText.trim();
  if (!trimmed) return [];
  if (!meta.chunking) return [trimmed];
  const chunks = chunkContactHighlightText(trimmed, meta.chunking);
  return chunks.length > 0 ? chunks : [trimmed];
}

/**
 * One or more LLM calls for an excerpt (chunked models = N calls, usage summed).
 */
async function runContactHighlightOverExcerpt(params: {
  highlightedText: string;
  modelId: ContactHighlightModelId;
  pass: ContactHighlightPass;
  buildUserText: (chunk: string) => string;
  systemInstruction: string;
  step: string;
}): Promise<ContactHighlightCallResult> {
  const chunks = resolveExcerptChunks(params.highlightedText, params.modelId);
  if (chunks.length === 0) {
    return emptyUsageResult(
      getContactHighlightPassConfig(params.modelId, params.pass).apiModelName,
    );
  }

  const parts: ContactHighlightCallResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const step =
      chunks.length === 1
        ? params.step
        : `${params.step}_chunk_${i + 1}_of_${chunks.length}`;
    const llm = await runContactHighlightLlm({
      systemInstruction: params.systemInstruction,
      userText: params.buildUserText(chunk),
      modelId: params.modelId,
      pass: params.pass,
      step,
    });
    parts.push({
      extraction: parseContactHighlightJson(llm.text),
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
    extraction: mergeContactHighlightExtractions(parts.map((p) => p.extraction)),
    modelName,
    usage: { inputTokens, outputTokens, totalTokens },
    costUsd,
  };
}

export async function extractContactHighlightsFromText(
  highlightedText: string,
  modelId?: string | null,
): Promise<ContactHighlightCallResult> {
  const resolvedModel = resolveContactHighlightModel(modelId);
  return runContactHighlightOverExcerpt({
    highlightedText,
    modelId: resolvedModel,
    pass: 1,
    systemInstruction: buildContactHighlightSystemPrompt(),
    buildUserText: (chunk) => buildContactHighlightUserPrompt(chunk),
    step: "contact_highlight_extraction",
  });
}

/**
 * Second pass: same excerpt + prior extractions → return only values
 * missing from the first pass (server-side filtered for safety).
 * Pass config may differ (e.g. no-thinking → Extended Thinking).
 * Chunked models use the same paragraph/sentence chunking as pass 1.
 */
export async function extractContactHighlightsSecondPass(
  highlightedText: string,
  priorExtraction: ContactHighlightExtraction,
  modelId?: string | null,
): Promise<ContactHighlightCallResult> {
  const resolvedModel = resolveContactHighlightModel(modelId);
  const result = await runContactHighlightOverExcerpt({
    highlightedText,
    modelId: resolvedModel,
    pass: 2,
    systemInstruction: buildContactHighlightSecondPassSystemPrompt(),
    buildUserText: (chunk) =>
      buildContactHighlightSecondPassUserPrompt(chunk, priorExtraction),
    step: "contact_highlight_extraction_second_pass",
  });

  return {
    ...result,
    extraction: diffContactHighlightExtractions(
      priorExtraction,
      result.extraction,
    ),
  };
}

/**
 * Third pass: full single-message email (headers + body) + merged prior
 * extractions → contact fingerprint entity cards. Never chunked.
 */
export async function extractContactFingerprints(
  email: ContactFingerprintEmailContext,
  priorExtraction: ContactHighlightExtraction,
  modelId?: string | null,
): Promise<ContactFingerprintCallResult> {
  const resolvedModel = resolveContactHighlightModel(modelId);
  const hasBody = email.bodyText.trim().length > 0;
  const hasHeaders = Boolean(
    email.fromAddress.trim() ||
      email.toAddresses.length > 0 ||
      email.ccAddresses.length > 0,
  );

  if (!hasBody && !hasHeaders) {
    return {
      entityCards: [],
      modelName: getContactHighlightPassConfig(resolvedModel, 3).apiModelName,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
    };
  }

  const llm = await runContactHighlightLlm({
    systemInstruction: buildContactFingerprintSystemPrompt(),
    userText: buildContactFingerprintUserPrompt(email, priorExtraction),
    modelId: resolvedModel,
    pass: 3,
    step: "contact_highlight_fingerprint",
  });

  const parsed = parseContactFingerprintJson(llm.text);
  return {
    entityCards: parsed.entity_cards,
    modelName: llm.modelName,
    usage: llm.usage,
    costUsd: llm.costUsd,
  };
}

/**
 * Fourth pass: merge all pass-3 entity cards across emails into unique people.
 * Never chunked. Server also coalesces by email as a safety net.
 */
export async function mergeContactFingerprints(
  cards: SourcedContactEntityCard[],
  modelId?: string | null,
): Promise<ContactFingerprintCallResult> {
  const resolvedModel = resolveContactHighlightModel(modelId);

  if (cards.length === 0) {
    return {
      entityCards: [],
      modelName: getContactHighlightPassConfig(resolvedModel, 4).apiModelName,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
    };
  }

  // Single-card sets need no LLM merge.
  if (cards.length === 1) {
    return {
      entityCards: coalesceEntityCardsByEmail([
        {
          first_name: cards[0]!.first_name,
          last_name: cards[0]!.last_name,
          email: cards[0]!.email,
          phone: cards[0]!.phone,
          job_title: cards[0]!.job_title,
          raw_company: cards[0]!.raw_company ?? null,
        },
      ]),
      modelName: getContactHighlightPassConfig(resolvedModel, 4).apiModelName,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
    };
  }

  const llm = await runContactHighlightLlm({
    systemInstruction: buildContactFingerprintMergeSystemPrompt(),
    userText: buildContactFingerprintMergeUserPrompt(cards),
    modelId: resolvedModel,
    pass: 4,
    step: "contact_highlight_fingerprint_merge",
  });

  const parsed = parseContactFingerprintJson(llm.text);
  return {
    entityCards: coalesceEntityCardsByEmail(parsed.entity_cards),
    modelName: llm.modelName,
    usage: llm.usage,
    costUsd: llm.costUsd,
  };
}

export type { ContactHighlightModelId };
