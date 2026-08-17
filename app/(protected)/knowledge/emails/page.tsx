export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { count, desc, eq, inArray, asc, sql } from "drizzle-orm";

import { EmailFilterButton } from "@/components/EmailFilterButton";
import { EmailSubjectSearch } from "@/components/EmailSubjectSearch";
import { EmailTimelineChartButton } from "@/components/EmailTimelineDialog";
import { EmailAttachmentAnalyticsButton } from "@/components/EmailAttachmentAnalyticsDialog";
import { EmailExtractionCalendarButton } from "@/components/EmailExtractionCalendarDialog";
import { EmailThreadList } from "@/components/EmailThreadList";
import { EmailViewToggle } from "@/components/EmailViewToggle";
import {
  InboxEntityCardsButton,
  type InboxEntityCardThread,
} from "@/components/InboxEntityCardsButton";
import { BulkExtractButton } from "@/components/BulkExtractButton";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { emailAttachments, emailThreads, emails } from "@/lib/db/schema";
import type { EmailAttachmentSummary, ThreadAttachmentGroup } from "@/lib/email/attachment-display";
import {
  loadInboxAnalysisQueueState,
  loadMessageProcessingStats,
  loadThreadEmailIds,
  loadThreadProcessingCosts,
  loadThreadProcessingDetails,
  type EmailProcessingStats,
  type InboxAnalysisQueueState,
} from "@/lib/email/inbox-processing";
import { loadContactExtractSummariesForGroups } from "@/lib/email-analysis/contact-highlight-summary";
import type { ContactExtractSummary } from "@/lib/email-analysis/contact-highlight-run-display";
import { loadEventExtractSummariesForGroups } from "@/lib/email-analysis/event-highlight-summary";
import type { EventExtractSummary } from "@/lib/email-analysis/event-highlight-run-display";
import { loadOrgExtractSummariesForGroups } from "@/lib/email-analysis/org-highlight-summary";
import type { OrgExtractSummary } from "@/lib/email-analysis/org-highlight-run-display";
import { loadTodoExtractSummariesForGroups } from "@/lib/email-analysis/todo-highlight-summary";
import type { TodoExtractSummary } from "@/lib/email-analysis/todo-highlight-run-display";
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
  const view = filters.view;
  const filterWhere = buildThreadFilterWhere(filters, view);
  const sessionUser = await getSessionUser();
  const canManageEmailSettings = sessionUser?.role === "super_admin";

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
      queueState,
      contactExtractSummaries,
      orgExtractSummaries,
      eventExtractSummaries,
      todoExtractSummaries,
    ] = await Promise.all([
      loadMessageAttachments(messageIds),
      loadMessageProcessingStats(messageIds),
      loadThreadProcessingDetails(threadIds),
      loadInboxAnalysisQueueState(messageIds),
      loadContactExtractSummariesForGroups(
        Object.fromEntries(messageIds.map((id) => [id, [id]])),
      ),
      loadOrgExtractSummariesForGroups(
        Object.fromEntries(messageIds.map((id) => [id, [id]])),
      ),
      loadEventExtractSummariesForGroups(
        Object.fromEntries(messageIds.map((id) => [id, [id]])),
      ),
      loadTodoExtractSummariesForGroups(
        Object.fromEntries(messageIds.map((id) => [id, [id]])),
      ),
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
            triggeredByEmail: stats?.triggeredByEmail ?? null,
          };
        })}
        messageAttachments={messageAttachments}
        threadProcessingDetails={threadProcessingDetails}
        contactExtractSummaries={contactExtractSummaries}
        orgExtractSummaries={orgExtractSummaries}
        eventExtractSummaries={eventExtractSummaries}
        todoExtractSummaries={todoExtractSummaries}
        initialQueueState={queueState}
        canManageEmailSettings={canManageEmailSettings}
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
  ] = await Promise.all([
    loadThreadAttachmentGroups(threadIds),
    loadThreadProcessingCosts(threadIds),
    loadThreadEmailIds(threadIds),
    loadThreadProcessingDetails(threadIds),
  ]);

  const pageEmailIds = Object.values(threadEmailIds).flat();
  const [
    initialQueueState,
    contactExtractSummaries,
    orgExtractSummaries,
    eventExtractSummaries,
    todoExtractSummaries,
  ] = await Promise.all([
    loadInboxAnalysisQueueState(pageEmailIds),
    loadContactExtractSummariesForGroups(threadEmailIds),
    loadOrgExtractSummariesForGroups(threadEmailIds),
    loadEventExtractSummariesForGroups(threadEmailIds),
    loadTodoExtractSummariesForGroups(threadEmailIds),
  ]);

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
      contactExtractSummaries={contactExtractSummaries}
      orgExtractSummaries={orgExtractSummaries}
      eventExtractSummaries={eventExtractSummaries}
      todoExtractSummaries={todoExtractSummaries}
      initialQueueState={initialQueueState}
      canManageEmailSettings={canManageEmailSettings}
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

