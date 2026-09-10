import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  attachmentFileCards,
  emailFileCards,
  fileCardRuns,
  attachmentDocuments,
} from "@/lib/db/schema";
import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { estimateDeepSeekCostBreakdown } from "@/lib/deepseek/pricing";
import { ensureAttachmentFileMetadata } from "@/lib/email/attachment-file-metadata";
import { readAttachmentMarkdown } from "@/lib/email/attachment-markdown";
import {
  canSkipCardGeneration,
  EMAIL_SUMMARY_THRESHOLD_CHARS,
  FILE_CARD_SYSTEM_PROMPT,
  mergeFileCardParties,
  packFileCardPrompt,
  parseFileCardJson,
} from "@/lib/rag/file-card-pack";
import {
  getFileCardRun,
  planFileCardTargets,
  updateFileCardRun,
} from "@/lib/rag/file-card-runs";

const activeWorkers = new Map<string, Promise<void>>();

export function isFileCardWorkerAlive(runId: string): boolean {
  return activeWorkers.has(runId);
}

export function kickFileCardWorker(
  runId: string,
  options?: { forceOverwrite?: boolean },
): void {
  if (activeWorkers.has(runId)) return;

  const promise = (async () => {
    try {
      await runFileCardWorker(runId, options);
    } catch (err) {
      console.error(`[file-card-worker] unhandled failure for run ${runId}:`, err);
      try {
        await updateFileCardRun(runId, {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
          completedAt: new Date().toISOString(),
        });
      } catch {
        // ignore secondary error
      }
    } finally {
      activeWorkers.delete(runId);
    }
  })();

  activeWorkers.set(runId, promise);
}

async function isRunStillActive(runId: string): Promise<boolean> {
  const run = await getFileCardRun(runId);
  return run?.status === "running";
}

