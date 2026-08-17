import { enqueueRegistryIngestAfterPass4 } from "@/lib/contacts/registry-queue";
import type { PreparedContactExtractItem } from "@/lib/email-analysis/contact-highlight-prepare";
import {
  emptyContactHighlightExtraction,
  extractContactFingerprints,
  extractContactHighlightsFromText,
  extractContactHighlightsSecondPass,
  mergeContactFingerprints,
} from "@/lib/email-analysis/contact-highlight-extraction";
import {
  resolveContactHighlightModel,
  type ContactHighlightModelId,
} from "@/lib/email-analysis/contact-highlight-models";
import {
  loadContactHighlightRuns,
  mergedPriorExtractionsForEmail,
  saveContactFingerprintMerge,
  saveContactHighlightExtractions,
  saveContactHighlightSecondPass,
  saveContactHighlightThirdPass,
} from "@/lib/email-analysis/contact-highlight-persist";
import type { SourcedContactEntityCard } from "@/lib/email-analysis/contact-highlight-shared";
import type { BulkExtractKind } from "@/lib/email-analysis/bulk-extract-runs";
import {
  emptyEventHighlightExtraction,
  extractEventHighlightsFromText,
} from "@/lib/email-analysis/event-highlight-extraction";
import {
  resolveEventHighlightModel,
  type EventHighlightModelId,
} from "@/lib/email-analysis/event-highlight-models";
import { saveEventHighlightExtractions } from "@/lib/email-analysis/event-highlight-persist";
import {
  emptyTodoHighlightExtraction,
  extractTodoHighlightsFromText,
} from "@/lib/email-analysis/todo-highlight-extraction";
import {
  resolveTodoHighlightModel,
  type TodoHighlightModelId,
} from "@/lib/email-analysis/todo-highlight-models";
import { saveTodoHighlightExtractions } from "@/lib/email-analysis/todo-highlight-persist";
import {
  emptyOrgHighlightExtraction,
  extractOrgFingerprints,
  extractOrgHighlightsFromText,
  extractOrgHighlightsSecondPass,
  mergeOrgFingerprints,
} from "@/lib/email-analysis/org-highlight-extraction";
import {
  resolveOrgHighlightModel,
  type OrgHighlightModelId,
} from "@/lib/email-analysis/org-highlight-models";
import {
  loadOrgHighlightRuns,
  mergedPriorExtractionsForEmail as mergedOrgPriorExtractionsForEmail,
  saveOrgFingerprintMerge,
  saveOrgHighlightExtractions,
  saveOrgHighlightSecondPass,
  saveOrgHighlightThirdPass,
} from "@/lib/email-analysis/org-highlight-persist";
import type { SourcedOrgEntityCard } from "@/lib/email-analysis/org-highlight-shared";
import { estimateCostUsd } from "@/lib/gemini/usage";

export type BulkHighlightPass = 1 | 2 | 3 | 4;

const CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function sumCostUsd(
  results: Array<{ costUsd?: number; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }>,
  modelId: string,
): number {
  let costUsd = 0;
  for (const result of results) {
    if (!result.usage) continue;
    costUsd += result.costUsd ?? estimateCostUsd(modelId, result.usage);
  }
  return costUsd;
}

function sourceLabelForItem(item: PreparedContactExtractItem): string {
  const labelParts = [item.fromAddress || null, item.subject || null].filter(
    Boolean,
  );
  return labelParts.length > 0
    ? labelParts.join(" · ")
    : item.emailId.slice(0, 8);
}

export type BulkHighlightPassResult = {
  costUsd: number;
  /** Set when pass-4 registry ingest was scheduled but not awaited. */
  registryIngestPromise: Promise<unknown> | null;
};

