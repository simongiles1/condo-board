"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmailAttachmentsBadge } from "@/components/EmailAttachmentsBadge";
import {
  ExtractionSidePanel,
  type ExtractionPanelTarget,
} from "@/components/ExtractionSidePanel";
import {
  ProcessorInitials,
  ProcessorInitialsGroup,
} from "@/components/ExtractionPanelContent";
import { ProcessedCostBadge } from "@/components/ProcessedCostBadge";
import { formatDateTime } from "@/lib/format/datetime";
import { formatCostUsd } from "@/lib/gemini/usage";
import type {
  EmailAttachmentSummary,
  ThreadAttachmentGroup,
} from "@/lib/email/attachment-display";
import type {
  EmailProcessingStats,
  InboxAnalysisQueueState,
} from "@/lib/email/processing-stats";
import { mergeLiveProcessingStats } from "@/lib/email/processing-stats";
import {
  type EmailInboxView,
  type EmailThreadFilters,
  emailMessageDetailHref,
  emailThreadDetailHref,
  emailThreadsPageHref,
  hasActiveFilters,
} from "@/lib/email/thread-filters";

const EMPTY_QUEUE_STATE: InboxAnalysisQueueState = {
  processingEmailIds: [],
  pendingEmailIds: [],
  failedEmails: [],
  processedEmails: [],
};

/** Fixed columns: checkbox | subject | status | attachments | date */
const INBOX_ROW_GRID =
  "grid grid-cols-[auto_minmax(0,1fr)_12rem_2.75rem_11rem] items-center gap-x-3";

type BulkProgress = {
  total: number;
  completed: number;
  failed: number;
};

type ThreadQueueStatus = {
  kind: "processing" | "pending" | "failed";
  index: number;
  error?: string;
};

type MessageRow = {
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
  triggeredByEmail?: string | null;
};

type ThreadRow = {
  id: string;
  gmailThreadId: string;
  subject: string;
  lastMessageAt: string;
  messageCount: number;
  processedMessageCount: number;
  processingCostUsd?: number | null;
};

type Pagination = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

function pageHref(page: number, filters?: EmailThreadFilters) {
  if (!filters) {
    return page <= 1 ? "/emails" : `/emails?page=${page}`;
  }
  return emailThreadsPageHref(filters, page);
}

function messageHref(messageId: string, filters?: EmailThreadFilters) {
  return emailMessageDetailHref(messageId, filters);
}

function ProcessingBadge({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <span
      title={`Analyzing email ${current} of ${total}`}
      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium tabular-nums text-amber-900 ring-1 ring-amber-200"
    >
      <span
        className="size-1.5 animate-pulse rounded-full bg-amber-500"
        aria-hidden
      />
      Processing {current} of {total}
    </span>
  );
}

function WaitingBadge({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <span
      title={`Waiting to analyze email ${current} of ${total}`}
      className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium tabular-nums text-sky-900 ring-1 ring-sky-200"
    >
      Waiting {current} of {total}
    </span>
  );
}

function FailedBadge({
  current,
  total,
  error,
}: {
  current: number;
  total: number;
  error?: string;
}) {
  return (
    <span
      title={error ?? `Analysis failed on email ${current} of ${total}`}
      className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium tabular-nums text-red-800 ring-1 ring-red-200"
    >
      Failed {current} of {total}
    </span>
  );
}

