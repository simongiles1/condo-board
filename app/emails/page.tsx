export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { Suspense } from "react";
import { count, desc, eq, inArray, asc, sql } from "drizzle-orm";

import { EmailFilterButton } from "@/components/EmailFilterButton";
import { EmailTimelineChartButton } from "@/components/EmailTimelineDialog";
import { EmailThreadList } from "@/components/EmailThreadList";
import { EmailViewToggle } from "@/components/EmailViewToggle";
import { getDb } from "@/lib/db";
import { emailAttachments, emailThreads, emails } from "@/lib/db/schema";
import type { EmailAttachmentSummary, ThreadAttachmentGroup } from "@/lib/email/attachment-display";
import {
  loadInboxAnalysisQueueState,
  loadMessageExtractionSummaries,
  loadMessageProcessingStats,
  loadThreadEmailIds,
  loadThreadExtractionSummaries,
  loadThreadProcessingCosts,
  loadThreadProcessingDetails,
  type EmailProcessingStats,
  type InboxAnalysisQueueState,
  type InboxExtractionSummary,
} from "@/lib/email/inbox-processing";
import {
  buildThreadFilterWhere,
  parseEmailThreadFilters,
} from "@/lib/email/thread-filters";

const PAGE_SIZE = 25;

export default async function EmailsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const filters = parseEmailThreadFilters(rawParams);
  const page = filters.page ?? 1;
  const filterWhere = buildThreadFilterWhere(filters);
  const view = filters.view;

  const db = getDb();

  if (view === "messages") {
    const countQuery = db.select({ totalCount: count() }).from(emails);
    const [{ totalCount }] = filterWhere
      ? await countQuery.where(filterWhere)
      : await countQuery;

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * PAGE_SIZE;

    const messagesQuery = db
      .select({
        id: emails.id,
        threadId: emails.threadId,
        fromAddress: emails.fromAddress,
        subject: emails.subject,
        receivedAt: emails.receivedAt,
        processedAt: emails.processedAt,
      })
      .from(emails)
      .orderBy(desc(emails.receivedAt))
      .limit(PAGE_SIZE)
      .offset(offset);

    const messages = filterWhere
      ? await messagesQuery.where(filterWhere)
      : await messagesQuery;

    const messageIds = messages.map((message) => message.id);
    const threadIds = [
      ...new Set(
        messages
          .map((message) => message.threadId)
          .filter((threadId): threadId is string => Boolean(threadId)),
      ),
    ];
    const [
      messageAttachments,
      messageStats,
      threadProcessingDetails,
      messageExtractionSummaries,
      queueState,
    ] = await Promise.all([
      loadMessageAttachments(messageIds),
      loadMessageProcessingStats(messageIds),
      loadThreadProcessingDetails(threadIds),
      loadMessageExtractionSummaries(messageIds),
      loadInboxAnalysisQueueState(messageIds),
    ]);

    return (
      <EmailsPageShell
        title={`Condo emails (${totalCount})`}
        view="messages"
        filters={filters}
        pagination={{
          page: currentPage,
          pageSize: PAGE_SIZE,
          totalCount,
          totalPages,
        }}
        messages={messages.map((message) => {
          const stats = messageStats[message.id];
          return {
            ...message,
            processingCostUsd: stats?.costUsd ?? null,
            processingInputTokens: stats?.inputTokens ?? null,
            processingOutputTokens: stats?.outputTokens ?? null,
            processingDurationMs: stats?.processingDurationMs ?? null,
          };
        })}
        messageAttachments={messageAttachments}
        threadProcessingDetails={threadProcessingDetails}
        messageExtractionSummaries={messageExtractionSummaries}
        initialQueueState={queueState}
      />
    );
  }

  const countQuery = db
    .select({ totalCount: count(sql`DISTINCT ${emailThreads.id}`) })
    .from(emailThreads)
    .innerJoin(emails, eq(emails.threadId, emailThreads.id));

  const [{ totalCount }] = filterWhere
    ? await countQuery.where(filterWhere)
    : await countQuery;

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const threadsQuery = db
    .select({
      id: emailThreads.id,
      gmailThreadId: emailThreads.gmailThreadId,
      subject: emailThreads.subject,
      lastMessageAt: emailThreads.lastMessageAt,
      messageCount: count(emails.id),
      processedMessageCount: sql<number>`SUM(CASE WHEN ${emails.processedAt} IS NOT NULL THEN 1 ELSE 0 END)`.mapWith(
        Number,
      ),
    })
    .from(emailThreads)
    .innerJoin(emails, eq(emails.threadId, emailThreads.id))
    .groupBy(emailThreads.id)
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const threads = filterWhere
    ? await threadsQuery.where(filterWhere)
    : await threadsQuery;

  const threadIds = threads.map((thread) => thread.id);
  const [
    threadAttachmentGroups,
    threadCosts,
    threadEmailIds,
    threadProcessingDetails,
    threadExtractionSummaries,
  ] = await Promise.all([
    loadThreadAttachmentGroups(threadIds),
    loadThreadProcessingCosts(threadIds),
    loadThreadEmailIds(threadIds),
    loadThreadProcessingDetails(threadIds),
    loadThreadExtractionSummaries(threadIds),
  ]);

  const pageEmailIds = Object.values(threadEmailIds).flat();
  const initialQueueState = await loadInboxAnalysisQueueState(pageEmailIds);

  return (
    <EmailsPageShell
      title={`Condo email threads (${totalCount})`}
      view="threads"
      filters={filters}
      pagination={{
        page: currentPage,
        pageSize: PAGE_SIZE,
        totalCount,
        totalPages,
      }}
      threads={threads.map((thread) => ({
        ...thread,
        processingCostUsd: threadCosts[thread.id] ?? null,
      }))}
      threadAttachmentGroups={threadAttachmentGroups}
      threadEmailIds={threadEmailIds}
      threadProcessingDetails={threadProcessingDetails}
      threadExtractionSummaries={threadExtractionSummaries}
      initialQueueState={initialQueueState}
    />
  );
}