async function runContactPass(
  items: PreparedContactExtractItem[],
  modelId: ContactHighlightModelId,
  pass: BulkHighlightPass,
  options?: { deferRegistryIngest?: boolean },
): Promise<BulkHighlightPassResult> {
  if (pass === 4) {
    const priorRuns = await loadContactHighlightRuns(
      items.map((item) => item.emailId),
    );
    const priorRun = priorRuns[modelId];
    if (!priorRun?.thirdPass) {
      throw new Error(
        "Run the fingerprint (3rd) pass for this model before merging.",
      );
    }

    const sourced: SourcedContactEntityCard[] = [];
    for (const item of items) {
      const cards =
        priorRun.thirdPass.entityCardsByEmailId[item.emailId] ?? [];
      const sourceLabel = sourceLabelForItem(item);
      for (const card of cards) {
        sourced.push({
          ...card,
          source_email_id: item.emailId,
          source_label: sourceLabel,
        });
      }
    }

    const { entityCards, usage, costUsd, modelName } =
      await mergeContactFingerprints(sourced, modelId);
    const fourthPass = await saveContactFingerprintMerge({
      modelId,
      emailIds: items.map((item) => item.emailId),
      entityCards,
      inputCardCount: sourced.length,
      usage,
      costUsd,
      modelName,
    });

    const registryIngestPromise = enqueueRegistryIngestAfterPass4({
      mergeId: fourthPass.mergeId,
      modelId,
      entityCards,
      emailIds: items.map((item) => item.emailId),
    });

    // Tier B+: defer so thread workers keep doing LLM while ingest is serial.
    if (options?.deferRegistryIngest) {
      return { costUsd, registryIngestPromise };
    }
    await registryIngestPromise;
    return { costUsd, registryIngestPromise: null };
  }

  if (pass === 3) {
    const priorRuns = await loadContactHighlightRuns(
      items.map((item) => item.emailId),
    );
    const priorRun = priorRuns[modelId];
    if (!priorRun) {
      throw new Error(
        "Run the first pass for this model before the fingerprint pass.",
      );
    }

    const results = await mapWithConcurrency(items, CONCURRENCY, async (item) => {
      const priorExtraction = mergedPriorExtractionsForEmail(
        priorRun,
        item.emailId,
      );
      const hasContent =
        item.bodyText.length > 0 ||
        item.fromAddress.length > 0 ||
        item.toAddresses.length > 0 ||
        item.ccAddresses.length > 0;

      if (!hasContent) {
        return { emailId: item.emailId, entityCards: [], skipped: true };
      }

      const { entityCards, usage, costUsd, modelName } =
        await extractContactFingerprints(
          {
            subject: item.subject,
            fromAddress: item.fromAddress,
            toAddresses: item.toAddresses,
            ccAddresses: item.ccAddresses,
            bodyText: item.bodyText,
          },
          priorExtraction,
          modelId,
        );
      return { emailId: item.emailId, entityCards, usage, costUsd, modelName };
    });

    await saveContactHighlightThirdPass(modelId, results);
    return {
      costUsd: sumCostUsd(results, modelId),
      registryIngestPromise: null,
    };
  }

  if (pass === 2) {
    const priorRuns = await loadContactHighlightRuns(
      items.map((item) => item.emailId),
    );
    const priorRun = priorRuns[modelId];
    if (!priorRun) {
      throw new Error(
        "Run the first pass for this model before the second pass.",
      );
    }

    const results = await mapWithConcurrency(items, CONCURRENCY, async (item) => {
      const priorExtraction =
        priorRun.extractions[item.emailId] ??
        emptyContactHighlightExtraction();

      if (!item.highlightedText) {
        return {
          emailId: item.emailId,
          extraction: emptyContactHighlightExtraction(),
          skipped: true,
        };
      }

      const { extraction, usage, costUsd, modelName } =
        await extractContactHighlightsSecondPass(
          item.highlightedText,
          priorExtraction,
          modelId,
        );
      return {
        emailId: item.emailId,
        extraction,
        usage,
        costUsd,
        modelName,
      };
    });

    await saveContactHighlightSecondPass(modelId, results);
    return {
      costUsd: sumCostUsd(results, modelId),
      registryIngestPromise: null,
    };
  }

  const results = await mapWithConcurrency(items, CONCURRENCY, async (item) => {
    if (!item.highlightedText) {
      return {
        emailId: item.emailId,
        extraction: emptyContactHighlightExtraction(),
        skipped: true,
      };
    }

    const { extraction, usage, costUsd, modelName } =
      await extractContactHighlightsFromText(item.highlightedText, modelId);
    return {
      emailId: item.emailId,
      extraction,
      usage,
      costUsd,
      modelName,
    };
  });

  await saveContactHighlightExtractions(modelId, results);
  return {
    costUsd: sumCostUsd(results, modelId),
    registryIngestPromise: null,
  };
}

