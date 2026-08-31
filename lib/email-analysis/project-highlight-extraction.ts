import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import { loadOrganizationIdentityNameKeys } from "@/lib/projects/org-identity-keys";
import {
  getProjectHighlightModelMeta,
  getProjectHighlightPassConfig,
  resolveProjectHighlightModel,
  type ProjectHighlightModelId,
  type ProjectHighlightPass,
} from "@/lib/email-analysis/project-highlight-models";
import {
  buildProjectFingerprintMergeSystemPrompt,
  buildProjectFingerprintMergeUserPrompt,
  buildProjectFingerprintSystemPrompt,
  buildProjectFingerprintUserPrompt,
  buildProjectHighlightSecondPassSystemPrompt,
  buildProjectHighlightSecondPassUserPrompt,
  buildProjectHighlightSystemPrompt,
  buildProjectHighlightUserPrompt,
  chunkProjectHighlightText,
  coalesceProjectEntityCards,
  diffProjectHighlightExtractions,
  emptyProjectHighlightExtraction,
  filterMintedProjectCards,
  mergeProjectHighlightExtractions,
  parseProjectFingerprintJson,
  parseProjectHighlightJson,
  type ProjectEntityCard,
  type ProjectFingerprintEmailContext,
  type ProjectHighlightExtraction,
  type SourcedProjectEntityCard,
} from "@/lib/email-analysis/project-highlight-shared";

export {
  emptyProjectFingerprintResult,
  emptyProjectHighlightExtraction,
  type ProjectEntityCard,
  type ProjectFingerprintEmailContext,
  type ProjectHighlightExtraction,
  type SourcedProjectEntityCard,
} from "@/lib/email-analysis/project-highlight-shared";

type ProjectHighlightCallResult = {
  extraction: ProjectHighlightExtraction;
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
};

type ProjectFingerprintCallResult = {
  entityCards: ProjectEntityCard[];
  /** Named pass-3 cards before the minting gate. Absent on merge-pass results. */
  mentionCards?: ProjectEntityCard[];
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
};

