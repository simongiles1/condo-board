"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DeleteThreadProcessedDataDialog } from "@/components/DeleteThreadProcessedDataDialog";
import { EmailSidePanel } from "@/components/EmailSidePanel";
import { ThreadReanalyzeButton } from "@/components/ThreadReanalyzeButton";
import {
  ExtractionDetailsBody,
  mergeDestinationGroups,
  mergeThreadTags,
  ProcessorInitials,
  ProcessorInitialsGroup,
} from "@/components/ExtractionPanelContent";
import { prepareCalendarAuditItems } from "@/lib/email/extraction-audit-display";
import { ProcessingStatsTable } from "@/components/ProcessedCostBadge";
import type { ThreadEntityReviewGroup } from "@/lib/entities/entity-review";
import type { ExtractionAuditRecord, ExtractionAuditItem } from "@/lib/email/extraction-audit";
import { EXTRACTION_DESTINATIONS } from "@/lib/email/extraction-routing";
import type { EmailProcessingStats } from "@/lib/email/processing-stats";
import { formatDateTime } from "@/lib/format/datetime";

export type ExtractionPanelTarget =
  | {
      kind: "email";
      emailId: string;
      subject?: string;
      fromAddress?: string;
    }
  | {
      kind: "thread";
      threadId: string;
      subject?: string;
    };

type PanelTab = "extractions" | "processing";

type EmailExtractionResponse = {
  kind: "email";
  emailId: string;
  records: ExtractionAuditRecord[];
  error?: string;
};

type ThreadExtractionResponse = {
  kind: "thread";
  threadId: string;
  records: ExtractionAuditRecord[];
  emailSubject: string | null;
  threadEntityGroups: ThreadEntityReviewGroup[];
  reconciledMaintenanceItems?: ExtractionAuditItem[];
  reconciledCalendarItems?: ExtractionAuditItem[];
  error?: string;
};

type Props = {
  target: ExtractionPanelTarget | null;
  processingEntries: EmailProcessingStats[];
  threadEmailIds?: string[];
  onClose: () => void;
  onThreadDataDeleted?: () => void;
  onReanalyzeStart?: (emailIds: string[]) => void;
  onReanalyzeComplete?: () => void;
};

function PanelTabStrip({
  activeTab,
  onTabChange,
  showProcessingTab,
  analyzedAt,
}: {
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  showProcessingTab: boolean;
  analyzedAt?: string | null;
}) {
  return (
    <div className="flex shrink-0 items-end justify-between gap-3 border-b border-slate-200 px-5">
      <div
        className="flex gap-1"
        role="tablist"
        aria-label="Extraction panel sections"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "extractions"}
          className={`border-b-2 px-3 py-2.5 text-sm font-medium transition ${
            activeTab === "extractions"
              ? "border-teal-700 text-teal-800"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
          onClick={() => onTabChange("extractions")}
        >
          Extractions
        </button>
        {showProcessingTab ? (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "processing"}
            className={`border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              activeTab === "processing"
                ? "border-teal-700 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
            onClick={() => onTabChange("processing")}
          >
            Processing details
          </button>
        ) : null}
      </div>
      {analyzedAt ? (
        <p className="shrink-0 pb-2.5 text-sm text-slate-500">
          Analyzed {formatDateTime(analyzedAt)}
        </p>
      ) : null}
    </div>
  );
}