function InboxAnalysisStatusBar({
  bulkRunning,
  bulkProgress,
  queueState,
}: {
  bulkRunning: boolean;
  bulkProgress: BulkProgress | null;
  queueState: InboxAnalysisQueueState;
}) {
  const processingCount = queueState.processingEmailIds.length;
  const pendingCount = queueState.pendingEmailIds.length;
  const failedCount = queueState.failedEmails.length;
  const queuedCount = processingCount + pendingCount;

  if (!bulkRunning && queuedCount === 0 && failedCount === 0) {
    return null;
  }

  let headline = "";
  if (bulkRunning && bulkProgress) {
    headline = `Analyzing ${bulkProgress.completed} of ${bulkProgress.total} emails`;
    if (bulkProgress.failed > 0) {
      headline += ` · ${bulkProgress.failed} failed`;
    }
  } else if (processingCount > 0) {
    headline = `Processing ${processingCount} email${processingCount === 1 ? "" : "s"}`;
    if (pendingCount > 0) {
      headline += ` · ${pendingCount} waiting`;
    }
  } else if (pendingCount > 0) {
    headline = `${pendingCount} email${pendingCount === 1 ? "" : "s"} waiting in queue`;
  } else if (failedCount > 0) {
    headline = `${failedCount} email${failedCount === 1 ? "" : "s"} failed — check thread badges`;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      {bulkRunning || processingCount > 0 ? (
        <span
          className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-amber-500"
          aria-hidden
        />
      ) : null}
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{headline}</p>
        <p className="text-xs text-amber-800/90">
          {bulkRunning
            ? "Large threads with many attachments can take several minutes per email. This page updates automatically."
            : "Analysis may still be running in the background if you refreshed. Badges show Processing, Waiting, or Failed per thread."}
        </p>
      </div>
    </div>
  );
}

function buildMessageProcessingEntries(
  message: MessageRow,
  threadProcessingDetails: Record<string, EmailProcessingStats[]> | undefined,
): EmailProcessingStats[] {
  if (message.threadId && threadProcessingDetails?.[message.threadId]) {
    return threadProcessingDetails[message.threadId]!;
  }

  if (!message.processedAt) return [];

  return [
    {
      emailId: message.id,
      subject: message.subject,
      fromAddress: message.fromAddress,
      receivedAt: message.receivedAt,
      processedAt: message.processedAt,
      costUsd: message.processingCostUsd ?? null,
      inputTokens: message.processingInputTokens ?? null,
      outputTokens: message.processingOutputTokens ?? null,
      processingDurationMs: message.processingDurationMs ?? null,
      triggeredByEmail: message.triggeredByEmail ?? null,
    },
  ];
}

function processorEmailsFromEntries(entries: EmailProcessingStats[]): string[] {
  return [
    ...new Set(
      entries
        .filter((entry) => entry.processedAt && entry.triggeredByEmail)
        .map((entry) => entry.triggeredByEmail!),
    ),
  ];
}

function ProcessorBadgeInitials({ emails }: { emails: string[] }) {
  if (emails.length === 0) return null;
  if (emails.length === 1) {
    return <ProcessorInitials email={emails[0]} />;
  }
  return <ProcessorInitialsGroup emails={emails} />;
}

function ProcessedBadge({
  entries,
  processedAt,
  processedCount,
  totalCount,
  processingCostUsd,
  onOpenDetails,
}: {
  entries: EmailProcessingStats[];
  processedAt?: string | null;
  processedCount?: number;
  totalCount?: number;
  processingCostUsd?: number | null;
  onOpenDetails?: () => void;
}) {
  const isProcessed = Boolean(processedAt) || (processedCount ?? 0) > 0;
  if (!isProcessed) return null;

  const costLabel =
    processingCostUsd != null ? formatCostUsd(processingCostUsd) : null;
  const processorEmails = processorEmailsFromEntries(entries);

  return (
    <ProcessedCostBadge entries={entries} onOpenDetails={onOpenDetails}>
      Processed
      {costLabel ? (
        <span className="ml-1 tabular-nums text-teal-900">{costLabel}</span>
      ) : null}
      {processedCount != null &&
      totalCount != null &&
      processedCount < totalCount ? (
        <span className="ml-1 tabular-nums text-teal-700">
          ({processedCount}/{totalCount})
        </span>
      ) : null}
      <ProcessorBadgeInitials emails={processorEmails} />
    </ProcessedCostBadge>
  );
}

