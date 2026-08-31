/** Persist management-report scan runs, documents, and project mentions. */

import { randomUUID } from "crypto";

import { and, desc, eq, ilike, inArray, isNotNull, or } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  attachmentDocuments,
  emailAttachments,
  emails,
  projectBoardMentions,
  projectBoardReportRuns,
  projectBoardReports,
} from "@/lib/db/schema";
import {
  buildBoardReportScanReview,
  classifyBoardDocumentName,
  parseBoardReportRunStatus,
  parseReportDateFromFilename,
  parseStoredBoardReportTopics,
  type BoardReportKind,
  type BoardReportMatchConfidence,
  type BoardReportRunRecord,
  type BoardReportRunStatus,
  type BoardReportScanReview,
  type BoardReportStoredTopic,
  type BoardReportTopic,
} from "@/lib/projects/board-report-shared";
import { canonicalizeProjectWorkName } from "@/lib/projects/identity-match";

export type BoardReportCandidate = {
  contentHash: string;
  filename: string;
  emailId: string;
  receivedAt: string;
  kind: BoardReportKind;
  reportDate: string | null;
  parseStatus: string | null;
  pageCount: number | null;
};

export type BoardReportMentionIndexEntry = {
  count: number;
  lastAt: string | null;
};

function parseCostUsd(value: string | null | undefined): number {
  if (!value?.trim()) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toRunRecord(
  row: typeof projectBoardReportRuns.$inferSelect,
): BoardReportRunRecord {
  return {
    id: row.id,
    modelId: row.modelId,
    status: parseBoardReportRunStatus(row.status),
    reportTotal: row.reportTotal,
    reportCompleted: row.reportCompleted,
    skippedUnparsed: row.skippedUnparsed,
    matchedProjectCount: row.matchedProjectCount,
    unmatchedTopicCount: row.unmatchedTopicCount,
    totalCostUsd: parseCostUsd(row.totalCostUsd),
    lastError: row.lastError,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  };
}

export async function getBoardReportRun(
  runId: string,
): Promise<BoardReportRunRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectBoardReportRuns)
    .where(eq(projectBoardReportRuns.id, runId))
    .limit(1);
  return rows[0] ? toRunRecord(rows[0]) : null;
}

export async function getLatestBoardReportRun(): Promise<BoardReportRunRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectBoardReportRuns)
    .orderBy(desc(projectBoardReportRuns.startedAt))
    .limit(1);
  return rows[0] ? toRunRecord(rows[0]) : null;
}

export async function listRunningBoardReportRuns(): Promise<
  BoardReportRunRecord[]
> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectBoardReportRuns)
    .where(eq(projectBoardReportRuns.status, "running"));
  return rows.map(toRunRecord);
}

