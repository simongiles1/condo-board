export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  isErrorResponse,
  requireSession,
} from "@/lib/auth/authorize";
import {
  emptyOrgHighlightExtraction,
  extractOrgFingerprints,
  extractOrgHighlightsFromText,
  extractOrgHighlightsSecondPass,
  mergeOrgFingerprints,
  type OrgEntityCard,
  type OrgHighlightExtraction,
} from "@/lib/email-analysis/org-highlight-extraction";
import {
  isOrgHighlightModel,
  resolveOrgHighlightModel,
  type OrgHighlightModelId,
} from "@/lib/email-analysis/org-highlight-models";
import {
  deleteOrgHighlightExtractions,
  loadOrgHighlightRuns,
  mergedPriorExtractionsForEmail,
  saveOrgFingerprintMerge,
  saveOrgHighlightExtractions,
  saveOrgHighlightSecondPass,
  saveOrgHighlightThirdPass,
} from "@/lib/email-analysis/org-highlight-persist";
import type { SourcedOrgEntityCard } from "@/lib/email-analysis/org-highlight-shared";
import { estimateCostUsd } from "@/lib/gemini/usage";

type RequestItem = {
  emailId?: string;
  highlightedText?: string;
  subject?: string;
  fromAddress?: string;
  toAddresses?: string[];
  ccAddresses?: string[];
  /** Full authored body for this message (pass 3). */
  bodyText?: string;
};

type ResultItem = {
  emailId: string;
  extraction: OrgHighlightExtraction;
  skipped?: boolean;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  modelName?: string;
};

type FingerprintResultItem = {
  emailId: string;
  entityCards: OrgEntityCard[];
  skipped?: boolean;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  modelName?: string;
};

const MAX_ITEMS = 40;
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

function parseEmailIdsParam(value: string | null): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function aggregateUsage(
  results: Array<{
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    costUsd?: number;
    modelName?: string;
  }>,
  modelId: OrgHighlightModelId,
) {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let modelName: string = modelId;

  for (const result of results) {
    if (!result.usage) continue;
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;
    totalTokens += result.usage.totalTokens;
    costUsd += result.costUsd ?? estimateCostUsd(modelId, result.usage);
    if (result.modelName) modelName = result.modelName;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    modelName,
  };
}