function buildEntityCardThreadsFromMessages(
  messages: Array<{
    id: string;
    threadId: string | null;
    subject: string;
  }>,
): InboxEntityCardThread[] {
  const byThread = new Map<string, InboxEntityCardThread>();
  for (const message of messages) {
    if (!message.threadId) continue;
    const existing = byThread.get(message.threadId);
    if (existing) {
      // Incomplete set on Individual view — loader resolves full thread emails.
      continue;
    }
    byThread.set(message.threadId, {
      id: message.threadId,
      label: message.subject,
      emailIds: [],
    });
  }
  return [...byThread.values()];
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
  contactExtractSummaries,
  orgExtractSummaries,
  eventExtractSummaries,
  todoExtractSummaries,
  initialQueueState = {
    processingEmailIds: [],
    pendingEmailIds: [],
    failedEmails: [],
    processedEmails: [],
  },
  canManageEmailSettings = false,
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
  contactExtractSummaries?: Record<string, ContactExtractSummary>;
  orgExtractSummaries?: Record<string, OrgExtractSummary>;
  eventExtractSummaries?: Record<string, EventExtractSummary>;
  todoExtractSummaries?: Record<string, TodoExtractSummary>;
  initialQueueState?: InboxAnalysisQueueState;
  canManageEmailSettings?: boolean;
}) {
  const entityCardThreads: InboxEntityCardThread[] =
    view === "threads" && threads
      ? threads.map((thread) => ({
          id: thread.id,
          label: thread.subject,
          emailIds: threadEmailIds?.[thread.id] ?? [],
        }))
      : buildEntityCardThreadsFromMessages(messages ?? []);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Phase 2 — Email ingestion
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <InboxEntityCardsButton
              threads={entityCardThreads}
              contactExtractSummaries={contactExtractSummaries}
              orgExtractSummaries={orgExtractSummaries}
            />
            <BulkExtractButton />
            <Suspense fallback={null}>
              <EmailViewToggle />
            </Suspense>
            <Suspense fallback={null}>
              <EmailFilterButton />
            </Suspense>
            <Suspense fallback={null}>
              <EmailTimelineChartButton />
            </Suspense>
            <Suspense fallback={null}>
              <EmailAttachmentAnalyticsButton />
            </Suspense>
            <Suspense fallback={null}>
              <EmailExtractionCalendarButton />
            </Suspense>
          </div>
        </div>
        {view === "threads" ? (
          <Suspense fallback={null}>
            <EmailSubjectSearch />
          </Suspense>
        ) : null}
      </div>

      <EmailThreadList
        view={view}
        messages={messages}
        messageAttachments={messageAttachments}
        threads={threads}
        threadAttachmentGroups={threadAttachmentGroups}
        threadEmailIds={threadEmailIds}
        threadProcessingDetails={threadProcessingDetails}
        contactExtractSummaries={contactExtractSummaries}
        orgExtractSummaries={orgExtractSummaries}
        eventExtractSummaries={eventExtractSummaries}
        todoExtractSummaries={todoExtractSummaries}
        initialQueueState={initialQueueState}
        filters={filters}
        pagination={pagination}
        canManageEmailSettings={canManageEmailSettings}
      />
    </section>
  );
}