async function runOrgPass(
  items: PreparedContactExtractItem[],
  modelId: OrgHighlightModelId,
  pass: BulkHighlightPass,
): Promise<number> {
  if (pass === 4) {
    const priorRuns = await loadOrgHighlightRuns(
      items.map((item) => item.emailId),
    );
    const priorRun = priorRuns[modelId];
    if (!priorRun?.thirdPass) {
      throw new Error(
        "Run the fingerprint (3rd) pass for this model before merging.",
      );
    }

    const sourced: SourcedOrgEntityCard[] = [];
    for (const item of items) {
      const cards =
        priorRun.thirdPass.entityCardsByEmailId[item.emailId] ?? [];
      const sourceLabel = sourceLabelForItem(item);
      for (const card of cards) {
        sourced.push({
          ...card,
          source_email_id: item.emailId,
          source_label: sourceLabel,
        });
      }
    }

    const { entityCards, usage, costUsd, modelName } =
      await mergeOrgFingerprints(sourced, modelId);
    await saveOrgFingerprintMerge({
      modelId,
      emailIds: items.map((item) => item.emailId),
      entityCards,
      inputCardCount: sourced.length,
      usage,
      costUsd,
      modelName,
    });

    return costUsd;
  }

  if (pass === 3) {
    const priorRuns = await loadOrgHighlightRuns(
      items.map((item) => item.emailId),
    );
    const priorRun = priorRuns[modelId];
    if (!priorRun) {
      throw new Error(
        "Run the first pass for this model before the fingerprint pass.",
      );
    }

    const results = await mapWithConcurrency(items, CONCURRENCY, async (item) => {
      const priorExtraction = mergedOrgPriorExtractionsForEmail(
        priorRun,
        item.emailId,
      );
      const hasContent =
        item.bodyText.length > 0 ||
        item.fromAddress.length > 0 ||
        item.toAddresses.length > 0 ||
        item.ccAddresses.length > 0;

      if (!hasContent) {
        return { emailId: item.emailId, entityCards: [], skipped: true };
      }

      const { entityCards, usage, costUsd, modelName } =
        await extractOrgFingerprints(
          {
            subject: item.subject,
            fromAddress: item.fromAddress,
            toAddresses: item.toAddresses,
            ccAddresses: item.ccAddresses,
            bodyText: item.bodyText,
          },
          priorExtraction,
          modelId,
        );
      return { emailId: item.emailId, entityCards, usage, costUsd, modelName };
    });

    await saveOrgHighlightThirdPass(modelId, results);
    return sumCostUsd(results, modelId);
  }

  if (pass === 2) {
    const priorRuns = await loadOrgHighlightRuns(
      items.map((item) => item.emailId),
    );
    const priorRun = priorRuns[modelId];
    if (!priorRun) {
      throw new Error(
        "Run the first pass for this model before the second pass.",
      );
    }

    const results = await mapWithConcurrency(items, CONCURRENCY, async (item) => {
      const priorExtraction =
        priorRun.extractions[item.emailId] ?? emptyOrgHighlightExtraction();

      if (!item.highlightedText) {
        return {
          emailId: item.emailId,
          extraction: emptyOrgHighlightExtraction(),
          skipped: true,
        };
      }

      const { extraction, usage, costUsd, modelName } =
        await extractOrgHighlightsSecondPass(
          item.highlightedText,
          priorExtraction,
          modelId,
        );
      return {
        emailId: item.emailId,
        extraction,
        usage,
        costUsd,
        modelName,
      };
    });

    await saveOrgHighlightSecondPass(modelId, results);
    return sumCostUsd(results, modelId);
  }

  const results = await mapWithConcurrency(items, CONCURRENCY, async (item) => {
    if (!item.highlightedText) {
      return {
        emailId: item.emailId,
        extraction: emptyOrgHighlightExtraction(),
        skipped: true,
      };
    }

    const { extraction, usage, costUsd, modelName } =
      await extractOrgHighlightsFromText(item.highlightedText, modelId);
    return {
      emailId: item.emailId,
      extraction,
      usage,
      costUsd,
      modelName,
    };
  });

  await saveOrgHighlightExtractions(modelId, results);
  return sumCostUsd(results, modelId);
}

