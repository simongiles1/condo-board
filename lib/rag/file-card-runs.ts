import { and, asc, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

import { getDb } from "@/lib/db";
import {
  attachmentDocuments,
  attachmentFileCards,
  emailAttachments,
  emails,
  fileCardRuns,
} from "@/lib/db/schema";
import { parseStoredFileMetadata } from "@/lib/email/attachment-file-metadata";
import type { PdfFileMetadata } from "@/lib/pdf/document-properties";
import {
  deepSeekRatesAt,
  deepSeekRatesForTier,
  getDeepSeekPricingStatus,
  type DeepSeekPricingTier,
} from "@/lib/deepseek/pricing";

export type FileCardRunScope = "test" | "target_emails" | "pending_corpus";

export type FileCardRunRecord = {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  scope: FileCardRunScope;
  docLimit: number | null;
  totalDocs: number;
  completedDocs: number;
  failedDocs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  peakCostUsd: number;
  offPeakCostUsd: number;
  plannedHashes: string[];
  plannedEmailIds: string[];
  currentDocIndex: number;
  currentLabel: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  workerAlive?: boolean;
};

export type FileCardTargetDoc = {
  contentHash: string;
  filename: string;
  mimeType: string;
  attachmentId: string;
  emailId: string | null;
  subject: string | null;
  receivedAt: string | null;
  emailBodyText: string | null;
  hasExistingCard: boolean;
};

type FileCardRunRow = typeof fileCardRuns.$inferSelect;

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function runRowToRecord(row: FileCardRunRow): FileCardRunRecord {
  return {
    id: row.id,
    status: row.status as FileCardRunRecord["status"],
    scope: row.scope as FileCardRunScope,
    docLimit: row.docLimit,
    totalDocs: row.totalDocs,
    completedDocs: row.completedDocs,
    failedDocs: row.failedDocs,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    totalCostUsd: Number(row.totalCostUsd) || 0,
    peakCostUsd: Number(row.peakCostUsd) || 0,
    offPeakCostUsd: Number(row.offPeakCostUsd) || 0,
    plannedHashes: parseJsonArray(row.plannedHashesJson),
    plannedEmailIds: parseJsonArray(row.plannedEmailIdsJson),
    currentDocIndex: row.currentDocIndex,
    currentLabel: row.currentLabel,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function planFileCardTargets(options: {
  scope: FileCardRunScope;
  docLimit?: number | null;
  emailIds?: string[];
  forceOverwrite?: boolean;
}): Promise<FileCardTargetDoc[]> {
  const db = getDb();
  const conditions = [
    eq(attachmentDocuments.parseStatus, "parsed"),
    isNotNull(attachmentDocuments.markdownPath),
  ];

  if (options.scope === "target_emails") {
    const cleanEmailIds = (options.emailIds ?? [])
      .map((id) => id.trim())
      .filter(Boolean);
    if (cleanEmailIds.length === 0) return [];
    conditions.push(inArray(emailAttachments.emailId, cleanEmailIds));
  }

  const baseQuery = db
    .select({
      contentHash: attachmentDocuments.contentHash,
      mimeType: attachmentDocuments.mimeType,
      attachmentId: emailAttachments.id,
      filename: emailAttachments.filename,
      emailId: emailAttachments.emailId,
      subject: emails.subject,
      receivedAt: emails.receivedAt,
      bodyTextUnique: emails.bodyTextUnique,
      bodyText: emails.bodyText,
      cardHash: attachmentFileCards.contentHash,
    })
    .from(attachmentDocuments)
    .innerJoin(
      emailAttachments,
      eq(emailAttachments.contentHash, attachmentDocuments.contentHash),
    )
    .leftJoin(emails, eq(emails.id, emailAttachments.emailId))
    .leftJoin(
      attachmentFileCards,
      eq(attachmentFileCards.contentHash, attachmentDocuments.contentHash),
    )
    .where(and(...conditions))
    .orderBy(asc(attachmentDocuments.contentHash), asc(emailAttachments.id));

  const rows = await baseQuery;

  // Deduplicate by contentHash (one document card per unique content hash)
  const byHash = new Map<string, FileCardTargetDoc>();
  for (const row of rows) {
    if (byHash.has(row.contentHash)) continue;

    const hasCard = Boolean(row.cardHash);
    if (!options.forceOverwrite && hasCard && options.scope !== "target_emails") {
      continue;
    }

    const emailBody = row.bodyTextUnique?.trim() || row.bodyText?.trim() || "";
    byHash.set(row.contentHash, {
      contentHash: row.contentHash,
      filename: row.filename,
      mimeType: row.mimeType,
      attachmentId: row.attachmentId,
      emailId: row.emailId,
      subject: row.subject,
      receivedAt: row.receivedAt,
      emailBodyText: emailBody || null,
      hasExistingCard: hasCard,
    });
  }

  let targets = Array.from(byHash.values());
  const limit = options.docLimit;
  if (typeof limit === "number" && limit > 0) {
    targets = targets.slice(0, limit);
  }
  return targets;
}

export async function createFileCardRun(params: {
  scope: FileCardRunScope;
  docLimit?: number | null;
  plannedDocs: FileCardTargetDoc[];
  emailIds?: string[];
}): Promise<FileCardRunRecord> {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const plannedHashes = params.plannedDocs.map((d) => d.contentHash);
  const plannedEmailIds = [
    ...new Set(
      params.plannedDocs
        .map((d) => d.emailId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [row] = await db
    .insert(fileCardRuns)
    .values({
      id,
      status: "running",
      scope: params.scope,
      docLimit: params.docLimit ?? null,
      totalDocs: params.plannedDocs.length,
      completedDocs: 0,
      failedDocs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: "0",
      peakCostUsd: "0",
      offPeakCostUsd: "0",
      plannedHashesJson: JSON.stringify(plannedHashes),
      plannedEmailIdsJson: JSON.stringify(params.emailIds ?? plannedEmailIds),
      currentDocIndex: 0,
      currentLabel: null,
      errorMessage: null,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return runRowToRecord(row);
}

export async function getFileCardRun(id: string): Promise<FileCardRunRecord | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(fileCardRuns)
    .where(eq(fileCardRuns.id, id))
    .limit(1);
  return row ? runRowToRecord(row) : null;
}

export async function listFileCardRuns(limit = 10): Promise<FileCardRunRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(fileCardRuns)
    .orderBy(desc(fileCardRuns.startedAt))
    .limit(limit);
  return rows.map(runRowToRecord);
}

export async function updateFileCardRun(
  id: string,
  patch: Partial<typeof fileCardRuns.$inferInsert>,
): Promise<FileCardRunRecord | null> {
  const db = getDb();
  const now = new Date().toISOString();
  const [row] = await db
    .update(fileCardRuns)
    .set({
      ...patch,
      updatedAt: now,
    })
    .where(eq(fileCardRuns.id, id))
    .returning();
  return row ? runRowToRecord(row) : null;
}

export async function cancelFileCardRun(id: string): Promise<FileCardRunRecord | null> {
  return updateFileCardRun(id, {
    status: "cancelled",
    completedAt: new Date().toISOString(),
  });
}

/** Used when no billed attachment cards exist yet (cache-miss input assumption). */
export const FILE_CARD_FALLBACK_INPUT_TOKENS_PER_DOC = 2320;
export const FILE_CARD_FALLBACK_OUTPUT_TOKENS_PER_DOC = 270;

export type FileCardTokensPerDocBasis = "observed" | "fallback";

export type FileCardCostContext = {
  plannedDocsCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedPeakCostUsd: number;
  estimatedOffPeakCostUsd: number;
  avgInputTokensPerDoc: number;
  avgOutputTokensPerDoc: number;
  tokensPerDocBasis: FileCardTokensPerDocBasis;
  observedCardCount: number;
  currentTier: DeepSeekPricingTier;
  rates: ReturnType<typeof deepSeekRatesAt>;
  pricingStatus: ReturnType<typeof getDeepSeekPricingStatus>;
};

function fileCardCostUsdForTokenCounts(
  inputTokens: number,
  outputTokens: number,
  tier: DeepSeekPricingTier,
): number {
  const tierRates = deepSeekRatesForTier(tier);
  return (
    (inputTokens / 1_000_000) * tierRates.inputCacheMissPerMillion +
    (outputTokens / 1_000_000) * tierRates.outputPerMillion
  );
}

export async function getObservedFileCardTokenAverages(): Promise<{
  sampleSize: number;
  avgInputTokensPerDoc: number;
  avgOutputTokensPerDoc: number;
} | null> {
  const db = getDb();
  const [row] = await db
    .select({
      sampleSize: sql<number>`count(*)::int`,
      avgIn: sql<number>`coalesce(avg(${attachmentFileCards.inputTokens}), 0)`,
      avgOut: sql<number>`coalesce(avg(${attachmentFileCards.outputTokens}), 0)`,
    })
    .from(attachmentFileCards)
    .where(
      and(
        eq(attachmentFileCards.status, "ready"),
        gt(attachmentFileCards.inputTokens, 0),
      ),
    );

  if (!row?.sampleSize) return null;

  return {
    sampleSize: row.sampleSize,
    avgInputTokensPerDoc: Math.round(Number(row.avgIn)),
    avgOutputTokensPerDoc: Math.round(Number(row.avgOut)),
  };
}

export type FileCardPerDocEstimateBasis = {
  avgInputTokensPerDoc: number;
  avgOutputTokensPerDoc: number;
  tokensPerDocBasis: FileCardTokensPerDocBasis;
  observedCardCount: number;
};

export async function getFileCardPerDocEstimateBasis(): Promise<FileCardPerDocEstimateBasis> {
  const observed = await getObservedFileCardTokenAverages();
  if (!observed?.sampleSize) {
    return {
      avgInputTokensPerDoc: FILE_CARD_FALLBACK_INPUT_TOKENS_PER_DOC,
      avgOutputTokensPerDoc: FILE_CARD_FALLBACK_OUTPUT_TOKENS_PER_DOC,
      tokensPerDocBasis: "fallback",
      observedCardCount: 0,
    };
  }

  return {
    avgInputTokensPerDoc: observed.avgInputTokensPerDoc,
    avgOutputTokensPerDoc: observed.avgOutputTokensPerDoc,
    tokensPerDocBasis: "observed",
    observedCardCount: observed.sampleSize,
  };
}

export async function buildFileCardCostContext(
  plannedCount: number,
  atMs = Date.now(),
): Promise<FileCardCostContext> {
  const perDoc = await getFileCardPerDocEstimateBasis();
  return estimateFileCardCostContext(plannedCount, atMs, perDoc);
}

export function estimateFileCardCostContext(
  plannedCount: number,
  atMs = Date.now(),
  perDoc?: {
    avgInputTokensPerDoc: number;
    avgOutputTokensPerDoc: number;
    tokensPerDocBasis: FileCardTokensPerDocBasis;
    observedCardCount: number;
  },
): FileCardCostContext {
  const pricingStatus = getDeepSeekPricingStatus(atMs);
  const rates = deepSeekRatesAt(atMs);

  const avgInputTokensPerDoc =
    perDoc?.avgInputTokensPerDoc ?? FILE_CARD_FALLBACK_INPUT_TOKENS_PER_DOC;
  const avgOutputTokensPerDoc =
    perDoc?.avgOutputTokensPerDoc ?? FILE_CARD_FALLBACK_OUTPUT_TOKENS_PER_DOC;

  const estimatedInputTokens = plannedCount * avgInputTokensPerDoc;
  const estimatedOutputTokens = plannedCount * avgOutputTokensPerDoc;

  const estimatedPeakCostUsd = fileCardCostUsdForTokenCounts(
    estimatedInputTokens,
    estimatedOutputTokens,
    "peak",
  );
  const estimatedOffPeakCostUsd = fileCardCostUsdForTokenCounts(
    estimatedInputTokens,
    estimatedOutputTokens,
    "off_peak",
  );

  return {
    plannedDocsCount: plannedCount,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedPeakCostUsd: Number(estimatedPeakCostUsd.toFixed(4)),
    estimatedOffPeakCostUsd: Number(estimatedOffPeakCostUsd.toFixed(4)),
    avgInputTokensPerDoc,
    avgOutputTokensPerDoc,
    tokensPerDocBasis: perDoc?.tokensPerDocBasis ?? "fallback",
    observedCardCount: perDoc?.observedCardCount ?? 0,
    currentTier: pricingStatus.tier,
    rates,
    pricingStatus,
  };
}

export type TargetEmailSearchItem = {
  emailId: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  attachmentCount: number;
  parsedAttachmentCount: number;
  /** Parsed attachments with stored markdown — eligible for file-card generation. */
  cardableAttachmentCount: number;
  sampleFilenames: string[];
};

export async function searchEmailsForTargeting(
  query: string,
  limit = 20,
): Promise<TargetEmailSearchItem[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  const db = getDb();
  const searchPattern = `%${trimmed}%`;

  const rows = await db
    .select({
      emailId: emails.id,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      receivedAt: emails.receivedAt,
      attachmentId: emailAttachments.id,
      filename: emailAttachments.filename,
      parseStatus: attachmentDocuments.parseStatus,
      markdownPath: attachmentDocuments.markdownPath,
    })
    .from(emails)
    .leftJoin(emailAttachments, eq(emailAttachments.emailId, emails.id))
    .leftJoin(
      attachmentDocuments,
      eq(attachmentDocuments.contentHash, emailAttachments.contentHash),
    )
    .where(
      or(
        sql`lower(${emails.subject}) like ${searchPattern}`,
        sql`lower(${emailAttachments.filename}) like ${searchPattern}`,
        sql`lower(${emails.fromAddress}) like ${searchPattern}`,
      ),
    )
    .orderBy(desc(emails.receivedAt))
    .limit(400);

  const byEmail = new Map<string, TargetEmailSearchItem>();
  const countedAttachmentIds = new Map<string, Set<string>>();

  for (const row of rows) {
    let entry = byEmail.get(row.emailId);
    if (!entry) {
      entry = {
        emailId: row.emailId,
        subject: row.subject || "(no subject)",
        fromAddress: row.fromAddress || "",
        receivedAt: row.receivedAt || "",
        attachmentCount: 0,
        parsedAttachmentCount: 0,
        cardableAttachmentCount: 0,
        sampleFilenames: [],
      };
      byEmail.set(row.emailId, entry);
      countedAttachmentIds.set(row.emailId, new Set());
    }

    if (!row.attachmentId) continue;

    const seen = countedAttachmentIds.get(row.emailId)!;
    if (seen.has(row.attachmentId)) continue;
    seen.add(row.attachmentId);

    entry.attachmentCount++;
    if (row.parseStatus === "parsed") {
      entry.parsedAttachmentCount++;
    }
    if (
      row.parseStatus === "parsed" &&
      row.markdownPath?.trim()
    ) {
      entry.cardableAttachmentCount++;
    }
    if (row.filename && !entry.sampleFilenames.includes(row.filename)) {
      entry.sampleFilenames.push(row.filename);
    }
  }

  return Array.from(byEmail.values())
    .sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""))
    .slice(0, limit);
}

export type FileCardDisplayItem = {
  contentHash: string;
  documentType: string;
  summary: string;
  coveringEmailContext: string;
  parties: string[];
  documentDate: string | null;
  status: "ready" | "failed";
  costUsd: number;
  pricingTier: string;
  rating: "up" | "down" | null;
  notes: string | null;
  packedExcerpt: string | null;
  error: string | null;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
  filename: string;
  attachmentId: string | null;
  emailId: string | null;
  emailSubject: string | null;
  emailReceivedAt: string | null;
  fileMetadata: PdfFileMetadata | null;
};

export async function listFileCards(options?: {
  runId?: string;
  rating?: "up" | "down";
  limit?: number;
}): Promise<FileCardDisplayItem[]> {
  const db = getDb();
  const limit = options?.limit ?? 50;

  const conditions = [];
  if (options?.runId) {
    conditions.push(eq(attachmentFileCards.runId, options.runId));
  }
  if (options?.rating) {
    conditions.push(eq(attachmentFileCards.rating, options.rating));
  }

  const query = db
    .select({
      card: attachmentFileCards,
      attachmentId: emailAttachments.id,
      filename: emailAttachments.filename,
      emailId: emailAttachments.emailId,
      emailSubject: emails.subject,
      emailReceivedAt: emails.receivedAt,
      fileMetadataJson: attachmentDocuments.fileMetadataJson,
    })
    .from(attachmentFileCards)
    .leftJoin(
      emailAttachments,
      eq(emailAttachments.contentHash, attachmentFileCards.contentHash),
    )
    .leftJoin(emails, eq(emails.id, emailAttachments.emailId))
    .leftJoin(
      attachmentDocuments,
      eq(attachmentDocuments.contentHash, attachmentFileCards.contentHash),
    )
    .orderBy(desc(attachmentFileCards.updatedAt));

  const rows = conditions.length > 0
    ? await query.where(and(...conditions)).limit(limit * 3)
    : await query.limit(limit * 3);

  const byHash = new Map<string, FileCardDisplayItem>();
  for (const row of rows) {
    if (byHash.has(row.card.contentHash)) continue;

    let parties: string[] = [];
    try {
      const parsed = JSON.parse(row.card.parties);
      if (Array.isArray(parsed)) {
        parties = parsed.filter((p): p is string => typeof p === "string");
      }
    } catch {
      parties = [];
    }

    byHash.set(row.card.contentHash, {
      contentHash: row.card.contentHash,
      documentType: row.card.documentType,
      summary: row.card.summary,
      coveringEmailContext: row.card.coveringEmailContext,
      parties,
      documentDate: row.card.documentDate,
      status: row.card.status as "ready" | "failed",
      costUsd: Number(row.card.costUsd) || 0,
      pricingTier: row.card.pricingTier,
      rating: (row.card.rating as "up" | "down" | null) ?? null,
      notes: row.card.notes,
      packedExcerpt: row.card.packedExcerpt,
      error: row.card.error,
      runId: row.card.runId,
      createdAt: row.card.createdAt,
      updatedAt: row.card.updatedAt,
      filename: row.filename || "attachment",
      attachmentId: row.attachmentId ?? null,
      emailId: row.emailId ?? null,
      emailSubject: row.emailSubject ?? null,
      emailReceivedAt: row.emailReceivedAt ?? null,
      fileMetadata: parseStoredFileMetadata(row.fileMetadataJson),
    });

    if (byHash.size >= limit) break;
  }

  return Array.from(byHash.values());
}

export async function updateFileCardRating(params: {
  contentHash: string;
  rating?: "up" | "down" | null;
  notes?: string | null;
}): Promise<void> {
  const db = getDb();
  const patch: Partial<typeof attachmentFileCards.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (params.rating !== undefined) {
    patch.rating = params.rating;
  }
  if (params.notes !== undefined) {
    patch.notes = params.notes;
  }
  await db
    .update(attachmentFileCards)
    .set(patch)
    .where(eq(attachmentFileCards.contentHash, params.contentHash));
}

export type AttachmentFileCardLookup = {
  documentType: string;
  summary: string;
  coveringEmailContext?: string | null;
  status: "ready" | "failed";
};

export async function loadAttachmentFileCards(
  contentHashes: string[],
): Promise<Map<string, AttachmentFileCardLookup>> {
  const cleanHashes = Array.from(
    new Set(contentHashes.map((h) => h?.trim()).filter((h): h is string => Boolean(h))),
  );
  if (cleanHashes.length === 0) return new Map();

  const db = getDb();
  const rows = await db
    .select({
      contentHash: attachmentFileCards.contentHash,
      documentType: attachmentFileCards.documentType,
      summary: attachmentFileCards.summary,
      coveringEmailContext: attachmentFileCards.coveringEmailContext,
      status: attachmentFileCards.status,
    })
    .from(attachmentFileCards)
    .where(inArray(attachmentFileCards.contentHash, cleanHashes));

  const map = new Map<string, AttachmentFileCardLookup>();
  for (const row of rows) {
    if (row.status === "ready" && row.summary) {
      map.set(row.contentHash, {
        documentType: row.documentType,
        summary: row.summary,
        coveringEmailContext: row.coveringEmailContext,
        status: row.status as "ready" | "failed",
      });
    }
  }
  return map;
}