function EmailStatusBadge({
  queueStatus,
  processedAt,
  processingCostUsd,
  processingEntries,
  onOpenDetails,
}: {
  queueStatus: ThreadQueueStatus | null;
  processedAt?: string | null;
  processingCostUsd?: number | null;
  processingEntries: EmailProcessingStats[];
  onOpenDetails?: () => void;
}) {
  if (queueStatus?.kind === "processing") {
    return <ProcessingBadge current={1} total={1} />;
  }
  if (queueStatus?.kind === "pending") {
    return <WaitingBadge current={1} total={1} />;
  }
  if (queueStatus?.kind === "failed") {
    return <FailedBadge current={1} total={1} error={queueStatus.error} />;
  }

  return (
    <ProcessedBadge
      entries={processingEntries}
      processedAt={processedAt}
      processingCostUsd={processingCostUsd}
      onOpenDetails={onOpenDetails}
    />
  );
}

function ThreadStatusBadge({
  messageCount,
  processedCount,
  processingCostUsd,
  queueStatus,
  processingEntries,
  onOpenDetails,
}: {
  messageCount: number;
  processedCount: number;
  processingCostUsd?: number | null;
  queueStatus: ThreadQueueStatus | null;
  processingEntries: EmailProcessingStats[];
  onOpenDetails?: () => void;
}) {
  if (queueStatus?.kind === "processing") {
    return (
      <ProcessingBadge current={queueStatus.index} total={messageCount} />
    );
  }
  if (queueStatus?.kind === "pending") {
    return <WaitingBadge current={queueStatus.index} total={messageCount} />;
  }
  if (queueStatus?.kind === "failed") {
    return (
      <FailedBadge
        current={queueStatus.index}
        total={messageCount}
        error={queueStatus.error}
      />
    );
  }

  const costLabel =
    processingCostUsd != null ? formatCostUsd(processingCostUsd) : null;
  const isProcessed = processedCount > 0;

  if (isProcessed) {
    const countLabel =
      processedCount < messageCount
        ? `${processedCount}/${messageCount}`
        : String(messageCount);
    const processorEmails = processorEmailsFromEntries(processingEntries);

    return (
      <ProcessedCostBadge
        entries={processingEntries}
        onOpenDetails={onOpenDetails}
        badgeClassName="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium tabular-nums text-teal-800 ring-1 ring-teal-200"
      >
        <span className="text-teal-900">{countLabel}</span>
        <span className="text-teal-700">·</span>
        <span>Processed</span>
        {costLabel ? <span className="text-teal-900">{costLabel}</span> : null}
        <ProcessorBadgeInitials emails={processorEmails} />
      </ProcessedCostBadge>
    );
  }

  return (
    <span
      title={`${messageCount} email${messageCount === 1 ? "" : "s"} in thread`}
      className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-slate-700 ring-1 ring-slate-200"
    >
      {messageCount}
    </span>
  );
}

function getLiveMessageProcessedSnapshot(
  messageId: string,
  queueState: InboxAnalysisQueueState,
  processedAt?: string | null,
  processingCostUsd?: number | null,
  processingInputTokens?: number | null,
  processingOutputTokens?: number | null,
  processingDurationMs?: number | null,
  triggeredByEmail?: string | null,
): {
  processedAt?: string | null;
  processingCostUsd?: number | null;
  processingInputTokens?: number | null;
  processingOutputTokens?: number | null;
  processingDurationMs?: number | null;
  triggeredByEmail?: string | null;
} {
  const live = queueState.processedEmails.find(
    (entry) => entry.emailId === messageId,
  );
  if (!live) {
    return {
      processedAt,
      processingCostUsd,
      processingInputTokens,
      processingOutputTokens,
      processingDurationMs,
      triggeredByEmail,
    };
  }
  return {
    processedAt: live.processedAt,
    processingCostUsd: live.processingCostUsd ?? processingCostUsd,
    processingInputTokens: live.inputTokens ?? processingInputTokens,
    processingOutputTokens: live.outputTokens ?? processingOutputTokens,
    processingDurationMs: live.processingDurationMs ?? processingDurationMs,
    triggeredByEmail: live.triggeredByEmail ?? triggeredByEmail,
  };
}

