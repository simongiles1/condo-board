"use client";

import { useEffect, useMemo, useState } from "react";

import { EmailSidePanel } from "@/components/EmailSidePanel";
import {
  ExtractionDetailsBody,
  mergeDestinationGroups,
  mergeThreadTags,
  ProcessorInitials,
  ProcessorInitialsGroup,
} from "@/components/ExtractionPanelContent";
import { ProcessingStatsTable } from "@/components/ProcessedCostBadge";
import type { ThreadEntityReviewGroup } from "@/lib/entities/entity-review";
import type { ExtractionAuditRecord } from "@/lib/email/extraction-audit";
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
  error?: string;
};

type Props = {
  target: ExtractionPanelTarget | null;
  processingEntries: EmailProcessingStats[];
  onClose: () => void;
};

function PanelTabStrip({
  activeTab,
  onTabChange,
  showProcessingTab,
}: {
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  showProcessingTab: boolean;
}) {
  return (
    <div
      className="flex shrink-0 gap-1 border-b border-slate-200 px-5"
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
  );
}

export function ExtractionSidePanel({
  target,
  processingEntries,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<PanelTab>("extractions");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailRecords, setEmailRecords] = useState<ExtractionAuditRecord[]>([]);
  const [threadRecords, setThreadRecords] = useState<ExtractionAuditRecord[]>([]);
  const [threadEntityGroups, setThreadEntityGroups] = useState<
    ThreadEntityReviewGroup[]
  >([]);
  const [threadSubject, setThreadSubject] = useState<string | null>(null);
  const [sourceEmailId, setSourceEmailId] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab("extractions");
  }, [target]);

  useEffect(() => {
    if (!target) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !sourceEmailId) onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [target, onClose, sourceEmailId]);

  useEffect(() => {
    if (!target) {
      setEmailRecords([]);
      setThreadRecords([]);
      setThreadEntityGroups([]);
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
          setThreadSubject(null);
        } else {
          setThreadRecords(data.records);
          setThreadEntityGroups(data.threadEntityGroups);
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
  }, [target]);

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

    return (
      <ExtractionDetailsBody
        destinationGroups={record.destinationGroups}
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

    const mergedTags = mergeThreadTags(threadRecords.map((record) => record.tags));
    const modelNames = [...new Set(threadRecords.map((record) => record.modelName))];
    const analyzedEmailCount = new Set(
      threadRecords
        .map((record) => record.emailId)
        .filter((emailId): emailId is string => Boolean(emailId)),
    ).size;

    return (
      <ExtractionDetailsBody
        destinationGroups={destinationGroups}
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
  }, [threadRecords, threadEntityGroups]);

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
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {target.kind === "thread" ? "Thread extractions" : "Email extractions"}
            </p>
            <h2
              id="extraction-side-panel-title"
              className="mt-1 text-lg font-semibold text-slate-900"
            >
              {loading ? "Loading…" : displayTitle}
            </h2>
            {subtitle ? (
              <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
            ) : null}
            {latestProcessedAt ? (
              <p className="mt-1 text-sm text-slate-600">
                Analyzed {formatDateTime(latestProcessedAt)}
              </p>
            ) : null}
            {executorEmails.length > 0 ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Processed by</span>
                {executorEmails.length === 1 ? (
                  <ProcessorInitials email={executorEmails[0]} size="md" />
                ) : (
                  <ProcessorInitialsGroup emails={executorEmails} />
                )}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <PanelTabStrip
          activeTab={activeTab}
          onTabChange={setActiveTab}
          showProcessingTab={showProcessingTab}
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
    </>
  );
}
