/** Persist discovered recurring document series, members, exclusions, and runs. */

import { randomUUID } from "crypto";

import { desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  attachmentFileCards,
  documentSeries,
  documentSeriesExclusions,
  documentSeriesMembers,
  documentSeriesRuns,
  emailAttachments,
  emails,
} from "@/lib/db/schema";
import {
  isSeriesDiscoveryEligible,
  type DocumentSeriesMemberSource,
  type DocumentSeriesRunStatus,
  type DocumentSeriesUsage,
} from "@/lib/documents/series-shared";

export type DocumentSeriesRunRecord = {
  id: string;
  status: DocumentSeriesRunStatus;
  totalDocs: number;
  clusteredDocs: number;
  seriesCount: number;
  embedTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  totalCostUsd: string;
  currentLabel: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type DocumentSeriesListItem = {
  id: string;
  title: string;
  description: string;
  usage: DocumentSeriesUsage | null;
  memberCount: number;
  firstDate: string | null;
  lastDate: string | null;
};

export type DocumentSeriesMemberFile = {
  contentHash: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  receivedAt: string;
  fromAddress: string;
  subject: string;
  threadId: string | null;
  documentDate: string | null;
  summary: string;
  source: DocumentSeriesMemberSource;
  subtypeKey: string | null;
  subtypeTitle: string | null;
};

export type SeriesDiscoveryDoc = {
  contentHash: string;
  filename: string;
  mimeType: string;
  documentType: string;
  documentDate: string | null;
  coveringEmailContext: string;
  summary: string;
  receivedAt: string;
  locked: boolean;
};

function runFromRow(
  row: typeof documentSeriesRuns.$inferSelect,
): DocumentSeriesRunRecord {
  return {
    id: row.id,
    status: row.status as DocumentSeriesRunStatus,
    totalDocs: row.totalDocs,
    clusteredDocs: row.clusteredDocs,
    seriesCount: row.seriesCount,
    embedTokens: row.embedTokens,
    llmInputTokens: row.llmInputTokens,
    llmOutputTokens: row.llmOutputTokens,
    totalCostUsd: row.totalCostUsd,
    currentLabel: row.currentLabel,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

export async function createDocumentSeriesRun(): Promise<DocumentSeriesRunRecord> {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.insert(documentSeriesRuns).values({
    id,
    status: "running",
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const row = await getDocumentSeriesRun(id);
  if (!row) throw new Error("Failed to create document series run.");
  return row;
}

export async function getDocumentSeriesRun(
  id: string,
): Promise<DocumentSeriesRunRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(documentSeriesRuns)
    .where(eq(documentSeriesRuns.id, id))
    .limit(1);
  return rows[0] ? runFromRow(rows[0]) : null;
}

export async function getLatestDocumentSeriesRun(): Promise<DocumentSeriesRunRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(documentSeriesRuns)
    .orderBy(desc(documentSeriesRuns.startedAt))
    .limit(1);
  return rows[0] ? runFromRow(rows[0]) : null;
}

export async function listRunningDocumentSeriesRuns(): Promise<
  DocumentSeriesRunRecord[]
> {
  const db = getDb();
  const rows = await db
    .select()
    .from(documentSeriesRuns)
    .where(eq(documentSeriesRuns.status, "running"));
  return rows.map(runFromRow);
}

export async function updateDocumentSeriesRun(
  id: string,
  patch: Partial<{
    status: DocumentSeriesRunStatus;
    totalDocs: number;
    clusteredDocs: number;
    seriesCount: number;
    embedTokens: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    totalCostUsd: string;
    currentLabel: string | null;
    errorMessage: string | null;
    completedAt: string | null;
  }>,
): Promise<void> {
  const db = getDb();
  await db
    .update(documentSeriesRuns)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(documentSeriesRuns.id, id));
}

export async function loadSeriesDiscoveryDocs(): Promise<SeriesDiscoveryDoc[]> {
  const db = getDb();
  const rows = await db
    .select({
      contentHash: attachmentFileCards.contentHash,
      documentType: attachmentFileCards.documentType,
      documentDate: attachmentFileCards.documentDate,
      coveringEmailContext: attachmentFileCards.coveringEmailContext,
      summary: attachmentFileCards.summary,
      filename: emailAttachments.filename,
      mimeType: emailAttachments.mimeType,
      hasValue: emailAttachments.hasValue,
      receivedAt: emails.receivedAt,
      excluded: documentSeriesExclusions.contentHash,
      memberSource: documentSeriesMembers.source,
    })
    .from(attachmentFileCards)
    .innerJoin(
      emailAttachments,
      eq(emailAttachments.contentHash, attachmentFileCards.contentHash),
    )
    .innerJoin(emails, eq(emails.id, emailAttachments.emailId))
    .leftJoin(
      documentSeriesExclusions,
      eq(documentSeriesExclusions.contentHash, attachmentFileCards.contentHash),
    )
    .leftJoin(
      documentSeriesMembers,
      eq(documentSeriesMembers.contentHash, attachmentFileCards.contentHash),
    )
    .where(eq(attachmentFileCards.status, "ready"));

  const byHash = new Map<string, SeriesDiscoveryDoc>();
  for (const row of rows) {
    if (row.excluded) continue;
    if (
      !isSeriesDiscoveryEligible({
        mimeType: row.mimeType,
        filename: row.filename,
        hasValue: row.hasValue,
      })
    ) {
      continue;
    }
    const receivedAt = row.receivedAt;
    const existing = byHash.get(row.contentHash);
    if (existing && existing.receivedAt <= receivedAt) continue;
    byHash.set(row.contentHash, {
      contentHash: row.contentHash,
      filename: row.filename,
      mimeType: row.mimeType,
      documentType: row.documentType,
      documentDate: row.documentDate,
      coveringEmailContext: row.coveringEmailContext,
      summary: row.summary,
      receivedAt,
      locked: row.memberSource === "human",
    });
  }
  return [...byHash.values()];
}

export async function listExistingSeriesForDiscovery(): Promise<
  Array<{
    id: string;
    title: string;
    description: string;
    usage: DocumentSeriesUsage | null;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: documentSeries.id,
      title: documentSeries.title,
      description: documentSeries.description,
      usage: documentSeries.usage,
    })
    .from(documentSeries)
    .orderBy(documentSeries.title);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    usage: (row.usage as DocumentSeriesUsage | null) ?? null,
  }));
}