function getLiveThreadProcessedStats(
  threadId: string,
  threadEmailIds: Record<string, string[]> | undefined,
  queueState: InboxAnalysisQueueState,
  processedCount: number,
  processingCostUsd?: number | null,
): { processedCount: number; processingCostUsd?: number | null } {
  const emailIds = threadEmailIds?.[threadId] ?? [];
  const processedByEmail = new Map(
    queueState.processedEmails.map((entry) => [entry.emailId, entry]),
  );

  let liveCount = 0;
  let liveCost = 0;
  let hasLiveCost = false;

  for (const emailId of emailIds) {
    const live = processedByEmail.get(emailId);
    if (!live) continue;
    liveCount += 1;
    if (live.processingCostUsd != null) {
      liveCost += live.processingCostUsd;
      hasLiveCost = true;
    }
  }

  const effectiveProcessedCount = Math.max(processedCount, liveCount);
  if (liveCount === 0) {
    return { processedCount: effectiveProcessedCount, processingCostUsd };
  }

  return {
    processedCount: effectiveProcessedCount,
    processingCostUsd: hasLiveCost ? liveCost : processingCostUsd,
  };
}

function getMessageQueueStatus(
  messageId: string,
  queueState: InboxAnalysisQueueState,
): ThreadQueueStatus | null {
  if (queueState.processingEmailIds.includes(messageId)) {
    return { kind: "processing", index: 1 };
  }
  if (queueState.pendingEmailIds.includes(messageId)) {
    return { kind: "pending", index: 1 };
  }
  const failed = queueState.failedEmails.find((entry) => entry.emailId === messageId);
  if (failed) {
    return { kind: "failed", index: 1, error: failed.error };
  }
  return null;
}

function getThreadQueueStatus(
  threadId: string,
  threadEmailIds: Record<string, string[]> | undefined,
  queueState: InboxAnalysisQueueState,
): ThreadQueueStatus | null {
  const ordered = threadEmailIds?.[threadId] ?? [];
  const processingSet = new Set(queueState.processingEmailIds);
  const pendingSet = new Set(queueState.pendingEmailIds);
  const failedByEmail = new Map(
    queueState.failedEmails.map((entry) => [entry.emailId, entry.error]),
  );

  for (let index = 0; index < ordered.length; index += 1) {
    const emailId = ordered[index];
    if (processingSet.has(emailId)) {
      return { kind: "processing", index: index + 1 };
    }
    if (pendingSet.has(emailId)) {
      return { kind: "pending", index: index + 1 };
    }
  }

  for (let index = 0; index < ordered.length; index += 1) {
    const emailId = ordered[index];
    const error = failedByEmail.get(emailId);
    if (error) {
      return { kind: "failed", index: index + 1, error };
    }
  }

  return null;
}

async function fetchInboxQueueState(
  emailIds: string[],
): Promise<InboxAnalysisQueueState> {
  if (emailIds.length === 0) return EMPTY_QUEUE_STATE;

  const params = new URLSearchParams({ emailIds: emailIds.join(",") });
  const response = await fetch(`/api/analysis/inbox-processing?${params.toString()}`);
  if (!response.ok) return EMPTY_QUEUE_STATE;
  return (await response.json()) as InboxAnalysisQueueState;
}