export async function runFileCardWorker(
  runId: string,
  options?: { forceOverwrite?: boolean },
): Promise<void> {
  const initialRun = await getFileCardRun(runId);
  if (!initialRun || initialRun.status !== "running") return;

  const plannedDocs = await planFileCardTargets({
    scope: initialRun.scope,
    docLimit: initialRun.docLimit,
    emailIds: initialRun.plannedEmailIds,
    forceOverwrite: options?.forceOverwrite ?? false,
  });

  const db = getDb();

  // Find emails that already have a summary card
  const plannedEmailIds = [
    ...new Set(
      plannedDocs
        .map((d) => d.emailId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const summarizedEmailIds = new Set<string>();
  if (plannedEmailIds.length > 0) {
    const existingEmailCards = await db
      .select({ emailId: emailFileCards.emailId })
      .from(emailFileCards)
      .where(inArray(emailFileCards.emailId, plannedEmailIds));
    for (const row of existingEmailCards) {
      summarizedEmailIds.add(row.emailId);
    }
  }

  // Find existing attachment cards for input-hash comparison
  const plannedHashes = plannedDocs.map((d) => d.contentHash);
  const existingCardsByHash = new Map<
    string,
    { inputHash: string; inputChars: number }
  >();
  if (plannedHashes.length > 0) {
    const existingCards = await db
      .select({
        contentHash: attachmentFileCards.contentHash,
        inputHash: attachmentFileCards.inputHash,
        inputChars: attachmentFileCards.inputChars,
      })
      .from(attachmentFileCards)
      .where(inArray(attachmentFileCards.contentHash, plannedHashes));
    for (const row of existingCards) {
      existingCardsByHash.set(row.contentHash, {
        inputHash: row.inputHash,
        inputChars: row.inputChars,
      });
    }
  }

  const docMetaByHash = new Map<
    string,
    { mimeType: string; ext: string; fileMetadataJson: string | null }
  >();
  if (plannedHashes.length > 0) {
    const docRows = await db
      .select({
        contentHash: attachmentDocuments.contentHash,
        mimeType: attachmentDocuments.mimeType,
        ext: attachmentDocuments.ext,
        fileMetadataJson: attachmentDocuments.fileMetadataJson,
      })
      .from(attachmentDocuments)
      .where(inArray(attachmentDocuments.contentHash, plannedHashes));
    for (const row of docRows) {
      docMetaByHash.set(row.contentHash, {
        mimeType: row.mimeType,
        ext: row.ext,
        fileMetadataJson: row.fileMetadataJson,
      });
    }
  }

  let completedDocs = 0;
  let failedDocs = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let peakCostUsd = 0;
  let offPeakCostUsd = 0;

  const modelName =
    process.env.DEEPSEEK_MODEL_FILE_CARD?.trim() || "deepseek-v4-flash";

  for (let i = 0; i < plannedDocs.length; i++) {
    if (!(await isRunStillActive(runId))) {
      console.log(`[file-card-worker] run ${runId} was cancelled or stopped.`);
      return;
    }

    const doc = plannedDocs[i];

    await updateFileCardRun(runId, {
      currentDocIndex: i + 1,
      currentLabel: doc.filename,
    });

    const markdown = await readAttachmentMarkdown(doc.contentHash);
    if (!markdown?.trim()) {
      failedDocs++;
      const nowIso = new Date().toISOString();
      await db
        .insert(attachmentFileCards)
        .values({
          contentHash: doc.contentHash,
          documentType: "other",
          summary: "Attachment has no parsed markdown available.",
          coveringEmailContext: doc.subject ? `Subject: ${doc.subject}` : "",
          parties: "[]",
          documentDate: null,
          status: "failed",
          inputHash: "empty",
          inputChars: 0,
          packedExcerpt: null,
          modelName,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: "0",
          pricingTier: "off_peak",
          billedAt: nowIso,
          error: "No parsed markdown available.",
          runId,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: attachmentFileCards.contentHash,
          set: {
            status: "failed",
            error: "No parsed markdown available.",
            runId,
            updatedAt: nowIso,
          },
        });

      await updateFileCardRun(runId, {
        completedDocs,
        failedDocs,
      });
      continue;
    }

    const needsEmailSummary =
      Boolean(doc.emailId) &&
      !summarizedEmailIds.has(doc.emailId!) &&
      (doc.emailBodyText?.length ?? 0) >= EMAIL_SUMMARY_THRESHOLD_CHARS;

    const docMeta = docMetaByHash.get(doc.contentHash);
    const fileMetadata = docMeta
      ? await ensureAttachmentFileMetadata({
          contentHash: doc.contentHash,
          mimeType: docMeta.mimeType,
          ext: docMeta.ext,
          existingJson: docMeta.fileMetadataJson,
        })
      : null;

    const packed = packFileCardPrompt({
      filename: doc.filename,
      subject: doc.subject,
      coveringEmailText: doc.emailBodyText,
      markdown,
      includeEmailSummaryPrompt: needsEmailSummary,
      fileMetadata,
    });

    const existing = existingCardsByHash.get(doc.contentHash);
    if (
      canSkipCardGeneration({
        existingInputHash: existing?.inputHash,
        existingInputChars: existing?.inputChars,
        newInputHash: packed.inputHash,
        newInputChars: packed.inputChars,
        forceOverwrite: options?.forceOverwrite,
      })
    ) {
      completedDocs++;
      await updateFileCardRun(runId, {
        completedDocs,
        failedDocs,
      });
      continue;
    }

    try {
      const billedAtMs = Date.now();
      const generated = await generateDeepSeekJson({
        systemInstruction: FILE_CARD_SYSTEM_PROMPT,
        userText: packed.userPrompt,
        modelName,
        maxOutputTokens: 2048,
        thinking: false,
      });

      const costBreakdown = estimateDeepSeekCostBreakdown(
        {
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
          billedAtMs,
        },
        billedAtMs,
      );

      const parsed = parseFileCardJson(generated.text);
      const nowIso = new Date().toISOString();

      if (!parsed) {
        failedDocs++;
        await db
          .insert(attachmentFileCards)
          .values({
            contentHash: doc.contentHash,
            documentType: "other",
            summary: "Failed to parse structured JSON from model output.",
            coveringEmailContext: doc.subject ? `Subject: ${doc.subject}` : "",
            parties: "[]",
            documentDate: null,
            status: "failed",
            inputHash: packed.inputHash,
            inputChars: packed.inputChars,
            packedExcerpt: packed.packedExcerpt,
            modelName,
            inputTokens: generated.usage.inputTokens,
            outputTokens: generated.usage.outputTokens,
            costUsd: costBreakdown.totalCostUsd.toFixed(6),
            pricingTier: costBreakdown.tier,
            billedAt: new Date(billedAtMs).toISOString(),
            error: "Failed to parse structured JSON from model output.",
            runId,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .onConflictDoUpdate({
            target: attachmentFileCards.contentHash,
            set: {
              status: "failed",
              error: "Failed to parse structured JSON from model output.",
              inputTokens: generated.usage.inputTokens,
              outputTokens: generated.usage.outputTokens,
              costUsd: costBreakdown.totalCostUsd.toFixed(6),
              runId,
              updatedAt: nowIso,
            },
          });
      } else {
        completedDocs++;
        const parties = mergeFileCardParties(parsed.parties, fileMetadata);
        await db
          .insert(attachmentFileCards)
          .values({
            contentHash: doc.contentHash,
            documentType: parsed.document_type,
            summary: parsed.summary,
            coveringEmailContext: parsed.covering_email_context,
            parties: JSON.stringify(parties),
            documentDate: parsed.document_date,
            status: "ready",
            inputHash: packed.inputHash,
            inputChars: packed.inputChars,
            packedExcerpt: packed.packedExcerpt,
            modelName,
            inputTokens: generated.usage.inputTokens,
            outputTokens: generated.usage.outputTokens,
            costUsd: costBreakdown.totalCostUsd.toFixed(6),
            pricingTier: costBreakdown.tier,
            billedAt: new Date(billedAtMs).toISOString(),
            runId,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .onConflictDoUpdate({
            target: attachmentFileCards.contentHash,
            set: {
              documentType: parsed.document_type,
              summary: parsed.summary,
              coveringEmailContext: parsed.covering_email_context,
              parties: JSON.stringify(parties),
              documentDate: parsed.document_date,
              status: "ready",
              inputHash: packed.inputHash,
              inputChars: packed.inputChars,
              packedExcerpt: packed.packedExcerpt,
              modelName,
              inputTokens: generated.usage.inputTokens,
              outputTokens: generated.usage.outputTokens,
              costUsd: costBreakdown.totalCostUsd.toFixed(6),
              pricingTier: costBreakdown.tier,
              billedAt: new Date(billedAtMs).toISOString(),
              error: null,
              runId,
              updatedAt: nowIso,
            },
          });

        if (needsEmailSummary && parsed.email_summary && doc.emailId) {
          await db
            .insert(emailFileCards)
            .values({
              emailId: doc.emailId,
              summary: parsed.email_summary,
              inputHash: packed.inputHash,
              inputChars: doc.emailBodyText?.length ?? 0,
              modelName,
              inputTokens: 0,
              outputTokens: 0,
              costUsd: "0",
              pricingTier: costBreakdown.tier,
              billedAt: new Date(billedAtMs).toISOString(),
              runId,
              createdAt: nowIso,
              updatedAt: nowIso,
            })
            .onConflictDoUpdate({
              target: emailFileCards.emailId,
              set: {
                summary: parsed.email_summary,
                runId,
                updatedAt: nowIso,
              },
            });
          summarizedEmailIds.add(doc.emailId);
        }
      }

      totalInputTokens += generated.usage.inputTokens;
      totalOutputTokens += generated.usage.outputTokens;
      totalCostUsd += costBreakdown.totalCostUsd;
      if (costBreakdown.tier === "peak") {
        peakCostUsd += costBreakdown.totalCostUsd;
      } else {
        offPeakCostUsd += costBreakdown.totalCostUsd;
      }

      await updateFileCardRun(runId, {
        completedDocs,
        failedDocs,
        totalInputTokens,
        totalOutputTokens,
        totalCostUsd: totalCostUsd.toFixed(6),
        peakCostUsd: peakCostUsd.toFixed(6),
        offPeakCostUsd: offPeakCostUsd.toFixed(6),
      });
    } catch (callErr) {
      failedDocs++;
      console.error(
        `[file-card-worker] failed doc ${doc.contentHash} (${doc.filename}):`,
        callErr,
      );
      await updateFileCardRun(runId, {
        completedDocs,
        failedDocs,
      });
    }
  }

  await updateFileCardRun(runId, {
    status: "completed",
    completedAt: new Date().toISOString(),
    currentLabel: null,
  });
}