export async function replaceDiscoveryMembership(params: {
  runId: string;
  series: Array<{
    existingId: string | null;
    title: string;
    description: string;
    usage: DocumentSeriesUsage | null;
    members: Array<{
      contentHash: string;
      subtypeKey: string | null;
      subtypeTitle: string | null;
    }>;
  }>;
  lockedHashes: Set<string>;
}): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();

  const humanRows = await db
    .select()
    .from(documentSeriesMembers)
    .where(eq(documentSeriesMembers.source, "human"));
  const humanHashes = new Set(humanRows.map((row) => row.contentHash));

  await db
    .delete(documentSeriesMembers)
    .where(eq(documentSeriesMembers.source, "discovery"));

  const occupied = await db
    .select({ seriesId: documentSeriesMembers.seriesId })
    .from(documentSeriesMembers);
  const keptIds = new Set(occupied.map((row) => row.seriesId));
  const allSeries = await db.select({ id: documentSeries.id }).from(documentSeries);
  const emptyIds = allSeries
    .map((row) => row.id)
    .filter((id) => !keptIds.has(id));
  if (emptyIds.length > 0) {
    await db.delete(documentSeries).where(inArray(documentSeries.id, emptyIds));
  }

  let created = 0;
  for (const item of params.series) {
    const members = item.members.filter(
      (member) =>
        !humanHashes.has(member.contentHash) &&
        !params.lockedHashes.has(member.contentHash),
    );
    if (members.length === 0 && !item.existingId) continue;

    let seriesId = item.existingId;
    if (seriesId) {
      const existing = await db
        .select({ id: documentSeries.id })
        .from(documentSeries)
        .where(eq(documentSeries.id, seriesId))
        .limit(1);
      if (!existing[0]) seriesId = null;
    }
    if (!seriesId) {
      seriesId = randomUUID();
      await db.insert(documentSeries).values({
        id: seriesId,
        title: item.title,
        description: item.description,
        usage: item.usage,
        runId: params.runId,
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
    } else {
      await db
        .update(documentSeries)
        .set({
          title: item.title,
          description: item.description,
          usage: item.usage,
          runId: params.runId,
          updatedAt: now,
        })
        .where(eq(documentSeries.id, seriesId));
    }

    for (const member of members) {
      await db
        .insert(documentSeriesMembers)
        .values({
          contentHash: member.contentHash,
          seriesId,
          source: "discovery",
          subtypeKey: member.subtypeKey,
          subtypeTitle: member.subtypeTitle,
          createdAt: now,
        })
        .onConflictDoNothing();
    }
  }

  const remaining = await db.select({ id: documentSeries.id }).from(documentSeries);
  return remaining.length;
}

export async function listDocumentSeries(): Promise<DocumentSeriesListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: documentSeries.id,
      title: documentSeries.title,
      description: documentSeries.description,
      usage: documentSeries.usage,
      memberCount: sql<number>`count(distinct ${documentSeriesMembers.contentHash})::int`,
      firstDate: sql<string | null>`min(${emails.receivedAt})`,
      lastDate: sql<string | null>`max(${emails.receivedAt})`,
    })
    .from(documentSeries)
    .leftJoin(
      documentSeriesMembers,
      eq(documentSeriesMembers.seriesId, documentSeries.id),
    )
    .leftJoin(
      emailAttachments,
      eq(emailAttachments.contentHash, documentSeriesMembers.contentHash),
    )
    .leftJoin(emails, eq(emails.id, emailAttachments.emailId))
    .groupBy(documentSeries.id)
    .orderBy(sql`max(${emails.receivedAt}) desc nulls last`);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    usage: (row.usage as DocumentSeriesUsage | null) ?? null,
    memberCount: row.memberCount,
    firstDate: row.firstDate,
    lastDate: row.lastDate,
  }));
}