export function EmailThreadList({
  view,
  messages,
  messageAttachments,
  threads,
  threadAttachmentGroups,
  threadEmailIds,
  threadProcessingDetails,
  initialQueueState = EMPTY_QUEUE_STATE,
  pagination,
  filters,
  canManageEmailSettings = false,
}: {
  view: EmailInboxView;
  messages?: MessageRow[];
  messageAttachments?: Record<string, EmailAttachmentSummary[]>;
  threads?: ThreadRow[];
  threadAttachmentGroups?: Record<string, ThreadAttachmentGroup[]>;
  threadEmailIds?: Record<string, string[]>;
  threadProcessingDetails?: Record<string, EmailProcessingStats[]>;
  initialQueueState?: InboxAnalysisQueueState;
  pagination?: Pagination;
  filters?: EmailThreadFilters;
  canManageEmailSettings?: boolean;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [queueState, setQueueState] =
    useState<InboxAnalysisQueueState>(initialQueueState);
  const [extractionPanel, setExtractionPanel] = useState<{
    target: ExtractionPanelTarget;
    processingEntries: EmailProcessingStats[];
  } | null>(null);

  const allPageEmailIds = useMemo(() => {
    if (view === "messages") {
      return messages?.map((message) => message.id) ?? [];
    }
    return Object.values(threadEmailIds ?? {}).flat();
  }, [view, messages, threadEmailIds]);

  const queuedCount =
    queueState.processingEmailIds.length + queueState.pendingEmailIds.length;
  const hasQueueActivity = bulkRunning || queuedCount > 0;

  useEffect(() => {
    setQueueState(initialQueueState);
  }, [initialQueueState]);

  useEffect(() => {
    if (!hasQueueActivity || allPageEmailIds.length === 0) {
      return;
    }

    let cancelled = false;

    async function pollProcessingState() {
      const next = await fetchInboxQueueState(allPageEmailIds);
      if (cancelled) return;

      setQueueState(next);

      const stillActive =
        bulkRunning ||
        next.processingEmailIds.length > 0 ||
        next.pendingEmailIds.length > 0;

      if (!stillActive) {
        router.refresh();
      }
    }

    void pollProcessingState();
    const interval = window.setInterval(() => void pollProcessingState(), 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hasQueueActivity, allPageEmailIds, bulkRunning, router]);

  const rowIds = useMemo(
    () =>
      view === "messages"
        ? (messages?.map((message) => message.id) ?? [])
        : (threads?.map((thread) => thread.id) ?? []),
    [view, messages, threads],
  );

  const selectedCount = selectedIds.size;
  const allSelected = rowIds.length > 0 && selectedCount === rowIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(rowIds) : new Set());
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkError(null);
  }

  function resolveEmailIdsForSelection(): string[] {
    if (view === "messages") {
      return [...selectedIds];
    }

    const emailIds: string[] = [];
    for (const threadId of selectedIds) {
      const ids = threadEmailIds?.[threadId] ?? [];
      emailIds.push(...ids);
    }
    return emailIds;
  }

  async function analyzeSelected() {
    const emailIds = resolveEmailIdsForSelection();
    if (emailIds.length === 0) {
      setBulkError("No emails to analyze in the current selection.");
      return;
    }

    const confirmed = window.confirm(
      `Analyze ${emailIds.length} email${emailIds.length === 1 ? "" : "s"}? This uses the Gemini API and adds cost.`,
    );
    if (!confirmed) return;

    setBulkRunning(true);
    setBulkError(null);
    setBulkProgress({ total: emailIds.length, completed: 0, failed: 0 });

    try {
      const enqueueResponse = await fetch("/api/analysis/enqueue-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds }),
      });
      const enqueueData = (await enqueueResponse.json()) as { error?: string };
      if (!enqueueResponse.ok) {
        throw new Error(enqueueData.error ?? "Could not queue emails for analysis.");
      }

      setQueueState(await fetchInboxQueueState(allPageEmailIds));

      let failed = 0;
      for (let index = 0; index < emailIds.length; index += 1) {
        const emailId = emailIds[index];
        setBulkProgress({ total: emailIds.length, completed: index, failed });

        try {
          const response = await fetch("/api/analysis/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emailId }),
          });
          const data = (await response.json()) as { error?: string };
          if (!response.ok) {
            throw new Error(data.error ?? "Analysis failed.");
          }
        } catch {
          failed += 1;
        }

        setBulkProgress({
          total: emailIds.length,
          completed: index + 1,
          failed,
        });
        setQueueState(await fetchInboxQueueState(allPageEmailIds));
      }

      clearSelection();
      router.refresh();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Batch analysis failed.");
    } finally {
      setBulkRunning(false);
      setBulkProgress(null);
      setQueueState(await fetchInboxQueueState(allPageEmailIds));
    }
  }

  const isEmpty =
    view === "messages" ? (messages?.length ?? 0) === 0 : (threads?.length ?? 0) === 0;

  if (isEmpty) {
    const filtered = filters && hasActiveFilters(filters);

    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        {filtered ? (
          <>
            No emails match the current filters.{" "}
            <Link
              href={
                filters
                  ? emailThreadsPageHref({
                      ...filters,
                      page: 1,
                      fromAddresses: undefined,
                      startedChainOnly: undefined,
                      processedOnly: undefined,
                      subject: undefined,
                      receivedBefore: undefined,
                      receivedAfter: undefined,
                    })
                  : "/emails"
              }
              className="text-teal-700 hover:underline"
            >
              Clear filters
            </Link>
          </>
        ) : canManageEmailSettings ? (
          <>
            No emails ingested yet. Connect Gmail in{" "}
            <Link href="/settings" className="text-teal-700 hover:underline">
              Settings
            </Link>{" "}
            and run a sync or backfill.
          </>
        ) : (
          <>No emails ingested yet. Ask a super admin to connect Gmail and run a sync.</>
        )}
      </div>
    );
  }

  const showPagination =
    pagination && pagination.totalPages > 1 && pagination.totalCount > 0;

  const selectedEmailCount =
    view === "messages" ? selectedCount : resolveEmailIdsForSelection().length;

  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <InboxAnalysisStatusBar
        bulkRunning={bulkRunning}
        bulkProgress={bulkProgress}
        queueState={queueState}
      />

      {bulkError ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{bulkError}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-slate-100 bg-slate-50 px-4">
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              checked={allSelected}
              ref={(element) => {
                if (element) {
                  element.indeterminate = someSelected;
                }
              }}
              onChange={(event) => toggleAll(event.target.checked)}
              aria-label="Select all on this page"
            />
            <span className="sr-only">Select all on this page</span>
          </label>

          {selectedCount > 0 ? (
            <>
              <span className="min-w-0 truncate text-sm text-slate-600">
                {selectedCount} {view === "threads" ? "thread" : "email"}
                {selectedCount === 1 ? "" : "s"} selected
                {view === "threads" && selectedEmailCount !== selectedCount
                  ? ` (${selectedEmailCount} message${selectedEmailCount === 1 ? "" : "s"})`
                  : null}
              </span>
              <button
                type="button"
                disabled={bulkRunning}
                onClick={() => void analyzeSelected()}
                className="shrink-0 rounded bg-teal-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {bulkRunning ? "Analyzing…" : "Analyze selected"}
              </button>
              <button
                type="button"
                disabled={bulkRunning}
                onClick={clearSelection}
                className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-50"
              >
                Clear
              </button>
            </>
          ) : (
            <span className="text-sm text-slate-500">Select rows to analyze in bulk</span>
          )}
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {view === "messages"
            ? messages?.map((message) => {
                const liveProcessed = getLiveMessageProcessedSnapshot(
                  message.id,
                  queueState,
                  message.processedAt,
                  message.processingCostUsd,
                  message.processingInputTokens,
                  message.processingOutputTokens,
                  message.processingDurationMs,
                  message.triggeredByEmail,
                );
                const baseEntries = buildMessageProcessingEntries(
                  {
                    ...message,
                    ...liveProcessed,
                  },
                  threadProcessingDetails,
                );
                const processingEntries = mergeLiveProcessingStats(
                  baseEntries,
                  queueState.processedEmails,
                );

                return (
                <li key={message.id} className={`${INBOX_ROW_GRID} hover:bg-slate-50`}>
                  <label className="flex cursor-pointer pl-4">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                      checked={selectedIds.has(message.id)}
                      onChange={(event) => toggleRow(message.id, event.target.checked)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Select ${message.subject}`}
                    />
                  </label>
                  <Link
                    href={messageHref(message.id, filters)}
                    className="block min-w-0 py-4"
                  >
                    <p className="font-medium text-slate-900">{message.subject}</p>
                    <p className="mt-1 truncate text-sm text-slate-600">
                      {message.fromAddress}
                    </p>
                  </Link>
                  <div className="flex items-center py-4">
                    <EmailStatusBadge
                      queueStatus={getMessageQueueStatus(message.id, queueState)}
                      processedAt={liveProcessed.processedAt}
                      processingCostUsd={liveProcessed.processingCostUsd}
                      processingEntries={processingEntries}
                      onOpenDetails={
                        liveProcessed.processedAt
                          ? () =>
                              setExtractionPanel({
                                target: {
                                  kind: "email",
                                  emailId: message.id,
                                  subject: message.subject,
                                  fromAddress: message.fromAddress,
                                },
                                processingEntries,
                              })
                          : undefined
                      }
                    />
                  </div>
                  <div className="flex items-center justify-center py-4">
                    <EmailAttachmentsBadge
                      attachments={messageAttachments?.[message.id] ?? []}
                    />
                  </div>
                  <time
                    dateTime={message.receivedAt}
                    className="whitespace-nowrap py-4 pr-4 text-right text-sm text-slate-600"
                  >
                    {formatDateTime(message.receivedAt)}
                  </time>
                </li>
                );
              })
            : threads?.map((thread) => {
                const groups = threadAttachmentGroups?.[thread.id] ?? [];
                const liveStats = getLiveThreadProcessedStats(
                  thread.id,
                  threadEmailIds,
                  queueState,
                  thread.processedMessageCount,
                  thread.processingCostUsd,
                );
                const processingEntries = mergeLiveProcessingStats(
                  threadProcessingDetails?.[thread.id] ?? [],
                  queueState.processedEmails,
                );

                return (
                  <li key={thread.id} className={`${INBOX_ROW_GRID} hover:bg-slate-50`}>
                    <label className="flex cursor-pointer pl-4">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                        checked={selectedIds.has(thread.id)}
                        onChange={(event) => toggleRow(thread.id, event.target.checked)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Select thread ${thread.subject}`}
                      />
                    </label>
                    <Link
                      href={emailThreadDetailHref(thread.id)}
                      className="block min-w-0 py-4"
                    >
                      <p className="font-medium text-slate-900">{thread.subject}</p>
                      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                        Thread
                      </p>
                    </Link>
                    <div className="flex items-center py-4">
                      <ThreadStatusBadge
                        messageCount={thread.messageCount}
                        processedCount={liveStats.processedCount}
                        processingCostUsd={liveStats.processingCostUsd}
                        queueStatus={getThreadQueueStatus(
                          thread.id,
                          threadEmailIds,
                          queueState,
                        )}
                        processingEntries={processingEntries}
                        onOpenDetails={
                          liveStats.processedCount > 0
                            ? () =>
                                setExtractionPanel({
                                  target: {
                                    kind: "thread",
                                    threadId: thread.id,
                                    subject: thread.subject,
                                  },
                                  processingEntries,
                                })
                            : undefined
                        }
                      />
                    </div>
                    <div className="flex items-center justify-center py-4">
                      <EmailAttachmentsBadge groups={groups} />
                    </div>
                    <time
                      dateTime={thread.lastMessageAt}
                      className="whitespace-nowrap py-4 pr-4 text-right text-sm text-slate-600"
                    >
                      {formatDateTime(thread.lastMessageAt)}
                    </time>
                  </li>
                );
              })}
        </ul>
      </div>

      {showPagination ? (
        <nav
          aria-label="Email inbox pagination"
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
        >
          <p>
            Showing{" "}
            {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.totalCount)}{" "}
            of {pagination.totalCount}
          </p>
          <div className="flex items-center gap-2">
            {pagination.page > 1 ? (
              <Link
                href={pageHref(pagination.page - 1, filters)}
                className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50"
              >
                Previous
              </Link>
            ) : (
              <span className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-400">
                Previous
              </span>
            )}
            <span className="px-1 text-slate-600">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            {pagination.page < pagination.totalPages ? (
              <Link
                href={pageHref(pagination.page + 1, filters)}
                className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50"
              >
                Next
              </Link>
            ) : (
              <span className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-400">
                Next
              </span>
            )}
          </div>
        </nav>
      ) : null}
    </div>

    <ExtractionSidePanel
      target={extractionPanel?.target ?? null}
      processingEntries={extractionPanel?.processingEntries ?? []}
      onClose={() => setExtractionPanel(null)}
    />
    </>
  );
}