export function ExtractionSidePanel({
  target,
  processingEntries,
  threadEmailIds = [],
  onClose,
  onThreadDataDeleted,
  onReanalyzeStart,
  onReanalyzeComplete,
}: Props) {
  const [activeTab, setActiveTab] = useState<PanelTab>("extractions");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailRecords, setEmailRecords] = useState<ExtractionAuditRecord[]>([]);
  const [threadRecords, setThreadRecords] = useState<ExtractionAuditRecord[]>([]);
  const [threadEntityGroups, setThreadEntityGroups] = useState<
    ThreadEntityReviewGroup[]
  >([]);
  const [reconciledMaintenanceItems, setReconciledMaintenanceItems] = useState<
    ExtractionAuditItem[]
  >([]);
  const [reconciledCalendarItems, setReconciledCalendarItems] = useState<
    ExtractionAuditItem[]
  >([]);
  const [threadSubject, setThreadSubject] = useState<string | null>(null);
  const [sourceEmailId, setSourceEmailId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setActiveTab("extractions");
    setDeleteDialogOpen(false);
  }, [target]);

  const reloadExtractions = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!target) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !sourceEmailId && !deleteDialogOpen) {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [target, onClose, sourceEmailId, deleteDialogOpen]);

  useEffect(() => {
    if (!target) {
      setEmailRecords([]);
      setThreadRecords([]);
      setThreadEntityGroups([]);
      setReconciledMaintenanceItems([]);
      setReconciledCalendarItems([]);
      setThreadSubject(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const url =
      target.kind === "email"
        ? `/api/email/extractions?emailId=${encodeURIComponent(target.emailId)}`
        : `/api/email/extractions?threadId=${encodeURIComponent(target.threadId)}`;

    fetch(url)
      .then(async (response) => {
        const data = (await response.json()) as
          | EmailExtractionResponse
          | ThreadExtractionResponse;
        if (!response.ok) {
          throw new Error(data.error ?? "Could not load extractions.");
        }
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        if (data.kind === "email") {
          setEmailRecords(data.records);
          setThreadRecords([]);
          setThreadEntityGroups([]);
          setReconciledMaintenanceItems([]);
          setReconciledCalendarItems([]);
          setThreadSubject(null);
        } else {
          setThreadRecords(data.records);
          setThreadEntityGroups(data.threadEntityGroups);
          setReconciledMaintenanceItems(data.reconciledMaintenanceItems ?? []);
          setReconciledCalendarItems(data.reconciledCalendarItems ?? []);
          setThreadSubject(data.emailSubject);
          setEmailRecords([]);
        }
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Could not load extractions.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target, refreshKey]);

  const displayTitle = useMemo(() => {
    if (!target) return "";
    if (target.kind === "email") {
      return (
        target.subject ??
        emailRecords[0]?.emailSubject ??
        "Email extractions"
      );
    }
    return target.subject ?? threadSubject ?? "Thread extractions";
  }, [target, emailRecords, threadSubject]);

  const executorEmails = useMemo(() => {
    const records = target?.kind === "email" ? emailRecords : threadRecords;
    return records
      .map((record) => record.triggeredByEmail)
      .filter((email): email is string => Boolean(email));
  }, [target, emailRecords, threadRecords]);

  const latestProcessedAt = useMemo(() => {
    const records = target?.kind === "email" ? emailRecords : threadRecords;
    return records[0]?.processedAt ?? null;
  }, [target, emailRecords, threadRecords]);

  const emailPanelContent = useMemo(() => {
    if (!emailRecords.length) return null;

    const record = emailRecords[0];
    const highlightEmailId = record.emailId;
    const destinationGroups = record.destinationGroups.map((group) => {
      if (group.destination.id !== "calendar") return group;
      return {
        ...group,
        items: prepareCalendarAuditItems(group.items),
      };
    });

    return (
      <ExtractionDetailsBody
        destinationGroups={destinationGroups}
        tags={record.tags}
        highlightEmailId={highlightEmailId}
        footer={
          <>
            {record.emailId ? (
              <button
                type="button"
                onClick={() => setSourceEmailId(record.emailId!)}
                className="font-medium text-teal-700 hover:underline"
              >
                Open source email
              </button>
            ) : null}
            <span className="text-slate-500">Model: {record.modelName}</span>
            {emailRecords.length > 1 ? (
              <span className="text-slate-500">
                {emailRecords.length} analysis run
                {emailRecords.length === 1 ? "" : "s"} · showing latest
              </span>
            ) : null}
          </>
        }
      />
    );
  }, [emailRecords]);

  const threadPanelContent = useMemo(() => {
    if (!threadRecords.length) return null;

    const mergedDestinationGroups = mergeDestinationGroups(
      threadRecords.flatMap((record) => record.destinationGroups),
    );

    const entitiesDestination = EXTRACTION_DESTINATIONS.find(
      (entry) => entry.id === "entities",
    );
    const mergedEntitiesGroup = mergedDestinationGroups.find(
      (entry) => entry.destination.id === "entities",
    );

    const destinationGroups =
      threadEntityGroups.length > 0 && entitiesDestination
        ? [
            ...mergedDestinationGroups.filter(
              (entry) => entry.destination.id !== "entities",
            ),
            {
              destination: entitiesDestination,
              items: mergedEntitiesGroup?.items ?? [],
            },
          ]
        : mergedDestinationGroups;

    const maintenanceDestination = destinationGroups.find(
      (entry) => entry.destination.id === "maintenance",
    );
    if (maintenanceDestination) {
      const rawEquipmentMentions = maintenanceDestination.items.filter(
        (item) => item.fieldKey === "equipment_mentions",
      );
      const rawMaintenanceEvents = maintenanceDestination.items.filter(
        (item) => item.fieldKey === "maintenance_events",
      );
      maintenanceDestination.items =
        reconciledMaintenanceItems.length > 0
          ? [...reconciledMaintenanceItems, ...rawMaintenanceEvents]
          : [...rawEquipmentMentions, ...rawMaintenanceEvents];
    }

    const calendarDestination = destinationGroups.find(
      (entry) => entry.destination.id === "calendar",
    );
    if (calendarDestination) {
      const rawCancellations = calendarDestination.items.filter(
        (item) => item.fieldKey === "meeting_cancellations",
      );
      calendarDestination.items =
        reconciledCalendarItems.length > 0
          ? [...reconciledCalendarItems, ...rawCancellations]
          : prepareCalendarAuditItems(calendarDestination.items);
    }

    const visibleDestinationGroups = destinationGroups.filter((group) => {
      if (group.destination.id === "entities") {
        return group.items.length > 0 || threadEntityGroups.length > 0;
      }
      return group.items.length > 0;
    });

    const mergedTags = mergeThreadTags(threadRecords.map((record) => record.tags));
    const modelNames = [...new Set(threadRecords.map((record) => record.modelName))];
    const analyzedEmailCount = new Set(
      threadRecords
        .map((record) => record.emailId)
        .filter((emailId): emailId is string => Boolean(emailId)),
    ).size;

    return (
      <ExtractionDetailsBody
        destinationGroups={visibleDestinationGroups}
        threadEntityGroups={threadEntityGroups}
        tags={mergedTags}
        footer={
          <>
            <span className="text-slate-500">
              {analyzedEmailCount > 0
                ? `${analyzedEmailCount} email${analyzedEmailCount === 1 ? "" : "s"} analyzed`
                : `${threadRecords.length} extraction run${
                    threadRecords.length === 1 ? "" : "s"
                  }`}
            </span>
            {modelNames.length > 0 ? (
              <span className="text-slate-500">
                Model{modelNames.length === 1 ? "" : "s"}: {modelNames.join(", ")}
              </span>
            ) : null}
          </>
        }
      />
    );
  }, [threadRecords, threadEntityGroups, reconciledMaintenanceItems, reconciledCalendarItems]);

  if (!target) return null;

  const subtitle =
    target.kind === "email"
      ? target.fromAddress ?? emailRecords[0]?.emailFrom
      : null;

  const showProcessingTab = processingEntries.length > 0;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/25"
        onClick={onClose}
        aria-label="Close extractions panel"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="extraction-side-panel-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-4xl flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <h2
                id="extraction-side-panel-title"
                className="min-w-0 flex-1 text-lg font-semibold leading-snug text-slate-900"
              >
                {loading ? "Loading…" : displayTitle}
              </h2>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {executorEmails.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="sr-only">Processed by</span>
                    {executorEmails.length === 1 ? (
                      <ProcessorInitials email={executorEmails[0]} size="md" />
                    ) : (
                      <ProcessorInitialsGroup emails={executorEmails} />
                    )}
                  </div>
                ) : null}
                {target.kind === "thread" && threadEmailIds.length > 0 ? (
                  <ThreadReanalyzeButton
                    emailIds={threadEmailIds}
                    onReanalyzeStart={onReanalyzeStart}
                    onReanalyzeComplete={onReanalyzeComplete}
                    onComplete={() => {
                      reloadExtractions();
                    }}
                  />
                ) : null}
              </div>
            </div>
            {subtitle ? (
              <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {target.kind === "thread" ? (
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(true)}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-700"
                aria-label="Delete thread processed data"
                title="Delete thread processed data"
              >
                <TrashIcon />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        <PanelTabStrip
          activeTab={activeTab}
          onTabChange={setActiveTab}
          showProcessingTab={showProcessingTab}
          analyzedAt={latestProcessedAt}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {activeTab === "processing" && showProcessingTab ? (
            <ProcessingStatsTable entries={processingEntries} />
          ) : null}

          {activeTab === "extractions" && loading ? (
            <div className="space-y-3">
              <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
              <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : null}

          {activeTab === "extractions" && error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {activeTab === "extractions" && !loading && !error ? (
            target.kind === "email" ? (
              emailRecords.length > 0 ? (
                emailPanelContent
              ) : (
                <p className="text-sm text-slate-500">
                  No extraction data found for this email.
                </p>
              )
            ) : threadRecords.length > 0 ? (
              threadPanelContent
            ) : (
              <p className="text-sm text-slate-500">
                No extraction data found for this thread.
              </p>
            )
          ) : null}
        </div>
      </aside>

      <EmailSidePanel
        emailId={sourceEmailId}
        onClose={() => setSourceEmailId(null)}
      />

      {target.kind === "thread" ? (
        <DeleteThreadProcessedDataDialog
          open={deleteDialogOpen}
          threadId={target.threadId}
          onClose={() => setDeleteDialogOpen(false)}
          onDeleted={() => {
            reloadExtractions();
            onThreadDataDeleted?.();
          }}
        />
      ) : null}
    </>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}