export async function listSeriesMembers(
  seriesId: string,
): Promise<DocumentSeriesMemberFile[]> {
  const db = getDb();
  const rows = await db
    .select({
      contentHash: documentSeriesMembers.contentHash,
      source: documentSeriesMembers.source,
      attachmentId: emailAttachments.id,
      filename: emailAttachments.filename,
      mimeType: emailAttachments.mimeType,
      sizeBytes: emailAttachments.sizeBytes,
      receivedAt: emails.receivedAt,
      fromAddress: emails.fromAddress,
      subject: emails.subject,
      threadId: emails.threadId,
      documentDate: attachmentFileCards.documentDate,
      summary: attachmentFileCards.summary,
      subtypeKey: documentSeriesMembers.subtypeKey,
      subtypeTitle: documentSeriesMembers.subtypeTitle,
    })
    .from(documentSeriesMembers)
    .innerJoin(
      emailAttachments,
      eq(emailAttachments.contentHash, documentSeriesMembers.contentHash),
    )
    .innerJoin(emails, eq(emails.id, emailAttachments.emailId))
    .leftJoin(
      attachmentFileCards,
      eq(attachmentFileCards.contentHash, documentSeriesMembers.contentHash),
    )
    .where(eq(documentSeriesMembers.seriesId, seriesId))
    .orderBy(desc(emails.receivedAt));

  const byHash = new Map<string, DocumentSeriesMemberFile>();
  for (const row of rows) {
    const existing = byHash.get(row.contentHash);
    if (existing && existing.receivedAt <= row.receivedAt) continue;
    byHash.set(row.contentHash, {
      contentHash: row.contentHash,
      attachmentId: row.attachmentId,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      receivedAt: row.receivedAt,
      fromAddress: row.fromAddress,
      subject: row.subject,
      threadId: row.threadId,
      documentDate: row.documentDate,
      summary: row.summary ?? "",
      source: row.source as DocumentSeriesMemberSource,
      subtypeKey: row.subtypeKey,
      subtypeTitle: row.subtypeTitle,
    });
  }
  return [...byHash.values()].sort((a, b) =>
    b.receivedAt.localeCompare(a.receivedAt),
  );
}

