"use client";

import Link from "next/link";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { MinutesStructuredEditor } from "@/components/MinutesStructuredEditor";
import { AttendeesEditorDialog } from "@/components/AttendeesEditorDialog";
import { MeetingDocumentsDialog } from "@/components/MeetingDocumentsDialog";
import {
  AiUsageDialog,
  AiUsageIconButton,
} from "@/components/AiUsageDialog";
import type { EditableAttendance } from "@/lib/minutes/attendance-edit";
import type { AiUsageStageRow } from "@/lib/gemini/usage";
import { v2ToMarkdown } from "@/lib/minutes/v2-to-markdown";
import { serializeMinutesDoc } from "@/lib/minutes/doc-v2-edits";
import type { MinutesDocumentV2 } from "@/lib/minutes/schema-v2";
import type {
  MeetingV2Alert,
  MeetingV2ExtractionQuality,
} from "@/lib/meeting-v2/extraction-diagnostics";

type MeetingCard = {
  id: string;
  title: string;
  meetingDate: string;
  pipelineState: string;
  currentStep: string | null;
};

type MeetingV2Status = {
  meeting: {
    id: string;
    title: string;
    meetingDate: string;
    pipelineState: string;
    currentStep: string | null;
    progressPercent: number | null;
    lastError: string | null;
    computedPipelineState: string;
    computedCurrentStep: string;
    stages: Array<{
      key: "ingest" | "extract" | "evidence" | "investigate" | "validate";
      label: string;
      status: "complete" | "in_progress" | "incomplete";
      note: string;
      progressPercent: number;
    }>;
    counts: {
      sourceArtifacts: number;
      transcriptSegments: number;
      documentPages: number;
      documentSections: number;
      documentChunks: number;
      agendaItems: number;
      evidenceContexts: number;
      investigations: number;
      validations: number;
      drafts: number;
    };
    extractionQuality: MeetingV2ExtractionQuality;
    alerts: MeetingV2Alert[];
    integrity: {
      isConsistent: boolean;
      note: string;
    };
  };
  items: Array<{
    id: string;
    title: string;
    itemNumber: string | null;
    itemType: string;
    sourceSectionId: string | null;
    discussionSummary: string | null;
    confidence: string | null;
    outcome: string | null;
    openQuestions: string[];
    userAnswers: Record<string, string> | null;
    validation: Array<{
      severity: string;
      code: string;
      message: string;
    }>;
  }>;
  latestDraft: {
    id: string;
    title: string;
    contentMarkdown: string;
    json: string | null;
    format: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  sources: {
    transcript: {
      fileName: string;
      available: boolean;
    } | null;
    boardPackage: {
      fileName: string;
      available: boolean;
      pageCount: number | null;
    } | null;
  };
  documentSections: Array<{
    title: string;
    startPage: number;
    endPage: number;
  }>;
};

type V2Tab = "overview" | "review" | "draft" | "pipeline";

const EXPECTED_SEMANTIC_AGENDA_SHAPE: Array<{ title: string; why: string }> = [
  { title: "Call to Order", why: "Opening procedural item" },
  { title: "Approval of Previous Minutes — May 19, 2026", why: "Named prior meeting, not a PDF page" },
  { title: "Kitchen Stack Cleaning Presentation", why: "Named guest/vendor topic" },
  { title: "Financial Matters — unaudited statements", why: "Board business heading" },
  { title: "Ratification — insurance renewal", why: "One approval line item, not a page" },
  { title: "Management Report — BAS system approval", why: "Distinct decision topic" },
  { title: "In-camera — Unit 2005 chargeback dispute", why: "Named confidential item" },
  { title: "Date of Next Meeting", why: "Closing procedural item" },
];

function shouldShowExtractionShapeComparison(issueCode: string): boolean {
  return (
    issueCode === "section_shaped_output" ||
    issueCode === "literal_section_fallback" ||
    issueCode === "noisy_titles"
  );
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function startCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function stageTone(status: "complete" | "in_progress" | "incomplete"): string {
  if (status === "complete") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (status === "in_progress") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function statusTone(state: string): string {
  if (state === "validated") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (state === "failed") return "border-rose-200 bg-rose-50 text-rose-900";
  if (state === "investigating" || state === "validating" || state === "extracting") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-slate-200 bg-slate-100 text-slate-800";
}

function outcomeTone(outcome: string | null): string {
  if (outcome === "approved" || outcome === "informal_approval") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (outcome === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }
  if (outcome === "deferred") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function severityTone(severity: string): string {
  if (severity === "error") return "border-rose-200 bg-rose-50 text-rose-900";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function tabTone(active: boolean): string {
  return active
    ? "bg-slate-900 text-white shadow-sm"
    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900";
}

export function MeetingsV2Dashboard({ meetings }: { meetings: MeetingCard[] }) {
  if (meetings.length === 0) {
    return (
      <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
        No V2 meetings exist yet. Uploading a meeting through the current meetings flow will seed a V2 row automatically.
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {meetings.map((meeting) => (
        <Link
          key={meeting.id}
          href={`/operations/meetings/v2/${meeting.id}`}
          className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-6 py-5 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Meeting V2</p>
            <h3 className="mt-2 line-clamp-2 text-lg font-semibold">{meeting.title}</h3>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span>{formatDate(meeting.meetingDate)}</span>
              <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${statusTone(meeting.pipelineState)}`}>
                {startCase(meeting.pipelineState)}
              </span>
            </div>
            <p className="min-h-[3rem] text-sm leading-6 text-slate-600">
              {meeting.currentStep ?? "Ready to start"}
            </p>
            <div className="text-sm font-medium text-slate-900 transition-colors group-hover:text-teal-700">
              Open workspace &rarr;
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function MeetingV2Detail({ meetingId }: { meetingId: string }) {
  const [status, setStatus] = useState<MeetingV2Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftBusy, setDraftBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<V2Tab>("overview");
  const [autonomyTemperature, setAutonomyTemperature] = useState(0.8);
  const [documentsDialogOpen, setDocumentsDialogOpen] = useState(false);
  const [usageDialogOpen, setUsageDialogOpen] = useState(false);
  const [usageStages, setUsageStages] = useState<AiUsageStageRow[] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    if (!usageDialogOpen) return;

    let active = true;
    setUsageLoading(true);

    async function loadUsage() {
      try {
        const response = await fetch(`/api/v2/meetings/${meetingId}/ai-usage`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { stages: AiUsageStageRow[] };
        if (active) {
          setUsageStages(payload.stages ?? []);
        }
      } finally {
        if (active) {
          setUsageLoading(false);
        }
      }
    }

    void loadUsage();

    return () => {
      active = false;
    };
  }, [meetingId, usageDialogOpen]);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      const response = await fetch(`/api/v2/meetings/${meetingId}/status`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as MeetingV2Status;
      if (active) {
        setStatus(payload);
        setLoading(false);
      }
    }

    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [meetingId]);

  async function handleRunPipeline() {
    setRunBusy(true);
    try {
      await fetch("/api/v2/meetings/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, autonomyTemperature }),
      });
    } finally {
      setRunBusy(false);
    }
  }

  async function handleRestartPipeline() {
    const confirmed = window.confirm("Are you sure you want to restart from scratch? This will wipe all extracted data, investigations, and drafts for this meeting.");
    if (!confirmed) return;
    setRunBusy(true);
    try {
      await fetch("/api/v2/meetings/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, autonomyTemperature }),
      });
    } finally {
      setRunBusy(false);
    }
  }

  async function handleGenerateDraft() {
    setDraftBusy(true);
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}/draft`, {
        method: "POST",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        success: boolean;
        draft: MeetingV2Status["latestDraft"];
      };
      if (payload.draft) {
        setStatus((current) => (current ? { ...current, latestDraft: payload.draft } : current));
        setActiveTab("draft");
      }
    } finally {
      setDraftBusy(false);
    }
  }

  const progress = status?.meeting.progressPercent ?? 0;
  const displayState = status?.meeting.computedPipelineState ?? status?.meeting.pipelineState ?? "created";
  const displayStep =
    status && status.meeting.integrity.isConsistent
      ? status.meeting.currentStep ?? status.meeting.computedCurrentStep
      : status?.meeting.computedCurrentStep ?? status?.meeting.currentStep ?? "Waiting for first run";
  const displayProgress =
    status && status.meeting.integrity.isConsistent
      ? progress
      : status?.meeting.computedPipelineState === "gathering_evidence"
        ? 55
        : status?.meeting.computedPipelineState === "investigating"
          ? 75
          : status?.meeting.computedPipelineState === "validating"
            ? 90
            : status?.meeting.computedPipelineState === "extracting"
              ? 30
              : status?.meeting.computedPipelineState === "ingesting"
                ? 10
                : progress;
  const hasSuccessfulRun = displayState === "validated";
  const hasMeetingDocuments = Boolean(
    status?.sources.transcript?.available || status?.sources.boardPackage?.available,
  );
  const pipelineSourcesReady = Boolean(
    status?.sources.transcript?.available && status?.sources.boardPackage?.available,
  );
  const pipelineDisabledReason = !status
    ? "Loading meeting sources…"
    : !status.sources.transcript?.available && !status.sources.boardPackage?.available
      ? "Transcript and board package are not available on this machine."
      : !status.sources.transcript?.available
        ? "Transcript file is not available on this machine."
        : !status.sources.boardPackage?.available
          ? "Board package is not available on this machine."
          : null;
  const reviewableItems = status?.items ?? [];
  const needsClarificationCount = reviewableItems.filter((item) => item.openQuestions.length > 0).length;
  const flaggedCount = reviewableItems.filter((item) =>
    item.validation.some((validation) => validation.severity === "error" || validation.severity === "warning"),
  ).length;
  const readyCount = reviewableItems.filter(
    (item) => item.openQuestions.length === 0 && !item.validation.some(v => v.severity === "error" || v.severity === "warning"),
  ).length;
  const pipelineHalted = Boolean(
    status?.meeting.alerts.some((alert) => alert.blocksPipeline || alert.severity === "error"),
  );
  const pipelineNotStarted =
    displayState === "created" ||
    status?.meeting.pipelineState === "created" ||
    status?.meeting.currentStep === "Ready to start";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/operations/meetings?v=2"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
        >
          <span>&larr;</span>
          <span>Back to V2 meetings</span>
        </Link>
        <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          Meetings V2 Workspace
        </span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          className={`border-b border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-4 py-4 text-white rounded-t-2xl ${
            hasSuccessfulRun ? "" : "rounded-b-2xl border-b-0"
          }`}
        >
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="shrink-0 space-y-2">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  {status?.meeting.title ?? "Loading meeting"}
                </h1>
                <p className="mt-0.5 text-sm text-white/65">
                  {status ? formatDate(status.meeting.meetingDate) : "Loading date"}
                </p>
              </div>
              <div className="flex flex-col gap-0.5 pt-1">
                <label htmlFor="temp-slider" className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
                  AI Autonomy: {autonomyTemperature.toFixed(1)}
                </label>
                <input
                  id="temp-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={autonomyTemperature}
                  onChange={(e) => setAutonomyTemperature(parseFloat(e.target.value))}
                  className="w-28 accent-teal-400"
                  title="0 = Always ask user | 1 = Fully autonomous"
                />
              </div>
              {hasSuccessfulRun ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <SummaryStat label="Agenda Items" value={String(status?.meeting.counts.agendaItems ?? 0)} />
                  <SummaryStat label="Items Flagged" value={String(flaggedCount)} />
                  <SummaryStat label="Latest Drafts" value={String(status?.meeting.counts.drafts ?? 0)} />
                </div>
              ) : null}
            </div>

            <div className="w-full max-w-md rounded-xl border border-white/10 bg-black/15 p-3 xl:mx-4 xl:flex-1">
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium text-white/80">Current Progress</span>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                    pipelineHalted
                      ? "border-rose-300 bg-rose-600 text-white"
                      : "border-white/20 bg-white/10 text-white/90"
                  }`}
                >
                  {pipelineHalted && displayState !== "failed"
                    ? `Stopped · ${startCase(displayState)}`
                    : startCase(displayState)}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-teal-400 transition-all"
                  style={{ width: `${displayProgress}%` }}
                />
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <p className="text-xs text-white/70">{displayStep}</p>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-white/90">
                  {displayProgress}%
                </span>
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
              {hasMeetingDocuments ? (
                <button
                  className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
                  onClick={() => setDocumentsDialogOpen(true)}
                  type="button"
                >
                  Meeting Documents
                </button>
              ) : null}
              <div className="flex items-center gap-2">
                <AiUsageIconButton
                  tone="inverse"
                  onClick={() => setUsageDialogOpen(true)}
                  title="View AI usage and cost"
                />
                <PipelineActionButton
                  runBusy={runBusy}
                  pipelineNotStarted={pipelineNotStarted}
                  disabled={!pipelineSourcesReady}
                  disabledReason={pipelineDisabledReason}
                  onRun={handleRunPipeline}
                  onRestart={handleRestartPipeline}
                />
              </div>
              {status?.latestDraft ? (
                <a
                  href={`/api/v2/meetings/${meetingId}/draft/file?download=1`}
                  className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white px-3 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                >
                  Download PDF
                </a>
              ) : null}
            </div>
          </div>
        </div>

        {hasSuccessfulRun ? (
          <div className="rounded-b-2xl px-3 py-2 sm:px-4">
            <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-50 p-1">
              {([
                ["overview", "Overview"],
                ["review", "Agenda Review"],
                ["draft", "Draft Preview"],
                ["pipeline", "Pipeline"],
              ] as Array<[V2Tab, string]>).map(([tab, label]) => (
                <button
                  key={tab}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tabTone(activeTab === tab)}`}
                  onClick={() => setActiveTab(tab)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {status?.meeting.alerts.length ? (
        <MeetingV2AlertsPanel alerts={status.meeting.alerts} />
      ) : null}
      {status && shouldShowExtractionShapeComparison(status.meeting.extractionQuality.issueCode) ? (
        <ExtractionShapeComparison status={status} />
      ) : null}

      <div className="space-y-4">
        {loading && !status ? <LoadingWorkspace /> : null}
        {status ? (
          <>
            {hasSuccessfulRun ? (
              <>
                {activeTab === "overview" ? (
                  <OverviewPanel
                    readyCount={readyCount}
                    flaggedCount={flaggedCount}
                    needsClarificationCount={needsClarificationCount}
                    status={status}
                    onOpenDocuments={() => setDocumentsDialogOpen(true)}
                  />
                ) : null}
                {activeTab === "review" ? (
                  <AgendaReviewPanel meetingId={meetingId} status={status} />
                ) : null}
                {activeTab === "draft" ? (
                  <DraftWorkspacePanel
                    meetingId={meetingId}
                    draft={status.latestDraft}
                    draftBusy={draftBusy}
                    onGenerateDraft={handleGenerateDraft}
                  />
                ) : null}
                {activeTab === "pipeline" ? <PipelinePanel status={status} /> : null}
              </>
            ) : (
              <PreRunPanel
                status={status}
                pipelineHalted={pipelineHalted}
                onOpenDocuments={() => setDocumentsDialogOpen(true)}
              />
            )}
          </>
        ) : null}
      </div>

      <MeetingDocumentsDialog
        open={documentsDialogOpen}
        meetingId={meetingId}
        transcriptFileName={status?.sources.transcript?.fileName}
        hasTranscript={Boolean(status?.sources.transcript?.available)}
        hasBoardPackage={Boolean(status?.sources.boardPackage?.available)}
        onClose={() => setDocumentsDialogOpen(false)}
      />
      <AiUsageDialog
        open={usageDialogOpen}
        stages={usageStages}
        loading={usageLoading}
        onClose={() => setUsageDialogOpen(false)}
      />
    </div>
  );
}

function PipelineActionButton({
  runBusy,
  pipelineNotStarted,
  disabled = false,
  disabledReason,
  onRun,
  onRestart,
}: {
  runBusy: boolean;
  pipelineNotStarted: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  onRun: () => void;
  onRestart: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDisabled = runBusy || disabled;

  useEffect(() => {
    if (!menuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (isDisabled) setMenuOpen(false);
  }, [isDisabled]);

  const primaryLabel = runBusy
    ? pipelineNotStarted
      ? "Starting..."
      : "Resuming..."
    : pipelineNotStarted
      ? "Start Pipeline"
      : "Resume Pipeline";

  const title = isDisabled && disabledReason ? disabledReason : undefined;

  return (
    <div className="relative" ref={containerRef} title={title}>
      <div className="inline-flex overflow-hidden rounded-lg shadow-md">
        <button
          className="inline-flex items-center bg-teal-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isDisabled}
          onClick={onRun}
          type="button"
          title={title}
        >
          {primaryLabel}
        </button>
        <button
          className="inline-flex items-center border-l border-teal-600/30 bg-teal-500 px-2 py-2 text-slate-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isDisabled}
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="More pipeline actions"
          title={title}
        >
          <ChevronDownIcon />
        </button>
      </div>
      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            role="menuitem"
            type="button"
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setMenuOpen(false);
              onRestart();
            }}
          >
            Restart from Beginning
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg aria-hidden className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function MeetingV2AlertsPanel({ alerts }: { alerts: MeetingV2Alert[] }) {
  const blockedCount = alerts.filter(
    (alert) => alert.blocksPipeline || alert.severity === "error",
  ).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <p
            className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${
              blockedCount > 0 ? "text-rose-800" : "text-amber-800"
            }`}
          >
            {blockedCount > 0 ? "Pipeline stopped" : "Pipeline notices"}
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Newest first · {alerts.length} {alerts.length === 1 ? "issue" : "issues"}
          </p>
        </div>
      </div>
      {alerts.map((alert, index) => {
        const stopped = alert.severity === "error" || Boolean(alert.blocksPipeline);
        return (
          <div
            key={alert.id}
            className={`rounded-xl border px-4 py-3 text-sm ${
              stopped
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : alert.severity === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-slate-200 bg-slate-50 text-slate-800"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              {index === 0 ? (
                <span className="rounded-full bg-rose-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                  Latest
                </span>
              ) : null}
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  stopped ? "bg-rose-200 text-rose-950" : "bg-amber-200 text-amber-950"
                }`}
              >
                {stopped ? "Stopped" : startCase(alert.severity)}
              </span>
              {alert.occurredAt ? (
                <span className="text-xs opacity-80">{formatDateTime(alert.occurredAt)}</span>
              ) : null}
            </div>
            <p className="mt-2 font-semibold">{alert.title}</p>
            <p className="mt-1.5 leading-5">{alert.summary}</p>
            {alert.likelyCause ? (
              <p className="mt-3 leading-6">
                <span className="font-semibold">Likely cause:</span> {alert.likelyCause}
              </p>
            ) : null}
            {alert.recommendedAction ? (
              <p className="mt-2 leading-6">
                <span className="font-semibold">Recommended action:</span>{" "}
                {alert.recommendedAction}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function formatExtractionQualitySummary(quality: MeetingV2ExtractionQuality): string {
  if (!quality.likelyIncomplete) {
    return quality.note;
  }

  const extractorLabel =
    quality.extractorUsed === "deepseek_incremental"
      ? "DeepSeek semantic extraction"
      : quality.extractorUsed === "section_fallback"
        ? "PDF section fallback"
        : quality.extractorUsed === "none"
          ? "No extractor run yet"
          : "Unknown extractor";

  return `${extractorLabel}. ${quality.note}`;
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function SectionCard({
  eyebrow,
  title,
  description,
  children,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${compact ? "p-4" : "p-5"}`}>
      <div className={`space-y-1 ${compact ? "mb-3" : "mb-4"}`}>
        {eyebrow ? (
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</p>
        ) : null}
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">{title}</h2>
        {description ? <p className="text-sm leading-5 text-slate-600">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function PreRunPanel({
  status,
  pipelineHalted,
  onOpenDocuments,
}: {
  status: MeetingV2Status;
  pipelineHalted: boolean;
  onOpenDocuments: () => void;
}) {
  const hasDocuments = Boolean(
    status.sources.transcript?.available || status.sources.boardPackage?.available,
  );

  return (
    <SectionCard
      eyebrow="Status"
      title={pipelineHalted ? "Pipeline stopped" : "Pipeline not complete"}
      description={
        pipelineHalted
          ? "The pipeline did not finish successfully. Review the alerts above, then resume or restart the run."
          : "The meeting workspace is set up but the pipeline has not reached validation yet. Start or resume the run to continue."
      }
      compact
    >
      <div className="grid gap-3 md:grid-cols-2">
        <HealthCallout
          label="Pipeline status"
          value={startCase(status.meeting.computedPipelineState)}
          tone={statusTone(status.meeting.computedPipelineState)}
          note={status.meeting.computedCurrentStep}
        />
        <HealthCallout
          label="Extraction quality"
          value={
            status.meeting.extractionQuality.likelyIncomplete || pipelineHalted
              ? "Needs attention"
              : "In progress"
          }
          tone={
            status.meeting.extractionQuality.likelyIncomplete || pipelineHalted
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-slate-200 bg-slate-50 text-slate-700"
          }
          note={formatExtractionQualitySummary(status.meeting.extractionQuality)}
        />
      </div>

      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Source files
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          {status.sources.transcript ? (
            <span className="rounded-md bg-white px-2 py-1 font-mono text-xs">
              {status.sources.transcript.fileName}
            </span>
          ) : null}
          {status.sources.boardPackage ? (
            <span className="rounded-md bg-white px-2 py-1 font-mono text-xs">
              {status.sources.boardPackage.fileName}
            </span>
          ) : null}
          {!hasDocuments ? <span>No documents on file.</span> : null}
        </div>
        {hasDocuments ? (
          <button
            type="button"
            onClick={onOpenDocuments}
            className="mt-2 text-sm font-medium text-teal-700 hover:text-teal-800"
          >
            Open meeting documents &rarr;
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <DiagnosticTile label="Transcript segments" value={String(status.meeting.counts.transcriptSegments)} />
        <DiagnosticTile label="Document pages" value={String(status.meeting.counts.documentPages)} />
        <DiagnosticTile label="Agenda items extracted" value={String(status.meeting.counts.agendaItems)} />
        <DiagnosticTile label="Source artifacts" value={String(status.meeting.counts.sourceArtifacts)} />
      </div>
    </SectionCard>
  );
}

function OverviewPanel({
  status,
  needsClarificationCount,
  flaggedCount,
  readyCount,
  onOpenDocuments,
}: {
  status: MeetingV2Status;
  needsClarificationCount: number;
  flaggedCount: number;
  readyCount: number;
  onOpenDocuments: () => void;
}) {
  const hasDocuments = Boolean(
    status.sources.transcript?.available || status.sources.boardPackage?.available,
  );

  return (
    <SectionCard
      eyebrow="Overview"
      title="Meeting status & readiness"
      description="Pipeline health, source coverage, and review readiness in one place."
      compact
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="grid gap-3 sm:grid-cols-2">
          <HealthCallout
            label="Pipeline status"
            value={startCase(status.meeting.computedPipelineState)}
            tone={statusTone(status.meeting.computedPipelineState)}
            note={status.meeting.computedCurrentStep}
          />
          <HealthCallout
            label="Extraction quality"
            value={status.meeting.extractionQuality.likelyIncomplete ? "Blocked" : "Looks healthy"}
            tone={
              status.meeting.extractionQuality.likelyIncomplete
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }
            note={formatExtractionQualitySummary(status.meeting.extractionQuality)}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <MetricTile label="Needs clarification" value={String(needsClarificationCount)} detail="Open questions." />
          <MetricTile label="Review required" value={String(flaggedCount)} detail="Validation flags." />
          <MetricTile label="Ready items" value={String(readyCount)} detail="No flags or questions." />
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <DiagnosticTile label="Source artifacts" value={String(status.meeting.counts.sourceArtifacts)} />
        <DiagnosticTile label="Transcript segments" value={String(status.meeting.counts.transcriptSegments)} />
        <DiagnosticTile label="Document pages" value={String(status.meeting.counts.documentPages)} />
        <DiagnosticTile label="Document chunks" value={String(status.meeting.counts.documentChunks)} />
      </div>

      {hasDocuments ? (
        <button
          type="button"
          onClick={onOpenDocuments}
          className="mt-3 text-sm font-medium text-teal-700 hover:text-teal-800"
        >
          Open meeting documents &rarr;
        </button>
      ) : null}
    </SectionCard>
  );
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p>
    </div>
  );
}

function HealthCallout({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone: string;
  note: string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tone}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-80">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      <p className="mt-1 text-xs leading-5 opacity-90">{note}</p>
    </div>
  );
}

function AgendaReviewPanel({
  meetingId,
  status,
}: {
  meetingId: string;
  status: MeetingV2Status;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dirtyItems, setDirtyItems] = useState<Record<string, boolean>>({});
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  useEffect(() => {
    setAnswers((current) => {
      const nextAnswers = { ...current };
      for (const item of status.items) {
        if (!dirtyItems[item.id]) {
          nextAnswers[item.id] = item.userAnswers?.text ?? "";
        }
      }
      return nextAnswers;
    });
    if (!openItemId && status.items.length > 0) {
      setOpenItemId(status.items[0].id);
    }
  }, [dirtyItems, openItemId, status]);

  async function handleSubmit(itemId: string) {
    setBusyItemId(itemId);
    try {
      await fetch(`/api/v2/meetings/${meetingId}/items/${itemId}/re-evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAnswers: { text: answers[itemId] ?? "" } }),
      });
      setDirtyItems((current) => ({
        ...current,
        [itemId]: false,
      }));
    } finally {
      setBusyItemId(null);
    }
  }

  const canReviewItems = status.meeting.computedPipelineState === "validated";

  if (!canReviewItems) {
    return (
      <SectionCard
        eyebrow="Agenda Review"
        title="Agenda items will appear here after validation"
        description="The review workspace becomes active only after evidence gathering, investigation, and validation are fully complete."
      >
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-sm text-slate-600">
          Continue the pipeline until the meeting reaches the validated state. Once that happens, each agenda item will be available for clarification and targeted re-evaluation.
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      eyebrow="Agenda Review"
      title="Review agenda items and resolve open questions"
      description="This is the primary working area for V2. Review one item at a time, answer clarifications when needed, and re-run only the affected item."
    >
      <div className="space-y-4">
        {status.items.map((item) => {
          const isOpen = openItemId === item.id;
          const hasFlags = item.validation.some(v => v.severity === "error" || v.severity === "warning");
          return (
            <div
              key={item.id}
              className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-slate-50"
            >
              <button
                className="flex w-full flex-col gap-4 px-5 py-5 text-left transition hover:bg-slate-100/70 lg:flex-row lg:items-start lg:justify-between"
                onClick={() => setOpenItemId((current) => (current === item.id ? null : item.id))}
                type="button"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-950">
                      {item.itemNumber ? `${item.itemNumber}. ` : ""}
                      {item.title}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${outcomeTone(item.outcome)}`}>
                      {startCase(item.outcome ?? "pending")}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                      {item.confidence ? startCase(item.confidence) : "Unknown Confidence"}
                    </span>
                  </div>
                  <p className="max-w-3xl text-sm leading-6 text-slate-600">
                    {item.discussionSummary ?? "No investigation summary yet."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <span>{item.openQuestions.length} open</span>
                  <span>{item.validation.filter(v => v.severity === "error" || v.severity === "warning").length} flags</span>
                  <span>{isOpen ? "Collapse" : "Expand"}</span>
                </div>
              </button>

              {isOpen ? (
                <div className="border-t border-slate-200 bg-white px-5 py-5">
                  {hasFlags ? (
                    <div className="mb-4 space-y-2">
                      {item.validation.map((validation) => (
                        <div
                          key={`${item.id}-${validation.code}`}
                          className={`rounded-2xl border px-4 py-3 text-sm ${severityTone(validation.severity)}`}
                        >
                          <div className="font-medium">{validation.message}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                      This item currently has no validation flags.
                    </div>
                  )}

                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)]">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Open Questions
                        </h4>
                        {item.openQuestions.length > 0 ? (
                          <div className="space-y-2 text-sm leading-6 text-slate-700">
                            {item.openQuestions.map((question, index) => (
                              <p key={`${item.id}-question-${index}`}>{question}</p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-slate-600">No open questions on this item.</p>
                        )}
                      </div>

                      <div className="space-y-3">
                        <label
                          htmlFor={`clarification-${item.id}`}
                          className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500"
                        >
                          Clarification
                        </label>
                        <textarea
                          id={`clarification-${item.id}`}
                          className="min-h-32 w-full rounded-2xl border border-slate-300 bg-slate-50 p-4 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                          onChange={(event) => {
                            setDirtyItems((current) => ({
                              ...current,
                              [item.id]: true,
                            }));
                            setAnswers((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }));
                          }}
                          placeholder="Add a precise clarification for this agenda item if needed..."
                          value={answers[item.id] ?? ""}
                        />
                        <div className="flex items-center gap-3">
                          <button
                            className="inline-flex items-center rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={busyItemId === item.id}
                            onClick={() => void handleSubmit(item.id)}
                            type="button"
                          >
                            {busyItemId === item.id ? "Submitting..." : "Submit & Re-evaluate"}
                          </button>
                          {dirtyItems[item.id] ? (
                            <span className="text-sm text-slate-500">Unsaved clarification</span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
                      <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Review Snapshot
                      </h4>
                      <dl className="mt-4 space-y-3 text-sm">
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-slate-500">Item type</dt>
                          <dd className="font-medium text-slate-900">{startCase(item.itemType)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-slate-500">Outcome</dt>
                          <dd className="font-medium text-slate-900">{startCase(item.outcome ?? "pending")}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-slate-500">Confidence</dt>
                          <dd className="font-medium text-slate-900">{startCase(item.confidence ?? "unknown")}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-slate-500">Validation flags</dt>
                          <dd className="font-medium text-slate-900">{item.validation.length}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-slate-500">Open questions</dt>
                          <dd className="font-medium text-slate-900">{item.openQuestions.length}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function PipelinePanel({ status }: { status: MeetingV2Status }) {
  return (
    <div className="space-y-6">
      <SectionCard
        eyebrow="Pipeline"
        title="Stage diagnostics"
        description="Technical details stay here so the main review workspace can stay focused on the meeting output."
      >
        <div className="grid gap-3 xl:grid-cols-5">
          {status.meeting.stages.map((stage) => (
            <div
              key={stage.key}
              className={`rounded-2xl border px-4 py-4 ${stageTone(stage.status)}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{stage.label}</div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                  {startCase(stage.status)}
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
                <div
                  className="h-full rounded-full bg-current opacity-70"
                  style={{ width: `${stage.progressPercent}%` }}
                />
              </div>
              <p className="mt-3 text-sm leading-6">{stage.note}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Diagnostics"
        title="Extraction quality and stored pipeline rows"
        description="These details are useful when auditing extraction quality or checking how much persisted state exists in each stage."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <DiagnosticTile label="Mode" value={startCase(status.meeting.extractionQuality.mode)} />
              <DiagnosticTile
                label="Likely incomplete"
                value={status.meeting.extractionQuality.likelyIncomplete ? "Yes" : "No"}
              />
              <DiagnosticTile
                label="Page-like titles"
                value={String(status.meeting.extractionQuality.pageLikeTitleCount)}
              />
              <DiagnosticTile
                label="Suspicious titles"
                value={String(status.meeting.extractionQuality.suspiciousTitleCount)}
              />
            </div>
            <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-700">
              {status.meeting.extractionQuality.note}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(status.meeting.counts).map(([key, value]) => (
              <DiagnosticTile
                key={key}
                label={key.replaceAll(/([A-Z])/g, " $1")}
                value={String(value)}
              />
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function normalizeAgendaTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/\s+/g, " ");
}

function extractedItemMatchesPdfSection(
  item: MeetingV2Status["items"][number],
  sections: MeetingV2Status["documentSections"],
): boolean {
  if (item.itemType === "agenda_section") return true;
  const normalized = normalizeAgendaTitle(item.title);
  return sections.some((section) => normalizeAgendaTitle(section.title) === normalized);
}

function ExtractionShapeComparison({ status }: { status: MeetingV2Status }) {
  const matchCount = status.items.filter((item) =>
    extractedItemMatchesPdfSection(item, status.documentSections),
  ).length;

  return (
    <SectionCard
      eyebrow="Extraction audit"
      title="What we got vs what a real agenda looks like"
      description="PDF sections are mechanical page splits from ingestion (often one per page). A successful DeepSeek run collapses those into board topics — named motions, ratifications, and presentations — not a page-title list."
    >
      <div
        className={`mb-4 rounded-2xl border px-4 py-3 text-sm leading-6 ${
          matchCount * 2 >= status.items.length && status.items.length > 0
            ? "border-rose-200 bg-rose-50 text-rose-950"
            : "border-slate-200 bg-white text-slate-800"
        }`}
      >
        <span className="font-semibold">
          {matchCount} of {status.items.length} extracted titles
        </span>{" "}
        match a PDF section title.
        {matchCount * 2 >= status.items.length && status.items.length > 0
          ? " When those numbers are close, extraction returned the page scaffold instead of meeting topics."
          : " These titles look like board topics rather than page headings — compare the three columns. The run still halted because most items are linked back to PDF sections."}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <ExtractionListCard
          title="What we got"
          subtitle={`${status.items.length} extracted items · ${startCase(status.meeting.extractionQuality.extractorUsed)}`}
          items={status.items.map((item) => ({
            text: `${item.itemNumber ? `${item.itemNumber}. ` : ""}${item.title}`,
            badge: extractedItemMatchesPdfSection(item, status.documentSections)
              ? "Matches PDF section"
              : undefined,
            tone: extractedItemMatchesPdfSection(item, status.documentSections) ? "match" : "ok",
          }))}
        />
        <ExtractionListCard
          title="PDF sections it currently resembles"
          subtitle={`${status.documentSections.length} page/heading splits`}
          items={status.documentSections.map((section) => ({
            text:
              section.startPage === section.endPage
                ? `p.${section.startPage}: ${section.title}`
                : `pp.${section.startPage}-${section.endPage}: ${section.title}`,
          }))}
        />
        <ExtractionListCard
          title="What it should look like"
          subtitle="Example semantic topics — not this meeting's list"
          items={EXPECTED_SEMANTIC_AGENDA_SHAPE.map((example) => ({
            text: example.title,
            badge: example.why,
            tone: "ok",
          }))}
        />
      </div>
    </SectionCard>
  );
}

function ExtractionListCard({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: Array<{ text: string; badge?: string; tone?: "match" | "ok" }>;
}) {
  return (
    <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-5">
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">{subtitle}</p>
      <ol className="mt-4 max-h-80 space-y-2 overflow-y-auto text-sm leading-6 text-slate-700">
        {items.length === 0 ? (
          <li className="text-slate-500">None yet.</li>
        ) : (
          items.map((item, index) => (
            <li
              key={`${index}-${item.text}`}
              className={`rounded-xl px-3 py-2 ${
                item.tone === "match"
                  ? "border border-rose-200 bg-rose-50 text-rose-950"
                  : "bg-white"
              }`}
            >
              <span>{item.text}</span>
              {item.badge ? (
                <span
                  className={`mt-1 block text-[11px] font-medium uppercase tracking-[0.12em] ${
                    item.tone === "match" ? "text-rose-800" : "text-slate-500"
                  }`}
                >
                  {item.badge}
                </span>
              ) : null}
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

function DiagnosticTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {startCase(label)}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function DraftWorkspacePanel({
  meetingId,
  draft,
  draftBusy,
  onGenerateDraft,
}: {
  meetingId: string;
  draft: MeetingV2Status["latestDraft"] | null;
  draftBusy: boolean;
  onGenerateDraft: () => void;
}) {
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  return (
    <SectionCard
      eyebrow="Draft"
      title="Minutes draft"
      description="After validation, generate a formatted minutes document from the pipeline output. Edit here or preview the PDF layout."
      compact
    >
      {!draft ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
          <p className="text-sm text-slate-600">
            No draft has been generated yet. The pipeline builds the content during validation — this step formats it into editable minutes.
          </p>
          <button
            type="button"
            onClick={onGenerateDraft}
            disabled={draftBusy}
            className="mt-3 inline-flex items-center rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {draftBusy ? "Generating..." : "Generate minutes draft"}
          </button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-slate-600">Edit the draft or preview the PDF layout.</span>
            <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <button
                onClick={() => setEditorMode("edit")}
                className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider transition ${editorMode === "edit" ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                Editor
              </button>
              <button
                onClick={() => setEditorMode("preview")}
                className={`border-l border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-wider transition ${editorMode === "preview" ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                PDF Preview
              </button>
            </div>
          </div>
          <DraftPreviewBody meetingId={meetingId} draft={draft} mode={editorMode} heightClassName="h-[65dvh] min-h-[32rem]" />
        </>
      )}
    </SectionCard>
  );
}

function DraftPreviewBody({
  meetingId,
  draft,
  mode,
  heightClassName,
}: {
  meetingId: string;
  draft: MeetingV2Status["latestDraft"] | null;
  mode: "edit" | "preview";
  heightClassName: string;
}) {
  const [doc, setDoc] = useState<MinutesDocumentV2 | null>(null);
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const [attendeesDialogOpen, setAttendeesDialogOpen] = useState(false);

  function handleSaveAttendees(
    attendance: Pick<EditableAttendance, "present" | "byInvitation" | "regrets" | "guests">,
  ) {
    if (!doc) return;
    const updatedDoc = { ...doc, attendance };
    handleDocChange(updatedDoc);
    setAttendeesDialogOpen(false);
  }

  useEffect(() => {
    if (draft?.json) {
      try {
        const parsed = JSON.parse(draft.json);
        const actualDoc = parsed.minutesV2?.data || parsed.data || parsed;
        setDoc(actualDoc);
      } catch (e) {
        console.error("Failed to parse draft JSON", e);
      }
    }
  }, [draft?.id]); // only re-run when a NEW draft is generated

  function handleDocChange(updated: MinutesDocumentV2) {
    setDoc(updated);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    
    saveTimeout.current = setTimeout(() => {
      const summaryJson = serializeMinutesDoc(updated);
      const contentMarkdown = v2ToMarkdown(updated);
      
      fetch(`/api/v2/meetings/${meetingId}/draft/save`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft!.id, summaryJson, contentMarkdown }),
      }).catch(console.error);
    }, 1000); // 1s debounce
  }

  if (!draft) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-sm text-slate-600">
        No V2 draft has been generated yet. Once validation is complete, generate a draft to see the PDF preview here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-50 px-4 py-4">
        <div className="text-sm font-semibold text-slate-950">{draft.title}</div>
        <div className="mt-1 text-sm text-slate-500">Updated {formatDateTime(draft.updatedAt)}</div>
      </div>
      
      {mode === "edit" && doc ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <MinutesStructuredEditor
            doc={doc}
            onDocChange={handleDocChange}
            onOpenAttendeesDialog={() => setAttendeesDialogOpen(true)}
          />
          <AttendeesEditorDialog
            open={attendeesDialogOpen}
            attendance={{ ...doc.attendance, schemaVersion: "v2" }}
            onClose={() => setAttendeesDialogOpen(false)}
            onSave={handleSaveAttendees}
          />
        </div>
      ) : null}

      {mode === "preview" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <iframe
            key={draft.id + doc?.metadata.meetingDate} // force refresh if needed
            title={`${draft.title} PDF preview`}
            src={`/api/v2/meetings/${meetingId}/draft/file`}
            className={`${heightClassName} w-full bg-white`}
          />
        </div>
      ) : null}
    </div>
  );
}

function LoadingWorkspace() {
  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="h-5 w-32 rounded bg-slate-100" />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="h-28 rounded-2xl bg-slate-100" />
          <div className="h-28 rounded-2xl bg-slate-100" />
          <div className="h-28 rounded-2xl bg-slate-100" />
        </div>
      </div>
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="h-5 w-40 rounded bg-slate-100" />
        <div className="mt-4 space-y-3">
          <div className="h-24 rounded-2xl bg-slate-100" />
          <div className="h-24 rounded-2xl bg-slate-100" />
        </div>
      </div>
    </div>
  );
}