export async function createBoardReportRun(params: {
  modelId: string;
}): Promise<BoardReportRunRecord> {
  const db = getDb();
  const now = new Date().toISOString();
  const running = await listRunningBoardReportRuns();
  for (const run of running) {
    await db
      .update(projectBoardReportRuns)
      .set({
        status: "cancelled",
        lastError: "Superseded by a new management-report scan.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(projectBoardReportRuns.id, run.id));
  }

  const id = randomUUID();
  await db.insert(projectBoardReportRuns).values({
    id,
    modelId: params.modelId,
    status: "running",
    reportTotal: 0,
    reportCompleted: 0,
    skippedUnparsed: 0,
    matchedProjectCount: 0,
    unmatchedTopicCount: 0,
    totalCostUsd: "0",
    lastError: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  });
  const created = await getBoardReportRun(id);
  if (!created) throw new Error("Failed to create management-report scan.");
  return created;
}

export async function updateBoardReportRun(
  runId: string,
  patch: Partial<{
    status: BoardReportRunStatus;
    reportTotal: number;
    reportCompleted: number;
    skippedUnparsed: number;
    matchedProjectCount: number;
    unmatchedTopicCount: number;
    totalCostUsd: number;
    lastError: string | null;
    finishedAt: string | null;
  }>,
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .update(projectBoardReportRuns)
    .set({
      ...(patch.status != null ? { status: patch.status } : {}),
      ...(patch.reportTotal != null ? { reportTotal: patch.reportTotal } : {}),
      ...(patch.reportCompleted != null
        ? { reportCompleted: patch.reportCompleted }
        : {}),
      ...(patch.skippedUnparsed != null
        ? { skippedUnparsed: patch.skippedUnparsed }
        : {}),
      ...(patch.matchedProjectCount != null
        ? { matchedProjectCount: patch.matchedProjectCount }
        : {}),
      ...(patch.unmatchedTopicCount != null
        ? { unmatchedTopicCount: patch.unmatchedTopicCount }
        : {}),
      ...(patch.totalCostUsd != null
        ? { totalCostUsd: String(patch.totalCostUsd) }
        : {}),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      ...(patch.finishedAt !== undefined
        ? { finishedAt: patch.finishedAt }
        : {}),
      updatedAt: now,
    })
    .where(eq(projectBoardReportRuns.id, runId));
}

/**
 * Unique management-report / board-package PDFs from harvested attachments.
 * One row per content hash, earliest received email wins.
 */
export async function listBoardReportCandidates(): Promise<
  BoardReportCandidate[]
> {
  const db = getDb();
  const rows = await db
    .select({
      contentHash: emailAttachments.contentHash,
      filename: emailAttachments.filename,
      emailId: emailAttachments.emailId,
      receivedAt: emails.receivedAt,
      parseStatus: attachmentDocuments.parseStatus,
      pageCount: attachmentDocuments.pageCount,
    })
    .from(emailAttachments)
    .innerJoin(emails, eq(emails.id, emailAttachments.emailId))
    .leftJoin(
      attachmentDocuments,
      eq(attachmentDocuments.contentHash, emailAttachments.contentHash),
    )
    .where(
      and(
        isNotNull(emailAttachments.contentHash),
        or(
          ilike(emailAttachments.filename, "%management report%"),
          ilike(emailAttachments.filename, "%board meeting package%"),
        ),
      ),
    );

  const byHash = new Map<string, BoardReportCandidate>();
  for (const row of rows) {
    const contentHash = row.contentHash?.trim();
    if (!contentHash) continue;
    const kind = classifyBoardDocumentName(row.filename);
    if (!kind) continue;
    const receivedAt = row.receivedAt;
    const existing = byHash.get(contentHash);
    if (existing && existing.receivedAt <= receivedAt) continue;
    byHash.set(contentHash, {
      contentHash,
      filename: row.filename,
      emailId: row.emailId,
      receivedAt,
      kind,
      reportDate: parseReportDateFromFilename(row.filename),
      parseStatus: row.parseStatus,
      pageCount: row.pageCount,
    });
  }

  return [...byHash.values()].sort((a, b) => {
    const aDate = a.reportDate ?? a.receivedAt;
    const bDate = b.reportDate ?? b.receivedAt;
    return aDate.localeCompare(bDate);
  });
}

export async function upsertBoardReportDocument(params: {
  candidate: BoardReportCandidate;
  runId: string;
  topics: BoardReportTopic[];
  extractionJson: string | null;
  error: string | null;
}): Promise<string> {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await db
    .select({ id: projectBoardReports.id })
    .from(projectBoardReports)
    .where(eq(projectBoardReports.contentHash, params.candidate.contentHash))
    .limit(1);

  const values = {
    filename: params.candidate.filename,
    emailId: params.candidate.emailId,
    kind: params.candidate.kind,
    reportDate: params.candidate.reportDate,
    receivedAt: params.candidate.receivedAt,
    pageCount: params.candidate.pageCount,
    parseStatus: params.candidate.parseStatus,
    topicsJson: JSON.stringify(params.topics),
    extractionJson: params.extractionJson,
    error: params.error,
    runId: params.runId,
    updatedAt: now,
  };

  if (existing[0]) {
    await db
      .update(projectBoardReports)
      .set(values)
      .where(eq(projectBoardReports.id, existing[0].id));
    return existing[0].id;
  }

  const id = randomUUID();
  await db.insert(projectBoardReports).values({
    id,
    contentHash: params.candidate.contentHash,
    ...values,
  });
  return id;
}

export async function replaceBoardReportMentions(params: {
  reportId: string;
  mentions: Array<{
    projectKey: string;
    topicName: string;
    confidence: BoardReportMatchConfidence;
    score: number;
  }>;
}): Promise<void> {
  const db = getDb();
  await db
    .delete(projectBoardMentions)
    .where(eq(projectBoardMentions.reportId, params.reportId));
  if (params.mentions.length === 0) return;
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const rows = [];
  for (const mention of params.mentions) {
    const key = `${mention.projectKey}::${params.reportId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: randomUUID(),
      projectKey: mention.projectKey,
      reportId: params.reportId,
      topicName: mention.topicName,
      confidence: mention.confidence,
      score: String(mention.score),
      createdAt: now,
    });
  }
  if (rows.length > 0) {
    await db.insert(projectBoardMentions).values(rows);
  }
}

export async function updateBoardReportDocumentTopics(params: {
  reportId: string;
  topics: BoardReportStoredTopic[];
}): Promise<void> {
  const db = getDb();
  await db
    .update(projectBoardReports)
    .set({
      topicsJson: JSON.stringify(params.topics),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(projectBoardReports.id, params.reportId));
}

export async function listBoardReportDocuments(runId: string): Promise<
  Array<{
    id: string;
    filename: string;
    kind: BoardReportKind;
    reportDate: string | null;
    receivedAt: string | null;
    pageCount: number | null;
    parseStatus: string | null;
    error: string | null;
    emailId: string | null;
    topicsJson: string;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: projectBoardReports.id,
      filename: projectBoardReports.filename,
      kind: projectBoardReports.kind,
      reportDate: projectBoardReports.reportDate,
      receivedAt: projectBoardReports.receivedAt,
      pageCount: projectBoardReports.pageCount,
      parseStatus: projectBoardReports.parseStatus,
      error: projectBoardReports.error,
      emailId: projectBoardReports.emailId,
      topicsJson: projectBoardReports.topicsJson,
    })
    .from(projectBoardReports)
    .where(eq(projectBoardReports.runId, runId));
  return rows.map((row) => ({
    ...row,
    kind: row.kind === "board_package" ? "board_package" : "management_report",
  }));
}

export async function loadBoardReportScanReview(
  runId: string,
): Promise<BoardReportScanReview> {
  const db = getDb();
  const documents = await listBoardReportDocuments(runId);
  const mentionRows =
    documents.length === 0
      ? []
      : await db
          .select({
            reportId: projectBoardMentions.reportId,
            topicName: projectBoardMentions.topicName,
          })
          .from(projectBoardMentions)
          .where(
            inArray(
              projectBoardMentions.reportId,
              documents.map((doc) => doc.id),
            ),
          );

  const mentionedByReportId = new Map<string, Set<string>>();
  const reportIds = new Set(documents.map((doc) => doc.id));
  for (const row of mentionRows) {
    if (!reportIds.has(row.reportId)) continue;
    const canon = canonicalizeProjectWorkName(row.topicName);
    if (!canon) continue;
    const set = mentionedByReportId.get(row.reportId) ?? new Set<string>();
    set.add(canon);
    mentionedByReportId.set(row.reportId, set);
  }

  return buildBoardReportScanReview({
    documents: documents.map((doc) => {
      let topics: BoardReportStoredTopic[] = [];
      try {
        topics = parseStoredBoardReportTopics(
          JSON.parse(doc.topicsJson) as unknown,
        );
      } catch {
        topics = [];
      }
      return {
        id: doc.id,
        filename: doc.filename,
        kind: doc.kind,
        reportDate: doc.reportDate,
        receivedAt: doc.receivedAt,
        pageCount: doc.pageCount,
        parseStatus: doc.parseStatus,
        error: doc.error,
        emailId: doc.emailId,
        topics,
      };
    }),
    mentionedByReportId,
  });
}

export async function loadBoardReportMentionIndex(): Promise<
  Map<string, BoardReportMentionIndexEntry>
> {
  const db = getDb();
  const rows = await db
    .select({
      projectKey: projectBoardMentions.projectKey,
      reportDate: projectBoardReports.reportDate,
      receivedAt: projectBoardReports.receivedAt,
    })
    .from(projectBoardMentions)
    .innerJoin(
      projectBoardReports,
      eq(projectBoardReports.id, projectBoardMentions.reportId),
    );

  const index = new Map<string, BoardReportMentionIndexEntry>();
  for (const row of rows) {
    const at = row.reportDate ?? row.receivedAt ?? null;
    const prev = index.get(row.projectKey);
    if (!prev) {
      index.set(row.projectKey, { count: 1, lastAt: at });
      continue;
    }
    prev.count += 1;
    if (at && (!prev.lastAt || at > prev.lastAt)) prev.lastAt = at;
  }
  return index;
}