export async function listBoardPackageSeriesFiles(): Promise<
  Array<{
    id: string;
    filename: string;
    receivedAt: string;
    sizeBytes: number | null;
    parsedDate: string | null;
  }>
> {
  const db = getDb();
  const seriesRows = await db
    .select({ id: documentSeries.id })
    .from(documentSeries)
    .where(eq(documentSeries.usage, "board_package"));
  if (seriesRows.length === 0) return [];

  const rows = await db
    .select({
      attachmentId: emailAttachments.id,
      filename: emailAttachments.filename,
      sizeBytes: emailAttachments.sizeBytes,
      receivedAt: emails.receivedAt,
      documentDate: attachmentFileCards.documentDate,
      contentHash: documentSeriesMembers.contentHash,
    })
    .from(documentSeriesMembers)
    .innerJoin(
      emailAttachments,
      eq(emailAttachments.contentHash, documentSeriesMembers.contentHash),
    )
    .innerJoin(emails, eq(emails.id, emailAttachments.emailId))
    .leftJoin(
      attachmentFileCards,
      eq(attachmentFileCards.contentHash, documentSeriesMembers.contentHash),
    )
    .where(
      inArray(
        documentSeriesMembers.seriesId,
        seriesRows.map((row) => row.id),
      ),
    );

  const byHash = new Map<
    string,
    {
      id: string;
      filename: string;
      receivedAt: string;
      sizeBytes: number | null;
      parsedDate: string | null;
    }
  >();
  for (const row of rows) {
    const existing = byHash.get(row.contentHash);
    if (existing && existing.receivedAt <= row.receivedAt) continue;
    const parsedDate = row.documentDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    byHash.set(row.contentHash, {
      id: row.attachmentId,
      filename: row.filename,
      receivedAt: row.receivedAt,
      sizeBytes: row.sizeBytes,
      parsedDate,
    });
  }
  return [...byHash.values()];
}

export async function ejectSeriesMember(contentHash: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .delete(documentSeriesMembers)
    .where(eq(documentSeriesMembers.contentHash, contentHash));
  await db
    .insert(documentSeriesExclusions)
    .values({ contentHash, createdAt: now })
    .onConflictDoNothing();
}

export async function moveSeriesMember(params: {
  contentHash: string;
  seriesId: string;
}): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .delete(documentSeriesExclusions)
    .where(eq(documentSeriesExclusions.contentHash, params.contentHash));
  await db
    .insert(documentSeriesMembers)
    .values({
      contentHash: params.contentHash,
      seriesId: params.seriesId,
      source: "human",
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: documentSeriesMembers.contentHash,
      set: {
        seriesId: params.seriesId,
        source: "human",
      },
    });
}

export async function cancelDocumentSeriesRun(id: string): Promise<boolean> {
  const run = await getDocumentSeriesRun(id);
  if (!run || run.status !== "running") return false;
  await updateDocumentSeriesRun(id, {
    status: "cancelled",
    currentLabel: "Cancelled.",
    completedAt: new Date().toISOString(),
  });
  return true;
}

export async function countReadyFileCards(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({
      n: sql<number>`count(*)::int`,
    })
    .from(attachmentFileCards)
    .where(eq(attachmentFileCards.status, "ready"));
  return rows[0]?.n ?? 0;
}

export async function getSeriesById(id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(documentSeries)
    .where(eq(documentSeries.id, id))
    .limit(1);
  return rows[0] ?? null;
}