function normalizeItems(items: RequestItem[]) {
  return items.map((item, index) => {
    const emailId =
      typeof item.emailId === "string" ? item.emailId.trim() : "";
    const highlightedText =
      typeof item.highlightedText === "string"
        ? item.highlightedText.trim()
        : "";
    const subject = typeof item.subject === "string" ? item.subject : "";
    const fromAddress =
      typeof item.fromAddress === "string" ? item.fromAddress.trim() : "";
    const toAddresses = asStringArray(item.toAddresses);
    const ccAddresses = asStringArray(item.ccAddresses);
    const bodyText =
      typeof item.bodyText === "string" ? item.bodyText.trim() : "";
    if (!emailId) {
      throw new Error(`items[${index}].emailId is required.`);
    }
    return {
      emailId,
      highlightedText,
      subject,
      fromAddress,
      toAddresses,
      ccAddresses,
      bodyText,
    };
  });
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { searchParams } = new URL(request.url);
  const emailIds = parseEmailIdsParam(searchParams.get("emailIds"));

  if (emailIds.length === 0) {
    return NextResponse.json(
      { error: "emailIds is required (comma-separated)." },
      { status: 400 },
    );
  }

  try {
    const runs = await loadOrgHighlightRuns(emailIds);
    return NextResponse.json({ runs });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load organization extractions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = (await request.json()) as {
      emailIds?: string[];
      model?: string;
    };
    const emailIds = Array.isArray(body.emailIds)
      ? body.emailIds.map((id) => String(id).trim()).filter(Boolean)
      : [];

    if (emailIds.length === 0) {
      return NextResponse.json(
        { error: "emailIds is required (non-empty array)." },
        { status: 400 },
      );
    }
    if (!body.model || !isOrgHighlightModel(body.model)) {
      return NextResponse.json(
        { error: "Unsupported organization extraction model." },
        { status: 400 },
      );
    }

    await deleteOrgHighlightExtractions(
      emailIds,
      body.model as OrgHighlightModelId,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not delete organization extractions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = (await request.json()) as {
      items?: RequestItem[];
      model?: string;
      /** 1 = first, 2 = misses, 3 = fingerprints, 4 = merge. */
      pass?: number;
    };
    const items = Array.isArray(body.items) ? body.items : [];
    const pass =
      body.pass === 4
        ? 4
        : body.pass === 3
          ? 3
          : body.pass === 2
            ? 2
            : 1;

    if (body.model != null && !isOrgHighlightModel(body.model)) {
      return NextResponse.json(
        { error: "Unsupported organization extraction model." },
        { status: 400 },
      );
    }

    const modelId = resolveOrgHighlightModel(body.model);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "items is required (non-empty array)." },
        { status: 400 },
      );
    }
    if (items.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: `At most ${MAX_ITEMS} items per request.` },
        { status: 400 },
      );
    }

    const normalized = normalizeItems(items);

    if (pass === 4) {
      const priorRuns = await loadOrgHighlightRuns(
        normalized.map((item) => item.emailId),
      );
      const priorRun = priorRuns[modelId];
      if (!priorRun?.thirdPass) {
        return NextResponse.json(
          {
            error:
              "Run the fingerprint (3rd) pass for this model before merging.",
          },
          { status: 400 },
        );
      }

      const sourced: SourcedOrgEntityCard[] = [];
      for (const item of normalized) {
        const cards =
          priorRun.thirdPass.entityCardsByEmailId[item.emailId] ?? [];
        const labelParts = [
          item.fromAddress || null,
          item.subject || null,
        ].filter(Boolean);
        const sourceLabel =
          labelParts.length > 0
            ? labelParts.join(" · ")
            : item.emailId.slice(0, 8);
        for (const card of cards) {
          sourced.push({
            ...card,
            source_email_id: item.emailId,
            source_label: sourceLabel,
          });
        }
      }

      try {
        const { entityCards, usage, costUsd, modelName } =
          await mergeOrgFingerprints(sourced, modelId);
        const fourthPass = await saveOrgFingerprintMerge({
          modelId,
          emailIds: normalized.map((item) => item.emailId),
          entityCards,
          inputCardCount: sourced.length,
          usage,
          costUsd,
          modelName,
        });

        // No registry ingest for organizations yet — merge save only.
        return NextResponse.json({
          results: [
            {
              emailId: "__merged__",
              entityCards,
            },
          ],
          fourthPass,
          model: modelId,
          pass: 4,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            costUsd,
            modelName,
          },
          stats: {
            inputCardCount: sourced.length,
            cardCount: entityCards.length,
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Fingerprint merge failed.";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    if (pass === 3) {
      const priorRuns = await loadOrgHighlightRuns(
        normalized.map((item) => item.emailId),
      );
      const priorRun = priorRuns[modelId];
      if (!priorRun) {
        return NextResponse.json(
          {
            error:
              "Run the first pass for this model before the fingerprint pass.",
          },
          { status: 400 },
        );
      }

      const results = await mapWithConcurrency(
        normalized,
        CONCURRENCY,
        async (item): Promise<FingerprintResultItem> => {
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
            return {
              emailId: item.emailId,
              entityCards: [],
              skipped: true,
            };
          }

          try {
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
            return {
              emailId: item.emailId,
              entityCards,
              usage,
              costUsd,
              modelName,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Fingerprint failed.";
            return {
              emailId: item.emailId,
              entityCards: [],
              error: message,
            };
          }
        },
      );

      await saveOrgHighlightThirdPass(modelId, results);

      return NextResponse.json({
        results,
        model: modelId,
        pass: 3,
        usage: aggregateUsage(results, modelId),
      });
    }

    if (pass === 2) {
      const priorRuns = await loadOrgHighlightRuns(
        normalized.map((item) => item.emailId),
      );
      const priorRun = priorRuns[modelId];
      if (!priorRun) {
        return NextResponse.json(
          {
            error:
              "Run the first pass for this model before the second pass.",
          },
          { status: 400 },
        );
      }

      const results = await mapWithConcurrency(
        normalized,
        CONCURRENCY,
        async (item): Promise<ResultItem> => {
          const priorExtraction =
            priorRun.extractions[item.emailId] ??
            emptyOrgHighlightExtraction();

          if (!item.highlightedText) {
            return {
              emailId: item.emailId,
              extraction: emptyOrgHighlightExtraction(),
              skipped: true,
            };
          }

          try {
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
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Extraction failed.";
            return {
              emailId: item.emailId,
              extraction: emptyOrgHighlightExtraction(),
              error: message,
            };
          }
        },
      );

      await saveOrgHighlightSecondPass(modelId, results);

      return NextResponse.json({
        results,
        model: modelId,
        pass: 2,
        usage: aggregateUsage(results, modelId),
      });
    }

    const results = await mapWithConcurrency(
      normalized,
      CONCURRENCY,
      async (item): Promise<ResultItem> => {
        if (!item.highlightedText) {
          return {
            emailId: item.emailId,
            extraction: emptyOrgHighlightExtraction(),
            skipped: true,
          };
        }

        try {
          const { extraction, usage, costUsd, modelName } =
            await extractOrgHighlightsFromText(item.highlightedText, modelId);
          return {
            emailId: item.emailId,
            extraction,
            usage,
            costUsd,
            modelName,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Extraction failed.";
          return {
            emailId: item.emailId,
            extraction: emptyOrgHighlightExtraction(),
            error: message,
          };
        }
      },
    );

    await saveOrgHighlightExtractions(modelId, results);

    return NextResponse.json({
      results,
      model: modelId,
      pass: 1,
      usage: aggregateUsage(results, modelId),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Organization extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
