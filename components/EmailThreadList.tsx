"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { DateTimeDisplay } from "@/components/DateTimeDisplay";
import { ContactExtractCostBadge } from "@/components/ContactExtractCostBadge";
import { HarvestRunNotice } from "@/components/HarvestRunNotice";
import { EmailAttachmentsBadge } from "@/components/EmailAttachmentsBadge";
import {
  ExtractionSidePanel,
  type ExtractionPanelTarget,
} from "@/components/ExtractionSidePanel";
import {
  ProcessorInitials,
  ProcessorInitialsGroup,
} from "@/components/ExtractionPanelContent";
import { EventExtractCostBadge } from "@/components/EventExtractCostBadge";
import { TodoExtractCostBadge } from "@/components/TodoExtractCostBadge";
import { OrgExtractCostBadge } from "@/components/OrgExtractCostBadge";
import { ProjectExtractCostBadge } from "@/components/ProjectExtractCostBadge";
import { ProcessedCostBadge } from "@/components/ProcessedCostBadge";
import { HoverPopoverRowProvider } from "@/lib/ui/use-hover-popover";
import {
  ThreadHarvestSidePanel,
  type ThreadHarvestPanelTarget,
} from "@/components/ThreadHarvestSidePanel";
import {
  CONTACT_HIGHLIGHT_MODELS,
  DEFAULT_CONTACT_HIGHLIGHT_MODEL,
  formatContactHighlightModelOptionLabel,
  getContactHighlightModelMeta,
  type ContactHighlightModelId,
  type ContactHighlightPass,
} from "@/lib/email-analysis/contact-highlight-models";
import {
  contactExtractSummaryFromApiRuns,
  type ContactExtractSummary,
} from "@/lib/email-analysis/contact-highlight-run-display";
import {
  buildExtractRunNotice,
  warningsFromExtractPostResponse,
  type ExtractRunNotice,
  type ExtractRunWarning,
} from "@/lib/email-analysis/extract-run-warnings";
import {
  eventExtractSummaryFromApiRuns,
  type EventExtractSummary,
} from "@/lib/email-analysis/event-highlight-run-display";
import {
  TODO_HIGHLIGHT_MODELS,
  formatTodoHighlightModelOptionLabel,
  getTodoHighlightModelMeta,
  type TodoHighlightModelId,
} from "@/lib/email-analysis/todo-highlight-models";
import {
  todoExtractSummaryFromApiRuns,
  type TodoExtractSummary,
} from "@/lib/email-analysis/todo-highlight-run-display";
import {
  EVENT_HIGHLIGHT_MODELS,
  formatEventHighlightModelOptionLabel,
  getEventHighlightModelMeta,
  type EventHighlightModelId,
} from "@/lib/email-analysis/event-highlight-models";
import {
  ORG_HIGHLIGHT_MODELS,
  formatOrgHighlightModelOptionLabel,
  getOrgHighlightModelMeta,
  type OrgHighlightModelId,
  type OrgHighlightPass,
} from "@/lib/email-analysis/org-highlight-models";
import {
  orgExtractSummaryFromApiRuns,
  type OrgExtractSummary,
} from "@/lib/email-analysis/org-highlight-run-display";
import {
  PROJECT_HIGHLIGHT_MODELS,
  formatProjectHighlightModelOptionLabel,
  getProjectHighlightModelMeta,
  type ProjectHighlightModelId,
} from "@/lib/email-analysis/project-highlight-models";
import {
  projectExtractSummaryFromApiRuns,
  type ProjectExtractSummary,
} from "@/lib/email-analysis/project-highlight-run-display";
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
  "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_2.25rem_minmax(3.5rem,auto)] items-center gap-x-2 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,12rem)_2.75rem_minmax(0,11rem)] md:gap-x-3";

function inboxRowClassName(highlighted: boolean) {
  return [
    INBOX_ROW_GRID,
    highlighted
      ? "bg-teal-50/70 ring-1 ring-inset ring-teal-200/80 hover:bg-teal-50"
      : "hover:bg-slate-50",
  ].join(" ");
}

type BulkProgress = {
  total: number;
  completed: number;
  failed: number;
};

type ExtractKind = "contacts" | "organizations" | "projects" | "events" | "todos";

function isSinglePassKind(kind: ExtractKind): boolean {
  return kind === "events" || kind === "todos";
}

type ExtractProgress = {
  pass: ContactHighlightPass | OrgHighlightPass;
  current: number;
  total: number;
  status: "preparing" | "running" | "failed";
  error?: string;
};

type ExtractTarget = {
  /** Row key for progress badges (thread id or message id). */
  progressKey: string;
  /** All row keys that should show this target’s progress (message groups). */
  badgeKeys: string[];
  prepareQuery: string;
  /** Email ids used to reload persisted summary after a run. */
  emailIds: string[];
};

type PreparedExtractItem = {
  emailId: string;
  highlightedText: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  bodyText: string;
  label: string;
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
    return page <= 1 ? "/knowledge/emails" : `/knowledge/emails?page=${page}`;
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
      Processing{" "}
      <span className="hidden md:inline">
        {current} of {total}
      </span>
      <span className="md:hidden">
        {current}/{total}
      </span>
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
      Waiting{" "}
      <span className="hidden md:inline">
        {current} of {total}
      </span>
      <span className="md:hidden">
        {current}/{total}
      </span>
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
      Failed{" "}
      <span className="hidden md:inline">
        {current} of {total}
      </span>
      <span className="md:hidden">
        {current}/{total}
      </span>
    </span>
  );
}