async function runEventPass(
  items: PreparedContactExtractItem[],
  modelId: EventHighlightModelId,
): Promise<number> {
  const results = await mapWithConcurrency(items, CONCURRENCY, async (item) => {
    if (!item.highlightedText) {
      return {
        emailId: item.emailId,
        extraction: emptyEventHighlightExtraction(),
        skipped: true,
      };
    }

    const { extraction, usage, costUsd, modelName } =
      await extractEventHighlightsFromText(
        {
          subject: item.subject,
          fromAddress: item.fromAddress,
          toAddresses: item.toAddresses,
          ccAddresses: item.ccAddresses,
          highlightedText: item.highlightedText,
        },
        modelId,
      );
    return {
      emailId: item.emailId,
      extraction,
      usage,
      costUsd,
      modelName,
    };
  });

  await saveEventHighlightExtractions(modelId, results);
  return sumCostUsd(results, modelId);
}

async function runTodoPass(
  items: PreparedContactExtractItem[],
  modelId: TodoHighlightModelId,
): Promise<number> {
  const results = await mapWithConcurrency(items, CONCURRENCY, async (item) => {
    if (!item.highlightedText) {
      return {
        emailId: item.emailId,
        extraction: emptyTodoHighlightExtraction(),
        skipped: true,
      };
    }

    const { extraction, usage, costUsd, modelName } =
      await extractTodoHighlightsFromText(
        {
          subject: item.subject,
          fromAddress: item.fromAddress,
          toAddresses: item.toAddresses,
          ccAddresses: item.ccAddresses,
          highlightedText: item.highlightedText,
        },
        modelId,
      );
    return {
      emailId: item.emailId,
      extraction,
      usage,
      costUsd,
      modelName,
    };
  });

  await saveTodoHighlightExtractions(modelId, results);
  return sumCostUsd(results, modelId);
}

/** Run one highlight pass for bulk extract (server-side; mirrors API routes). */
export async function runBulkHighlightPass(params: {
  kind: BulkExtractKind;
  items: PreparedContactExtractItem[];
  modelId: string;
  pass: BulkHighlightPass;
  /** When true, contact pass-4 schedules registry ingest but does not await it. */
  deferRegistryIngest?: boolean;
}): Promise<BulkHighlightPassResult> {
  const { kind, items, pass } = params;
  if (items.length === 0) {
    throw new Error("No items to extract.");
  }

  if (kind === "contacts") {
    const modelId = resolveContactHighlightModel(params.modelId);
    return runContactPass(items, modelId, pass, {
      deferRegistryIngest: params.deferRegistryIngest,
    });
  }

  if (kind === "events") {
    const modelId = resolveEventHighlightModel(params.modelId);
    const costUsd = await runEventPass(items, modelId);
    return { costUsd, registryIngestPromise: null };
  }

  if (kind === "todos") {
    const modelId = resolveTodoHighlightModel(params.modelId);
    const costUsd = await runTodoPass(items, modelId);
    return { costUsd, registryIngestPromise: null };
  }

  const modelId = resolveOrgHighlightModel(params.modelId);
  const costUsd = await runOrgPass(items, modelId, pass);
  return { costUsd, registryIngestPromise: null };
}