async function runProjectHighlightLlm(params: {
  systemInstruction: string;
  userText: string;
  modelId: ProjectHighlightModelId;
  pass: ProjectHighlightPass;
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
  const meta = getProjectHighlightModelMeta(params.modelId);
  const passConfig = getProjectHighlightPassConfig(params.modelId, params.pass);
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

function emptyUsageResult(modelName: string): ProjectHighlightCallResult {
  return {
    extraction: emptyProjectHighlightExtraction(),
    modelName,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    costUsd: 0,
  };
}

function resolveExcerptChunks(
  highlightedText: string,
  modelId: ProjectHighlightModelId,
): string[] {
  const meta = getProjectHighlightModelMeta(modelId);
  const trimmed = highlightedText.trim();
  if (!trimmed) return [];
  if (!meta.chunking) return [trimmed];
  const chunks = chunkProjectHighlightText(trimmed, meta.chunking);
  return chunks.length > 0 ? chunks : [trimmed];
}

/**
 * One or more LLM calls for an excerpt (chunked models = N calls, usage summed).
 */
async function runProjectHighlightOverExcerpt(params: {
  highlightedText: string;
  modelId: ProjectHighlightModelId;
  pass: ProjectHighlightPass;
  buildUserText: (chunk: string) => string;
  systemInstruction: string;
  step: string;
}): Promise<ProjectHighlightCallResult> {
  const chunks = resolveExcerptChunks(params.highlightedText, params.modelId);
  if (chunks.length === 0) {
    return emptyUsageResult(
      getProjectHighlightPassConfig(params.modelId, params.pass).apiModelName,
    );
  }

  const parts: ProjectHighlightCallResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const step =
      chunks.length === 1
        ? params.step
        : `${params.step}_chunk_${i + 1}_of_${chunks.length}`;
    const llm = await runProjectHighlightLlm({
      systemInstruction: params.systemInstruction,
      userText: params.buildUserText(chunk),
      modelId: params.modelId,
      pass: params.pass,
      step,
    });
    parts.push({
      extraction: parseProjectHighlightJson(llm.text),
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
    extraction: mergeProjectHighlightExtractions(parts.map((p) => p.extraction)),
    modelName,
    usage: { inputTokens, outputTokens, totalTokens },
    costUsd,
  };
}

export async function extractProjectHighlightsFromText(
  highlightedText: string,
  modelId?: string | null,
): Promise<ProjectHighlightCallResult> {
  const resolvedModel = resolveProjectHighlightModel(modelId);
  return runProjectHighlightOverExcerpt({
    highlightedText,
    modelId: resolvedModel,
    pass: 1,
    systemInstruction: buildProjectHighlightSystemPrompt(),
    buildUserText: (chunk) => buildProjectHighlightUserPrompt(chunk),
    step: "project_highlight_extraction",
  });
}

/**
 * Second pass: same excerpt + prior extractions → return only values
 * missing from the first pass (server-side filtered for safety).
 */
export async function extractProjectHighlightsSecondPass(
  highlightedText: string,
  priorExtraction: ProjectHighlightExtraction,
  modelId?: string | null,
): Promise<ProjectHighlightCallResult> {
  const resolvedModel = resolveProjectHighlightModel(modelId);
  const result = await runProjectHighlightOverExcerpt({
    highlightedText,
    modelId: resolvedModel,
    pass: 2,
    systemInstruction: buildProjectHighlightSecondPassSystemPrompt(),
    buildUserText: (chunk) =>
      buildProjectHighlightSecondPassUserPrompt(chunk, priorExtraction),
    step: "project_highlight_extraction_second_pass",
  });

  return {
    ...result,
    extraction: diffProjectHighlightExtractions(
      priorExtraction,
      result.extraction,
    ),
  };
}

/**
 * Third pass: full single-message email (headers + body) + merged prior
 * extractions → project fingerprint entity cards. Never chunked.
 */
export async function extractProjectFingerprints(
  email: ProjectFingerprintEmailContext,
  priorExtraction: ProjectHighlightExtraction,
  modelId?: string | null,
): Promise<ProjectFingerprintCallResult> {
  const resolvedModel = resolveProjectHighlightModel(modelId);
  const hasBody = email.bodyText.trim().length > 0;
  const hasHeaders = Boolean(
    email.fromAddress.trim() ||
      email.toAddresses.length > 0 ||
      email.ccAddresses.length > 0,
  );

  if (!hasBody && !hasHeaders) {
    return {
      entityCards: [],
      mentionCards: [],
      modelName: getProjectHighlightPassConfig(resolvedModel, 3).apiModelName,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
    };
  }

  const llm = await runProjectHighlightLlm({
    systemInstruction: buildProjectFingerprintSystemPrompt(),
    userText: buildProjectFingerprintUserPrompt(email, priorExtraction),
    modelId: resolvedModel,
    pass: 3,
    step: "project_highlight_fingerprint",
  });

  const parsed = parseProjectFingerprintJson(llm.text);
  const orgNameKeys = await loadOrganizationIdentityNameKeys().catch(
    () => new Set<string>(),
  );
  const mentionCards = parsed.entity_cards.filter((card) =>
    Boolean(card.name?.trim()),
  );
  return {
    entityCards: filterMintedProjectCards(mentionCards, orgNameKeys),
    mentionCards,
    modelName: llm.modelName,
    usage: llm.usage,
    costUsd: llm.costUsd,
  };
}

/**
 * Fourth pass: merge all pass-3 entity cards across emails into unique projects.
 * Never chunked. Server also coalesces by name+year as a safety net.
 */
export async function mergeProjectFingerprints(
  cards: SourcedProjectEntityCard[],
  modelId?: string | null,
): Promise<ProjectFingerprintCallResult> {
  const resolvedModel = resolveProjectHighlightModel(modelId);

  if (cards.length === 0) {
    return {
      entityCards: [],
      modelName: getProjectHighlightPassConfig(resolvedModel, 4).apiModelName,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
    };
  }

  if (cards.length === 1) {
    const orgNameKeys = await loadOrganizationIdentityNameKeys().catch(
      () => new Set<string>(),
    );
    return {
      entityCards: coalesceProjectEntityCards(
        [
          {
            name: cards[0]!.name,
            year_hint: cards[0]!.year_hint,
            phase: cards[0]!.phase,
            contractor: cards[0]!.contractor,
            location: cards[0]!.location,
            equipment_mentions: cards[0]!.equipment_mentions,
            scope: cards[0]!.scope,
            aliases: cards[0]!.aliases,
          },
        ],
        orgNameKeys,
      ),
      modelName: getProjectHighlightPassConfig(resolvedModel, 4).apiModelName,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
    };
  }

  const llm = await runProjectHighlightLlm({
    systemInstruction: buildProjectFingerprintMergeSystemPrompt(),
    userText: buildProjectFingerprintMergeUserPrompt(cards),
    modelId: resolvedModel,
    pass: 4,
    step: "project_highlight_fingerprint_merge",
  });

  const parsed = parseProjectFingerprintJson(llm.text);
  const orgNameKeys = await loadOrganizationIdentityNameKeys().catch(
    () => new Set<string>(),
  );
  return {
    entityCards: coalesceProjectEntityCards(parsed.entity_cards, orgNameKeys),
    modelName: llm.modelName,
    usage: llm.usage,
    costUsd: llm.costUsd,
  };
}

export type { ProjectHighlightModelId };