function ExtractProgressBadge({
  progress,
  kind,
}: {
  progress: ExtractProgress;
  kind: ExtractKind;
}) {
  const isOrg = kind === "organizations";
  const isProject = kind === "projects";
  const isEvents = kind === "events";
  const isTodos = kind === "todos";
  const tone = isOrg
    ? {
        wrap: "bg-fuchsia-50 text-fuchsia-900 ring-fuchsia-200",
        pulse: "bg-fuchsia-500",
        fail: "bg-red-50 text-red-800 ring-red-200",
      }
    : isProject
      ? {
          wrap: "bg-orange-50 text-orange-900 ring-orange-200",
          pulse: "bg-orange-500",
          fail: "bg-red-50 text-red-800 ring-red-200",
        }
    : isEvents
      ? {
          wrap: "bg-sky-50 text-sky-900 ring-sky-200",
          pulse: "bg-sky-500",
          fail: "bg-red-50 text-red-800 ring-red-200",
        }
      : isTodos
        ? {
            wrap: "bg-lime-50 text-lime-900 ring-lime-200",
            pulse: "bg-lime-500",
            fail: "bg-red-50 text-red-800 ring-red-200",
          }
        : {
            wrap: "bg-violet-50 text-violet-900 ring-violet-200",
            pulse: "bg-violet-500",
            fail: "bg-red-50 text-red-800 ring-red-200",
          };
  const noun = isOrg
    ? "organization"
    : isProject
      ? "project"
      : isEvents
        ? "event"
        : isTodos
          ? "to-do"
          : "contact";

  if (progress.status === "preparing") {
    return (
      <span
        title={`Preparing emails for ${noun} extraction`}
        className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ring-1 ${tone.wrap}`}
      >
        <span
          className={`size-1.5 shrink-0 animate-pulse rounded-full ${tone.pulse}`}
          aria-hidden
        />
        Preparing…
      </span>
    );
  }

  const phaseLabel = isEvents
    ? "Extracting events"
    : isTodos
      ? "Extracting to-dos"
      : progress.pass === 4
      ? "Phase 4 · merging"
      : progress.pass === 3
        ? "Phase 3 · fingerprints"
        : progress.pass === 2
          ? "Phase 2 · second pass"
          : "Phase 1 · extracting";
  const countLabel =
    progress.pass === 4 || progress.total <= 0
      ? null
      : `${progress.current} of ${progress.total}`;
  const title =
    progress.status === "failed"
      ? progress.error ??
        `${isOrg ? "Organization" : isProject ? "Project" : isEvents ? "Event" : isTodos ? "To-do" : "Contact"} extraction failed on phase ${progress.pass}`
      : countLabel
        ? `${phaseLabel}: ${countLabel}`
        : phaseLabel;

  return (
    <span
      title={title}
      className={[
        "inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ring-1",
        progress.status === "failed" ? tone.fail : tone.wrap,
      ].join(" ")}
    >
      {progress.status === "running" ? (
        <span
          className={`size-1.5 shrink-0 animate-pulse rounded-full ${tone.pulse}`}
          aria-hidden
        />
      ) : null}
      <span className="truncate">
        <span className="hidden md:inline">{phaseLabel}</span>
        <span className="md:hidden">P{progress.pass}</span>
        {countLabel ? (
          <>
            {" "}
            <span className="hidden md:inline">{countLabel}</span>
            <span className="md:hidden">
              {progress.current}/{progress.total}
            </span>
          </>
        ) : null}
      </span>
    </span>
  );
}

function InboxAnalysisStatusBar({
  bulkRunning,
  bulkProgress,
  bulkExtractKind,
  queueState,
}: {
  bulkRunning: boolean;
  bulkProgress: BulkProgress | null;
  bulkExtractKind: ExtractKind | null;
  queueState: InboxAnalysisQueueState;
}) {
  const processingCount = queueState.processingEmailIds.length;
  const pendingCount = queueState.pendingEmailIds.length;
  const failedCount = queueState.failedEmails.length;
  const queuedCount = processingCount + pendingCount;
  const bulkExtractRunning = bulkExtractKind != null;

  if (
    !bulkRunning &&
    !bulkExtractRunning &&
    queuedCount === 0 &&
    failedCount === 0
  ) {
    return null;
  }

  let headline = "";
  let detail =
    "Analysis may still be running in the background if you refreshed. Badges show Processing, Waiting, or Failed per thread.";
  let barClass =
    "flex shrink-0 items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950";
  let pulseClass = "mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-amber-500";
  let detailClass = "text-xs text-amber-800/90";

  if (bulkExtractKind === "organizations") {
    headline = "Running organization extraction on selected threads";
    detail =
      "All 4 passes run in series per thread. Row badges show the current phase and email index.";
    barClass =
      "flex shrink-0 items-start gap-3 rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-4 py-3 text-sm text-fuchsia-950";
    pulseClass = "mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-fuchsia-500";
    detailClass = "text-xs text-fuchsia-800/90";
  } else if (bulkExtractKind === "projects") {
    headline = "Running project extraction on selected threads";
    detail =
      "All 4 passes run in series per thread. Row badges show the current phase and email index.";
    barClass =
      "flex shrink-0 items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-950";
    pulseClass = "mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-orange-500";
    detailClass = "text-xs text-orange-800/90";
  } else if (bulkExtractKind === "events") {
    headline = "Running event harvest on selected threads";
    detail =
      "One calendar-focused pass per email, then calendar persist. Row badges show the current email index.";
    barClass =
      "flex shrink-0 items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950";
    pulseClass = "mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-sky-500";
    detailClass = "text-xs text-sky-800/90";
  } else if (bulkExtractKind === "contacts") {
    headline = "Running contact extraction on selected threads";
    detail =
      "All 4 passes run in series per thread. Row badges show the current phase and email index.";
    barClass =
      "flex shrink-0 items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950";
    pulseClass = "mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-violet-500";
    detailClass = "text-xs text-violet-800/90";
  } else if (bulkRunning && bulkProgress) {
    headline = `Analyzing ${bulkProgress.completed} of ${bulkProgress.total} emails`;
    if (bulkProgress.failed > 0) {
      headline += ` · ${bulkProgress.failed} failed`;
    }
    detail =
      "Large threads with many attachments can take several minutes per email. This page updates automatically.";
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
    <div role="status" aria-live="polite" className={barClass}>
      {bulkRunning || bulkExtractRunning || processingCount > 0 ? (
        <span className={pulseClass} aria-hidden />
      ) : null}
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{headline}</p>
        <p className={detailClass}>{detail}</p>
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
      <span className="hidden md:inline">Processed</span>
      {costLabel ? (
        <span className="ml-1 hidden tabular-nums text-teal-900 md:inline">
          {costLabel}
        </span>
      ) : null}
      {processedCount != null &&
      totalCount != null &&
      processedCount < totalCount ? (
        <span className="ml-1 hidden tabular-nums text-teal-700 md:inline">
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
        <span className="hidden text-teal-700 md:inline">·</span>
        <span className="hidden md:inline">Processed</span>
        {costLabel ? (
          <span className="hidden text-teal-900 md:inline">{costLabel}</span>
        ) : null}
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

function ThreadExtractMetaRow({
  contactProgress,
  orgProgress,
  projectProgress,
  eventProgress,
  todoProgress,
  contactSummary,
  orgSummary,
  projectSummary,
  eventSummary,
  todoSummary,
  onOpenHarvest,
}: {
  contactProgress?: ExtractProgress | null;
  orgProgress?: ExtractProgress | null;
  projectProgress?: ExtractProgress | null;
  eventProgress?: ExtractProgress | null;
  todoProgress?: ExtractProgress | null;
  contactSummary?: ContactExtractSummary | null;
  orgSummary?: OrgExtractSummary | null;
  projectSummary?: ProjectExtractSummary | null;
  eventSummary?: EventExtractSummary | null;
  todoSummary?: TodoExtractSummary | null;
  onOpenHarvest?: (args?: {
    focusEmailId?: string | null;
    focusQuote?: string | null;
  }) => void;
}) {
  const showContactBadge = !contactProgress && contactSummary;
  const showOrgBadge = !orgProgress && orgSummary;
  const showProjectBadge = !projectProgress && projectSummary;
  const showEventBadge = !eventProgress && eventSummary;
  const showTodoBadge = !todoProgress && todoSummary;

  if (
    !contactProgress &&
    !orgProgress &&
    !projectProgress &&
    !eventProgress &&
    !todoProgress &&
    !showContactBadge &&
    !showOrgBadge &&
    !showProjectBadge &&
    !showEventBadge &&
    !showTodoBadge
  ) {
    return (
      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
        Thread
      </p>
    );
  }

  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-xs uppercase tracking-wide text-slate-500">
        Thread
      </span>
      {contactProgress ? (
        <ExtractProgressBadge progress={contactProgress} kind="contacts" />
      ) : null}
      {orgProgress ? (
        <ExtractProgressBadge progress={orgProgress} kind="organizations" />
      ) : null}
      {projectProgress ? (
        <ExtractProgressBadge progress={projectProgress} kind="projects" />
      ) : null}
      {eventProgress ? (
        <ExtractProgressBadge progress={eventProgress} kind="events" />
      ) : null}
      {todoProgress ? (
        <ExtractProgressBadge progress={todoProgress} kind="todos" />
      ) : null}
      {showContactBadge ? (
        <ContactExtractCostBadge
          summary={contactSummary}
          onOpenHarvest={onOpenHarvest}
        />
      ) : null}
      {showOrgBadge ? (
        <OrgExtractCostBadge
          summary={orgSummary}
          onOpenHarvest={onOpenHarvest}
        />
      ) : null}
      {showProjectBadge ? (
        <ProjectExtractCostBadge
          summary={projectSummary}
          onOpenHarvest={onOpenHarvest}
        />
      ) : null}
      {showEventBadge ? (
        <EventExtractCostBadge
          summary={eventSummary}
          onOpenHarvest={onOpenHarvest}
        />
      ) : null}
      {showTodoBadge ? (
        <TodoExtractCostBadge
          summary={todoSummary}
          onOpenHarvest={onOpenHarvest}
        />
      ) : null}
    </div>
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
  contactExtractSummaries: contactExtractSummariesProp = {},
  orgExtractSummaries: orgExtractSummariesProp = {},
  projectExtractSummaries: projectExtractSummariesProp = {},
  eventExtractSummaries: eventExtractSummariesProp = {},
  todoExtractSummaries: todoExtractSummariesProp = {},
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
  contactExtractSummaries?: Record<string, ContactExtractSummary>;
  orgExtractSummaries?: Record<string, OrgExtractSummary>;
  projectExtractSummaries?: Record<string, ProjectExtractSummary>;
  eventExtractSummaries?: Record<string, EventExtractSummary>;
  todoExtractSummaries?: Record<string, TodoExtractSummary>;
  initialQueueState?: InboxAnalysisQueueState;
  pagination?: Pagination;
  filters?: EmailThreadFilters;
  canManageEmailSettings?: boolean;
}) {
  const router = useRouter();
  const contactExtractMenuRef = useRef<HTMLDivElement>(null);
  const orgExtractMenuRef = useRef<HTMLDivElement>(null);
  const projectExtractMenuRef = useRef<HTMLDivElement>(null);
  const eventExtractMenuRef = useRef<HTMLDivElement>(null);
  const todoExtractMenuRef = useRef<HTMLDivElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkNotice, setBulkNotice] = useState<ExtractRunNotice | null>(null);
  const [contactExtractMenuOpen, setContactExtractMenuOpen] = useState(false);
  const [orgExtractMenuOpen, setOrgExtractMenuOpen] = useState(false);
  const [projectExtractMenuOpen, setProjectExtractMenuOpen] = useState(false);
  const [eventExtractMenuOpen, setEventExtractMenuOpen] = useState(false);
  const [todoExtractMenuOpen, setTodoExtractMenuOpen] = useState(false);
  const [bulkExtractKind, setBulkExtractKind] = useState<ExtractKind | null>(
    null,
  );
  const [contactExtractProgressByKey, setContactExtractProgressByKey] =
    useState<Record<string, ExtractProgress>>({});
  const [orgExtractProgressByKey, setOrgExtractProgressByKey] = useState<
    Record<string, ExtractProgress>
  >({});
  const [projectExtractProgressByKey, setProjectExtractProgressByKey] = useState<
    Record<string, ExtractProgress>
  >({});
  const [eventExtractProgressByKey, setEventExtractProgressByKey] = useState<
    Record<string, ExtractProgress>
  >({});
  const [todoExtractProgressByKey, setTodoExtractProgressByKey] = useState<
    Record<string, ExtractProgress>
  >({});
  const [contactExtractSummaries, setContactExtractSummaries] = useState(
    contactExtractSummariesProp,
  );
  const [orgExtractSummaries, setOrgExtractSummaries] = useState(
    orgExtractSummariesProp,
  );
  const [projectExtractSummaries, setProjectExtractSummaries] = useState(
    projectExtractSummariesProp,
  );
  const [eventExtractSummaries, setEventExtractSummaries] = useState(
    eventExtractSummariesProp,
  );
  const [todoExtractSummaries, setTodoExtractSummaries] = useState(
    todoExtractSummariesProp,
  );
  const [queueState, setQueueState] =
    useState<InboxAnalysisQueueState>(initialQueueState);
  const [threadReanalyzeActive, setThreadReanalyzeActive] = useState(false);
  const [extractionPanel, setExtractionPanel] = useState<{
    target: ExtractionPanelTarget;
    processingEntries: EmailProcessingStats[];
    threadEmailIds: string[];
  } | null>(null);
  const [harvestPanel, setHarvestPanel] =
    useState<ThreadHarvestPanelTarget | null>(null);

  const allPageEmailIds = useMemo(() => {
    if (view === "messages") {
      return messages?.map((message) => message.id) ?? [];
    }
    return Object.values(threadEmailIds ?? {}).flat();
  }, [view, messages, threadEmailIds]);

  useEffect(() => {
    setContactExtractSummaries(contactExtractSummariesProp);
  }, [contactExtractSummariesProp]);

  useEffect(() => {
    setOrgExtractSummaries(orgExtractSummariesProp);
  }, [orgExtractSummariesProp]);

  useEffect(() => {
    setProjectExtractSummaries(projectExtractSummariesProp);
  }, [projectExtractSummariesProp]);

  useEffect(() => {
    setEventExtractSummaries(eventExtractSummariesProp);
  }, [eventExtractSummariesProp]);

  useEffect(() => {
    setTodoExtractSummaries(todoExtractSummariesProp);
  }, [todoExtractSummariesProp]);

  const queuedCount =
    queueState.processingEmailIds.length + queueState.pendingEmailIds.length;
  const hasQueueActivity =
    bulkRunning || threadReanalyzeActive || queuedCount > 0;
  const busyBulk = bulkRunning || bulkExtractKind != null;

  useEffect(() => {
    setQueueState(initialQueueState);
  }, [initialQueueState]);

  useEffect(() => {
    if (
      !contactExtractMenuOpen &&
      !orgExtractMenuOpen &&
      !projectExtractMenuOpen &&
      !eventExtractMenuOpen &&
      !todoExtractMenuOpen
    )
      return;

    function handlePointerDown(event: MouseEvent) {
      const contactRoot = contactExtractMenuRef.current;
      const orgRoot = orgExtractMenuRef.current;
      const projectRoot = projectExtractMenuRef.current;
      const eventRoot = eventExtractMenuRef.current;
      const todoRoot = todoExtractMenuRef.current;
      if (!(event.target instanceof Node)) return;
      if (contactRoot && !contactRoot.contains(event.target)) {
        setContactExtractMenuOpen(false);
      }
      if (orgRoot && !orgRoot.contains(event.target)) {
        setOrgExtractMenuOpen(false);
      }
      if (projectRoot && !projectRoot.contains(event.target)) {
        setProjectExtractMenuOpen(false);
      }
      if (eventRoot && !eventRoot.contains(event.target)) {
        setEventExtractMenuOpen(false);
      }
      if (todoRoot && !todoRoot.contains(event.target)) {
        setTodoExtractMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContactExtractMenuOpen(false);
        setOrgExtractMenuOpen(false);
        setProjectExtractMenuOpen(false);
        setEventExtractMenuOpen(false);
        setTodoExtractMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contactExtractMenuOpen, orgExtractMenuOpen, eventExtractMenuOpen, todoExtractMenuOpen]);

  useEffect(() => {
    if (!hasQueueActivity || allPageEmailIds.length === 0) {
      return;
    }

    let cancelled = false;

    async function pollProcessingState() {
      const next = await fetchInboxQueueState(allPageEmailIds);
      if (cancelled) return;

      setQueueState((prev) => {
        const hasServerActivity =
          next.processingEmailIds.length > 0 || next.pendingEmailIds.length > 0;
        if (!hasServerActivity && threadReanalyzeActive) {
          return prev;
        }
        return next;
      });

      const stillActive =
        bulkRunning ||
        threadReanalyzeActive ||
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
  }, [
    hasQueueActivity,
    allPageEmailIds,
    bulkRunning,
    threadReanalyzeActive,
    router,
  ]);

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

  function handleReanalyzeStart(emailIds: string[]) {
    setThreadReanalyzeActive(true);
    setQueueState((prev) => {
      const processingSet = new Set(prev.processingEmailIds);
      const pendingSet = new Set(prev.pendingEmailIds);
      for (const emailId of emailIds) {
        if (!processingSet.has(emailId)) {
          pendingSet.add(emailId);
        }
      }
      return {
        ...prev,
        pendingEmailIds: [...pendingSet],
      };
    });
    void fetchInboxQueueState(allPageEmailIds).then(setQueueState);
  }

  function handleReanalyzeComplete() {
    setThreadReanalyzeActive(false);
    void fetchInboxQueueState(allPageEmailIds).then(setQueueState);
    router.refresh();
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

  function resolveExtractTargets(): ExtractTarget[] {
    if (view === "threads") {
      return [...selectedIds].map((threadId) => {
        const emailIds = threadEmailIds?.[threadId] ?? [];
        return {
          progressKey: threadId,
          badgeKeys: [threadId],
          prepareQuery: `threadId=${encodeURIComponent(threadId)}`,
          emailIds,
        };
      });
    }

    const messagesById = new Map(
      (messages ?? []).map((message) => [message.id, message]),
    );
    const groups = new Map<string, string[]>();

    for (const messageId of selectedIds) {
      const message = messagesById.get(messageId);
      const groupKey = message?.threadId ?? messageId;
      const list = groups.get(groupKey) ?? [];
      list.push(messageId);
      groups.set(groupKey, list);
    }

    return [...groups.entries()].map(([groupKey, emailIds]) => ({
      progressKey: groupKey,
      badgeKeys: emailIds,
      prepareQuery: `emailIds=${encodeURIComponent(emailIds.join(","))}`,
      emailIds,
    }));
  }

  function setExtractProgressForTarget(
    kind: ExtractKind,
    target: ExtractTarget,
    progress: ExtractProgress | null,
  ) {
    const setProgress =
      kind === "organizations"
        ? setOrgExtractProgressByKey
        : kind === "projects"
          ? setProjectExtractProgressByKey
          : kind === "events"
            ? setEventExtractProgressByKey
            : kind === "todos"
              ? setTodoExtractProgressByKey
              : setContactExtractProgressByKey;
    // Force a paint before the next long API await so phase badges are visible.
    flushSync(() => {
      setProgress((prev) => {
        const next = { ...prev };
        for (const key of target.badgeKeys) {
          if (progress) {
            next[key] = progress;
          } else {
            delete next[key];
          }
        }
        return next;
      });
    });
  }

  async function prepareExtractItems(
    kind: ExtractKind,
    target: ExtractTarget,
  ): Promise<PreparedExtractItem[]> {
    const base =
      kind === "organizations"
        ? "/api/analysis/extract-organizations/prepare"
        : kind === "projects"
          ? "/api/analysis/extract-projects/prepare"
          : kind === "events"
            ? "/api/analysis/extract-events/prepare"
            : kind === "todos"
              ? "/api/analysis/extract-todos/prepare"
              : "/api/analysis/extract-contacts/prepare";
    const response = await fetch(`${base}?${target.prepareQuery}`);
    const data = (await response.json()) as {
      items?: PreparedExtractItem[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error ?? "Could not prepare emails for extraction.");
    }
    return data.items ?? [];
  }

  async function runExtractPass(params: {
    kind: ExtractKind;
    items: PreparedExtractItem[];
    model: string;
    pass: ContactHighlightPass | OrgHighlightPass;
  }): Promise<ExtractRunWarning[]> {
    const endpoint =
      params.kind === "organizations"
        ? "/api/analysis/extract-organizations"
        : params.kind === "projects"
          ? "/api/analysis/extract-projects"
          : params.kind === "events"
            ? "/api/analysis/extract-events"
            : params.kind === "todos"
              ? "/api/analysis/extract-todos"
              : "/api/analysis/extract-contacts";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: params.items,
        model: params.model,
        pass: params.pass,
      }),
    });
    const data = (await response.json()) as {
      error?: string;
      results?: Array<{
        emailId?: string;
        error?: string;
        skipped?: boolean;
        entityCards?: unknown[];
      }>;
      fourthPass?: { error?: string | null };
    };
    if (!response.ok) {
      const label =
        params.kind === "organizations"
          ? "Organization"
          : params.kind === "projects"
            ? "Project"
            : params.kind === "events"
              ? "Event"
              : params.kind === "todos"
                ? "To-do"
                : "Contact";
      throw new Error(
        data.error ?? `${label} extraction pass ${params.pass} failed.`,
      );
    }
    return warningsFromExtractPostResponse(
      params.kind,
      params.pass,
      data,
    );
  }

  async function runExtractionForTarget(
    kind: ExtractKind,
    target: ExtractTarget,
    modelId: string,
  ): Promise<ExtractRunWarning[]> {
    setExtractProgressForTarget(kind, target, {
      pass: 1,
      current: 0,
      total: 0,
      status: "preparing",
    });

    const items = await prepareExtractItems(kind, target);
    if (items.length === 0) {
      throw new Error("No emails found for extraction.");
    }

    const summaryEmailIds =
      target.emailIds.length > 0
        ? target.emailIds
        : items.map((item) => item.emailId);

    const passes = isSinglePassKind(kind) ? ([1] as const) : ([1, 2, 3] as const);
    const warnings: ExtractRunWarning[] = [];

    for (const pass of passes) {
      for (let index = 0; index < items.length; index += 1) {
        setExtractProgressForTarget(kind, target, {
          pass,
          current: index + 1,
          total: items.length,
          status: "running",
        });
        warnings.push(
          ...(await runExtractPass({
            kind,
            items: [items[index]!],
            model: modelId,
            pass,
          })),
        );
      }
    }

    if (!isSinglePassKind(kind)) {
      setExtractProgressForTarget(kind, target, {
        pass: 4,
        current: 1,
        total: 1,
        status: "running",
      });
      warnings.push(
        ...(await runExtractPass({
          kind,
          items,
          model: modelId,
          pass: 4,
        })),
      );
    }

    const summaryEndpoint =
      kind === "organizations"
        ? "/api/analysis/extract-organizations"
        : kind === "projects"
          ? "/api/analysis/extract-projects"
          : kind === "events"
            ? "/api/analysis/extract-events"
            : kind === "todos"
              ? "/api/analysis/extract-todos"
              : "/api/analysis/extract-contacts";
    const summaryResponse = await fetch(
      `${summaryEndpoint}?emailIds=${encodeURIComponent(summaryEmailIds.join(","))}`,
    );
    const summaryData = (await summaryResponse.json()) as {
      runs?: Record<string, unknown>;
      error?: string;
    };
    if (summaryResponse.ok && summaryData.runs) {
      if (kind === "organizations") {
        const summary = orgExtractSummaryFromApiRuns(
          summaryData.runs as Parameters<typeof orgExtractSummaryFromApiRuns>[0],
        );
        if (summary) {
          flushSync(() => {
            setOrgExtractSummaries((prev) => {
              const next = { ...prev };
              for (const key of target.badgeKeys) {
                next[key] = summary;
              }
              next[target.progressKey] = summary;
              return next;
            });
          });
        }
      } else if (kind === "projects") {
        const summary = projectExtractSummaryFromApiRuns(
          summaryData.runs as Parameters<
            typeof projectExtractSummaryFromApiRuns
          >[0],
        );
        if (summary) {
          flushSync(() => {
            setProjectExtractSummaries((prev) => {
              const next = { ...prev };
              for (const key of target.badgeKeys) {
                next[key] = summary;
              }
              next[target.progressKey] = summary;
              return next;
            });
          });
        }
      } else if (kind === "events") {
        const summary = eventExtractSummaryFromApiRuns(
          summaryData.runs as Parameters<
            typeof eventExtractSummaryFromApiRuns
          >[0],
        );
        if (summary) {
          flushSync(() => {
            setEventExtractSummaries((prev) => {
              const next = { ...prev };
              for (const key of target.badgeKeys) {
                next[key] = summary;
              }
              next[target.progressKey] = summary;
              return next;
            });
          });
        }
      } else if (kind === "todos") {
        const summary = todoExtractSummaryFromApiRuns(
          summaryData.runs as Parameters<
            typeof todoExtractSummaryFromApiRuns
          >[0],
        );
        if (summary) {
          flushSync(() => {
            setTodoExtractSummaries((prev) => {
              const next = { ...prev };
              for (const key of target.badgeKeys) {
                next[key] = summary;
              }
              next[target.progressKey] = summary;
              return next;
            });
          });
        }
      } else {
        const summary = contactExtractSummaryFromApiRuns(
          summaryData.runs as Parameters<
            typeof contactExtractSummaryFromApiRuns
          >[0],
        );
        if (summary) {
          flushSync(() => {
            setContactExtractSummaries((prev) => {
              const next = { ...prev };
              for (const key of target.badgeKeys) {
                next[key] = summary;
              }
              next[target.progressKey] = summary;
              return next;
            });
          });
        }
      }
    }

    setExtractProgressForTarget(kind, target, null);
    return warnings;
  }

  async function runExtractionSelected(
    kind: ExtractKind,
    modelId:
      | ContactHighlightModelId
      | OrgHighlightModelId
      | ProjectHighlightModelId
      | EventHighlightModelId
      | TodoHighlightModelId,
  ) {
    if (kind === "contacts") {
      setContactExtractMenuOpen(false);
    } else if (kind === "organizations") {
      setOrgExtractMenuOpen(false);
    } else if (kind === "projects") {
      setProjectExtractMenuOpen(false);
    } else if (kind === "todos") {
      setTodoExtractMenuOpen(false);
    } else {
      setEventExtractMenuOpen(false);
    }

    const targets = resolveExtractTargets();
    if (targets.length === 0) {
      setBulkError("No threads or emails selected for extraction.");
      return;
    }

    const emailCount = resolveEmailIdsForSelection().length;
    const modelLabel =
      kind === "organizations"
        ? getOrgHighlightModelMeta(modelId as OrgHighlightModelId).label
        : kind === "projects"
          ? getProjectHighlightModelMeta(modelId as ProjectHighlightModelId).label
          : kind === "events"
            ? getEventHighlightModelMeta(modelId as EventHighlightModelId).label
            : kind === "todos"
              ? getTodoHighlightModelMeta(modelId as TodoHighlightModelId).label
              : getContactHighlightModelMeta(modelId as ContactHighlightModelId)
                  .label;
    const unitLabel =
      view === "threads"
        ? `${targets.length} thread${targets.length === 1 ? "" : "s"}`
        : `${targets.length} group${targets.length === 1 ? "" : "s"}`;
    const kindLabel =
      kind === "organizations"
        ? "organization extraction"
        : kind === "projects"
          ? "project extraction"
          : kind === "events"
            ? "event harvest"
            : kind === "todos"
              ? "to-do harvest"
              : "contact extraction";
    const passNote = isSinglePassKind(kind)
      ? kind === "todos"
        ? "This runs one to-do harvest pass per email and uses the AI API. Asks older than 120 days are archived, not added to the open list."
        : "This runs one calendar-focused pass per email and uses the AI API."
      : "This runs all 4 passes per thread in series and uses the AI API.";
    const confirmed = window.confirm(
      `Run ${kindLabel} (${modelLabel}) on ${unitLabel} (${emailCount} email${emailCount === 1 ? "" : "s"})?\n\n${passNote}`,
    );
    if (!confirmed) return;

    setBulkExtractKind(kind);
    setBulkError(null);
    setBulkNotice(null);

    const setProgress =
      kind === "organizations"
        ? setOrgExtractProgressByKey
        : kind === "projects"
          ? setProjectExtractProgressByKey
          : kind === "events"
            ? setEventExtractProgressByKey
            : kind === "todos"
              ? setTodoExtractProgressByKey
              : setContactExtractProgressByKey;

    flushSync(() => {
      setProgress((prev) => {
        const next = { ...prev };
        for (const target of targets) {
          for (const key of target.badgeKeys) {
            delete next[key];
          }
        }
        return next;
      });
    });

    try {
      const allWarnings: ExtractRunWarning[] = [];
      let hadHardFailure = false;
      for (const target of targets) {
        try {
          allWarnings.push(
            ...(await runExtractionForTarget(kind, target, modelId)),
          );
        } catch (err) {
          hadHardFailure = true;
          const message =
            err instanceof Error
              ? err.message
              : `${kind === "organizations" ? "Organization" : kind === "projects" ? "Project" : kind === "events" ? "Event" : kind === "todos" ? "To-do" : "Contact"} extraction failed.`;
          flushSync(() => {
            setProgress((prev) => {
              const current = prev[target.badgeKeys[0] ?? target.progressKey];
              const next = { ...prev };
              const failed: ExtractProgress = {
                pass: current?.pass ?? 1,
                current: current?.current ?? 0,
                total: current?.total ?? 0,
                status: "failed",
                error: message,
              };
              for (const key of target.badgeKeys) {
                next[key] = failed;
              }
              return next;
            });
          });
          setBulkError(message);
        }
      }

      const kindLabel =
        kind === "organizations"
          ? "Organization extraction"
          : kind === "projects"
            ? "Project extraction"
            : kind === "events"
              ? "Event harvest"
              : kind === "todos"
                ? "To-do harvest"
                : "Contact extraction";
      if (!hadHardFailure) {
        setBulkNotice(
          buildExtractRunNotice({
            warnings: allWarnings,
            successTitle: `${kindLabel} finished.`,
            successDetail:
              kind === "projects" || kind === "contacts"
                ? "Check Entities → Mentions if you were testing mention resolution."
                : undefined,
            problemTitle: `${kindLabel} finished with problems.`,
          }),
        );
      }

      clearSelection();
      router.refresh();
    } finally {
      setBulkExtractKind(null);
    }
  }

  async function reharvestContactsAndProjects() {
    const targets = resolveExtractTargets();
    if (targets.length === 0) {
      setBulkError("No threads or emails selected for re-harvest.");
      return;
    }
    const emailCount = resolveEmailIdsForSelection().length;
    const unitLabel =
      view === "threads"
        ? `${targets.length} thread${targets.length === 1 ? "" : "s"}`
        : `${targets.length} group${targets.length === 1 ? "" : "s"}`;
    const confirmed = window.confirm(
      `Re-harvest contacts and projects (passes 1–4) on ${unitLabel} (${emailCount} email${emailCount === 1 ? "" : "s"})?\n\nThis re-runs both pipelines on historical mail so mention resolution can be tested in the browser.`,
    );
    if (!confirmed) return;

    setBulkError(null);
    setBulkNotice(null);
    const modelId = DEFAULT_CONTACT_HIGHLIGHT_MODEL;
    try {
      const allWarnings: ExtractRunWarning[] = [];
      setBulkExtractKind("contacts");
      for (const target of targets) {
        allWarnings.push(
          ...(await runExtractionForTarget("contacts", target, modelId)),
        );
      }
      setBulkExtractKind("projects");
      for (const target of targets) {
        allWarnings.push(
          ...(await runExtractionForTarget("projects", target, modelId)),
        );
      }
      setBulkNotice(
        buildExtractRunNotice({
          warnings: allWarnings,
          successTitle: `Re-harvest C+P finished on ${unitLabel}.`,
          successDetail:
            "Check Entities → Projects or Contacts → Mentions. Refresh that tab if counts look stale.",
          problemTitle: `Re-harvest C+P finished with problems on ${unitLabel}.`,
        }),
      );
      clearSelection();
      router.refresh();
    } catch (err) {
      setBulkError(
        err instanceof Error ? err.message : "Re-harvest failed.",
      );
    } finally {
      setBulkExtractKind(null);
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
                  : "/knowledge/emails"
              }
              className="text-teal-700 hover:underline"
            >
              Clear filters
            </Link>
          </>
        ) : canManageEmailSettings ? (
          <>
            No emails ingested yet. Connect Gmail in{" "}
            <Link href="/admin/system/settings" className="text-teal-700 hover:underline">
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
        bulkExtractKind={bulkExtractKind}
        queueState={queueState}
      />

      {bulkError ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {bulkError}
        </p>
      ) : null}

      <HarvestRunNotice
        notice={bulkNotice}
        onDismiss={() => setBulkNotice(null)}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-1.5">
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
                disabled={busyBulk}
                onClick={() => void analyzeSelected()}
                className="shrink-0 rounded bg-teal-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {bulkRunning ? "Analyzing…" : "Analyze selected"}
              </button>
              <button
                type="button"
                disabled={busyBulk}
                onClick={() => void reharvestContactsAndProjects()}
                className="shrink-0 rounded border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-950 hover:bg-orange-100 disabled:opacity-50"
              >
                {bulkExtractKind === "contacts" || bulkExtractKind === "projects"
                  ? "Re-harvesting…"
                  : "Re-harvest C+P"}
              </button>
              <div ref={contactExtractMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  disabled={busyBulk}
                  aria-expanded={contactExtractMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setOrgExtractMenuOpen(false);
                    setProjectExtractMenuOpen(false);
                    setEventExtractMenuOpen(false);
                    setTodoExtractMenuOpen(false);
                    setContactExtractMenuOpen((open) => !open);
                  }}
                  className="rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-50"
                >
                  {bulkExtractKind === "contacts"
                    ? "Extracting…"
                    : "Extract Contacts"}
                </button>
                {contactExtractMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute left-0 z-30 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                  >
                    <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Contact extraction model
                    </p>
                    {CONTACT_HIGHLIGHT_MODELS.map((modelId) => (
                      <button
                        key={modelId}
                        type="button"
                        role="menuitem"
                        className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-800 hover:bg-violet-50"
                        onClick={() =>
                          void runExtractionSelected("contacts", modelId)
                        }
                      >
                        {formatContactHighlightModelOptionLabel(modelId)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div ref={orgExtractMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  disabled={busyBulk}
                  aria-expanded={orgExtractMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setContactExtractMenuOpen(false);
                    setProjectExtractMenuOpen(false);
                    setEventExtractMenuOpen(false);
                    setTodoExtractMenuOpen(false);
                    setOrgExtractMenuOpen((open) => !open);
                  }}
                  className="rounded border border-fuchsia-300 bg-fuchsia-50 px-2 py-0.5 text-xs font-medium text-fuchsia-900 hover:bg-fuchsia-100 disabled:opacity-50"
                >
                  {bulkExtractKind === "organizations"
                    ? "Extracting…"
                    : "Extract Organizations"}
                </button>
                {orgExtractMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute left-0 z-30 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                  >
                    <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Organization extraction model
                    </p>
                    {ORG_HIGHLIGHT_MODELS.map((modelId) => (
                      <button
                        key={modelId}
                        type="button"
                        role="menuitem"
                        className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-800 hover:bg-fuchsia-50"
                        onClick={() =>
                          void runExtractionSelected("organizations", modelId)
                        }
                      >
                        {formatOrgHighlightModelOptionLabel(modelId)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div ref={projectExtractMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  disabled={busyBulk}
                  aria-expanded={projectExtractMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setContactExtractMenuOpen(false);
                    setOrgExtractMenuOpen(false);
                    setEventExtractMenuOpen(false);
                    setTodoExtractMenuOpen(false);
                    setProjectExtractMenuOpen((open) => !open);
                  }}
                  className="rounded border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-900 hover:bg-orange-100 disabled:opacity-50"
                >
                  {bulkExtractKind === "projects"
                    ? "Extracting…"
                    : "Extract Projects"}
                </button>
                {projectExtractMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute left-0 z-30 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                  >
                    <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Project extraction model
                    </p>
                    {PROJECT_HIGHLIGHT_MODELS.map((modelId) => (
                      <button
                        key={modelId}
                        type="button"
                        role="menuitem"
                        className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-800 hover:bg-orange-50"
                        onClick={() =>
                          void runExtractionSelected("projects", modelId)
                        }
                      >
                        {formatProjectHighlightModelOptionLabel(modelId)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div ref={eventExtractMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  disabled={busyBulk}
                  aria-expanded={eventExtractMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setContactExtractMenuOpen(false);
                    setOrgExtractMenuOpen(false);
                    setProjectExtractMenuOpen(false);
                    setTodoExtractMenuOpen(false);
                    setEventExtractMenuOpen((open) => !open);
                  }}
                  className="rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900 hover:bg-sky-100 disabled:opacity-50"
                >
                  {bulkExtractKind === "events"
                    ? "Extracting…"
                    : "Extract Events"}
                </button>
                {eventExtractMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute left-0 z-30 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                  >
                    <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Event harvest model
                    </p>
                    {EVENT_HIGHLIGHT_MODELS.map((modelId) => (
                      <button
                        key={modelId}
                        type="button"
                        role="menuitem"
                        className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-800 hover:bg-sky-50"
                        onClick={() =>
                          void runExtractionSelected("events", modelId)
                        }
                      >
                        {formatEventHighlightModelOptionLabel(modelId)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div ref={todoExtractMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  disabled={busyBulk}
                  aria-expanded={todoExtractMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setContactExtractMenuOpen(false);
                    setOrgExtractMenuOpen(false);
                    setProjectExtractMenuOpen(false);
                    setEventExtractMenuOpen(false);
                    setTodoExtractMenuOpen((open) => !open);
                  }}
                  className="rounded border border-lime-300 bg-lime-50 px-2 py-0.5 text-xs font-medium text-lime-900 hover:bg-lime-100 disabled:opacity-50"
                >
                  {bulkExtractKind === "todos"
                    ? "Extracting…"
                    : "Extract To-dos"}
                </button>
                {todoExtractMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute left-0 z-30 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                  >
                    <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      To-do harvest model
                    </p>
                    {TODO_HIGHLIGHT_MODELS.map((modelId) => (
                      <button
                        key={modelId}
                        type="button"
                        role="menuitem"
                        className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-800 hover:bg-lime-50"
                        onClick={() =>
                          void runExtractionSelected("todos", modelId)
                        }
                      >
                        {formatTodoHighlightModelOptionLabel(modelId)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                disabled={busyBulk}
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

        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-x-hidden overflow-y-auto">
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

                const extractionRowHighlighted =
                  extractionPanel?.target?.kind === "email" &&
                  extractionPanel.target.emailId === message.id;

                return (
                <li
                  key={message.id}
                  className={inboxRowClassName(extractionRowHighlighted)}
                >
                  <HoverPopoverRowProvider rowId={message.id}>
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
                  <div className="block min-w-0 py-4">
                    <Link
                      href={messageHref(message.id, filters)}
                      className="block min-w-0"
                    >
                      <p className="truncate font-medium text-slate-900">
                        {message.subject}
                      </p>
                      <p className="mt-1 truncate text-sm text-slate-600">
                        {message.fromAddress}
                      </p>
                    </Link>
                    {(contactExtractProgressByKey[message.id] ||
                      orgExtractProgressByKey[message.id] ||
                      projectExtractProgressByKey[message.id] ||
                      eventExtractProgressByKey[message.id] ||
                      todoExtractProgressByKey[message.id] ||
                      contactExtractSummaries[message.id] ||
                      orgExtractSummaries[message.id] ||
                      projectExtractSummaries[message.id] ||
                      eventExtractSummaries[message.id] ||
                      todoExtractSummaries[message.id]) && (
                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                        {contactExtractProgressByKey[message.id] ? (
                          <ExtractProgressBadge
                            progress={contactExtractProgressByKey[message.id]!}
                            kind="contacts"
                          />
                        ) : contactExtractSummaries[message.id] ? (
                          <ContactExtractCostBadge
                            summary={contactExtractSummaries[message.id]!}
                            onOpenHarvest={() =>
                              setHarvestPanel({
                                threadId: message.threadId,
                                emailIds: [message.id],
                                focusEmailId: message.id,
                              })
                            }
                          />
                        ) : null}
                        {orgExtractProgressByKey[message.id] ? (
                          <ExtractProgressBadge
                            progress={orgExtractProgressByKey[message.id]!}
                            kind="organizations"
                          />
                        ) : orgExtractSummaries[message.id] ? (
                          <OrgExtractCostBadge
                            summary={orgExtractSummaries[message.id]!}
                            onOpenHarvest={() =>
                              setHarvestPanel({
                                threadId: message.threadId,
                                emailIds: [message.id],
                                focusEmailId: message.id,
                              })
                            }
                          />
                        ) : null}
                        {projectExtractProgressByKey[message.id] ? (
                          <ExtractProgressBadge
                            progress={projectExtractProgressByKey[message.id]!}
                            kind="projects"
                          />
                        ) : projectExtractSummaries[message.id] ? (
                          <ProjectExtractCostBadge
                            summary={projectExtractSummaries[message.id]!}
                            onOpenHarvest={() =>
                              setHarvestPanel({
                                threadId: message.threadId,
                                emailIds: [message.id],
                                focusEmailId: message.id,
                              })
                            }
                          />
                        ) : null}
                        {eventExtractProgressByKey[message.id] ? (
                          <ExtractProgressBadge
                            progress={eventExtractProgressByKey[message.id]!}
                            kind="events"
                          />
                        ) : eventExtractSummaries[message.id] ? (
                          <EventExtractCostBadge
                            summary={eventExtractSummaries[message.id]!}
                            onOpenHarvest={(args) =>
                              setHarvestPanel({
                                threadId: message.threadId,
                                emailIds: [message.id],
                                focusEmailId: args?.focusEmailId ?? message.id,
                                focusQuote: args?.focusQuote,
                              })
                            }
                          />
                        ) : null}
                        {todoExtractProgressByKey[message.id] ? (
                          <ExtractProgressBadge
                            progress={todoExtractProgressByKey[message.id]!}
                            kind="todos"
                          />
                        ) : todoExtractSummaries[message.id] ? (
                          <TodoExtractCostBadge
                            summary={todoExtractSummaries[message.id]!}
                            onOpenHarvest={(args) =>
                              setHarvestPanel({
                                threadId: message.threadId,
                                emailIds: [message.id],
                                focusEmailId: args?.focusEmailId ?? message.id,
                                focusQuote: args?.focusQuote,
                              })
                            }
                          />
                        ) : null}
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 items-center overflow-hidden py-4">
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
                                threadEmailIds: [],
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
                  <DateTimeDisplay
                    value={message.receivedAt}
                    className="py-4 pr-2 text-right text-sm text-slate-600 md:pr-4"
                  />
                  </HoverPopoverRowProvider>
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

                const extractionRowHighlighted =
                  extractionPanel?.target?.kind === "thread" &&
                  extractionPanel.target.threadId === thread.id;

                return (
                  <li
                    key={thread.id}
                    className={inboxRowClassName(extractionRowHighlighted)}
                  >
                    <HoverPopoverRowProvider rowId={thread.id}>
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
                    <div className="block min-w-0 py-4">
                      <Link
                        href={emailThreadDetailHref(thread.id)}
                        className="block min-w-0"
                      >
                        <p className="truncate font-medium text-slate-900">
                          {thread.subject}
                        </p>
                      </Link>
                      <ThreadExtractMetaRow
                        contactProgress={
                          contactExtractProgressByKey[thread.id] ?? null
                        }
                        orgProgress={orgExtractProgressByKey[thread.id] ?? null}
                        projectProgress={
                          projectExtractProgressByKey[thread.id] ?? null
                        }
                        eventProgress={
                          eventExtractProgressByKey[thread.id] ?? null
                        }
                        todoProgress={
                          todoExtractProgressByKey[thread.id] ?? null
                        }
                        contactSummary={
                          contactExtractSummaries[thread.id] ?? null
                        }
                        orgSummary={orgExtractSummaries[thread.id] ?? null}
                        projectSummary={
                          projectExtractSummaries[thread.id] ?? null
                        }
                        eventSummary={eventExtractSummaries[thread.id] ?? null}
                        todoSummary={todoExtractSummaries[thread.id] ?? null}
                        onOpenHarvest={(args) =>
                          setHarvestPanel({
                            threadId: thread.id,
                            emailIds: threadEmailIds?.[thread.id] ?? [],
                            focusEmailId: args?.focusEmailId,
                            focusQuote: args?.focusQuote,
                          })
                        }
                      />
                    </div>
                    <div className="flex min-w-0 items-center overflow-hidden py-4">
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
                                  threadEmailIds: threadEmailIds?.[thread.id] ?? [],
                                })
                            : undefined
                        }
                      />
                    </div>
                    <div className="flex items-center justify-center py-4">
                      <EmailAttachmentsBadge groups={groups} />
                    </div>
                    <DateTimeDisplay
                      value={thread.lastMessageAt}
                      className="py-4 pr-2 text-right text-sm text-slate-600 md:pr-4"
                    />
                    </HoverPopoverRowProvider>
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
      threadEmailIds={extractionPanel?.threadEmailIds}
      onClose={() => setExtractionPanel(null)}
      onThreadDataDeleted={() => router.refresh()}
      onReanalyzeStart={handleReanalyzeStart}
      onReanalyzeComplete={handleReanalyzeComplete}
    />
    <ThreadHarvestSidePanel
      target={harvestPanel}
      onClose={() => setHarvestPanel(null)}
    />
    </>
  );
}