async function loadMessageAttachments(
  emailIds: string[],
): Promise<Record<string, EmailAttachmentSummary[]>> {
  if (emailIds.length === 0) return {};

  const db = getDb();
  const rows = await db
    .select({
      emailId: emailAttachments.emailId,
      id: emailAttachments.id,
      filename: emailAttachments.filename,
      mimeType: emailAttachments.mimeType,
      sizeBytes: emailAttachments.sizeBytes,
      hasValue: emailAttachments.hasValue,
    })
    .from(emailAttachments)
    .where(inArray(emailAttachments.emailId, emailIds));

  return groupAttachmentsByEmailId(rows);
}

async function loadThreadAttachmentGroups(
  threadIds: string[],
): Promise<Record<string, ThreadAttachmentGroup[]>> {
  if (threadIds.length === 0) return {};

  const db = getDb();
  const rows = await db
    .select({
      threadId: emails.threadId,
      emailId: emails.id,
      fromAddress: emails.fromAddress,
      receivedAt: emails.receivedAt,
      id: emailAttachments.id,
      filename: emailAttachments.filename,
      mimeType: emailAttachments.mimeType,
      sizeBytes: emailAttachments.sizeBytes,
      hasValue: emailAttachments.hasValue,
    })
    .from(emailAttachments)
    .innerJoin(emails, eq(emailAttachments.emailId, emails.id))
    .where(inArray(emails.threadId, threadIds))
    .orderBy(asc(emails.receivedAt));

  const grouped: Record<string, ThreadAttachmentGroup[]> = {};

  for (const row of rows) {
    if (!row.threadId) continue;

    const threadGroups = grouped[row.threadId] ?? [];
    let emailGroup = threadGroups.find((group) => group.emailId === row.emailId);

    if (!emailGroup) {
      emailGroup = {
        emailId: row.emailId,
        fromAddress: row.fromAddress,
        receivedAt: row.receivedAt,
        attachments: [],
      };
      threadGroups.push(emailGroup);
      grouped[row.threadId] = threadGroups;
    }

    emailGroup.attachments.push({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      hasValue: row.hasValue,
    });
  }

  return grouped;
}

function groupAttachmentsByEmailId(
  rows: Array<{
    emailId: string;
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number | null;
    hasValue: boolean | null;
  }>,
): Record<string, EmailAttachmentSummary[]> {
  const grouped: Record<string, EmailAttachmentSummary[]> = {};

  for (const row of rows) {
    const attachments = grouped[row.emailId] ?? [];
    attachments.push({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      hasValue: row.hasValue,
    });
    grouped[row.emailId] = attachments;
  }

  return grouped;
}

function EmailsPageShell({
  title,
  view,
  filters,
  pagination,
  messages,
  messageAttachments,
  threads,
  threadAttachmentGroups,
  threadEmailIds,
  threadProcessingDetails,
  messageExtractionSummaries,
  threadExtractionSummaries,
  initialQueueState = {
    processingEmailIds: [],
    pendingEmailIds: [],
    failedEmails: [],
    processedEmails: [],
  },
}: {
  title: string;
  view: "messages" | "threads";
  filters: ReturnType<typeof parseEmailThreadFilters>;
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
  messages?: Array<{
    id: string;
    threadId: string | null;
    fromAddress: string;
    subject: string;
    receivedAt: string;
    processedAt?: string | null;
    processingCostUsd?: number | null;
    processingInputTokens?: number | null;
    processingOutputTokens?: number | null;
    processingDurationMs?: number | null;
  }>;
  messageAttachments?: Record<string, EmailAttachmentSummary[]>;
  threads?: Array<{
    id: string;
    gmailThreadId: string;
    subject: string;
    lastMessageAt: string;
    messageCount: number;
    processedMessageCount: number;
    processingCostUsd?: number | null;
  }>;
  threadAttachmentGroups?: Record<string, ThreadAttachmentGroup[]>;
  threadEmailIds?: Record<string, string[]>;
  threadProcessingDetails?: Record<string, EmailProcessingStats[]>;
  messageExtractionSummaries?: Record<string, InboxExtractionSummary>;
  threadExtractionSummaries?: Record<string, InboxExtractionSummary>;
  initialQueueState?: InboxAnalysisQueueState;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Phase 2 — Email ingestion
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Suspense fallback={null}>
            <EmailViewToggle />
          </Suspense>
          <Suspense fallback={null}>
            <EmailFilterButton />
          </Suspense>
          <Suspense fallback={null}>
            <EmailTimelineChartButton />
          </Suspense>
          <Link
            href="/emails/extractions"
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Extraction audit
          </Link>
          <Link
            href="/emails/settings"
            className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Email settings
          </Link>
        </div>
      </div>

      <EmailThreadList
        view={view}
        messages={messages}
        messageAttachments={messageAttachments}
        threads={threads}
        threadAttachmentGroups={threadAttachmentGroups}
        threadEmailIds={threadEmailIds}
        threadProcessingDetails={threadProcessingDetails}
        messageExtractionSummaries={messageExtractionSummaries}
        threadExtractionSummaries={threadExtractionSummaries}
        initialQueueState={initialQueueState}
        filters={filters}
        pagination={pagination}
      />
    </section>
  );
}
