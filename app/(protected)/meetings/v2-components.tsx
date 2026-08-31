"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

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
    extractionQuality: {
      mode: "semantic" | "section_fallback";
      likelyIncomplete: boolean;
      pageLikeTitleCount: number;
      suspiciousTitleCount: number;
      note: string;
    };
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
    format: string;
    createdAt: string;
    updatedAt: string;
  } | null;
};

type V2Tab = "overview" | "review" | "draft" | "pipeline";

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
  const canGenerateDraft = displayState === "validated";
  const reviewableItems = status?.items ?? [];
  const needsClarificationCount = reviewableItems.filter((item) => item.openQuestions.length > 0).length;
  const flaggedCount = reviewableItems.filter((item) =>
    item.validation.some((validation) => validation.severity === "error" || validation.severity === "warning"),
  ).length;
  const readyCount = reviewableItems.filter(
    (item) => item.openQuestions.length === 0 && item.validation.length === 0,
  ).length;

  return (
    <div className="space-y-6">
      <Link
        href="/operations/meetings?v=2"
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
      >
        <span>&larr;</span>
        <span>Back to V2 meetings</span>
      </Link>

      <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-6 text-white">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
                  Meetings V2 Workspace
                </span>
                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusTone(displayState)}`}>
                  {startCase(displayState)}
                </span>
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  {status?.meeting.title ?? "Loading meeting"}
                </h1>
                <p className="mt-1 text-sm text-white/65">
                  {status ? formatDate(status.meeting.meetingDate) : "Loading date"}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryStat label="Agenda Items" value={String(status?.meeting.counts.agendaItems ?? 0)} />
                <SummaryStat label="Items Flagged" value={String(flaggedCount)} />
                <SummaryStat label="Latest Drafts" value={String(status?.meeting.counts.drafts ?? 0)} />
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:items-end">
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex flex-col gap-1 mr-2">
                  <label htmlFor="temp-slider" className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
                    AI Autonomy: {autonomyTemperature.toFixed(1)}
                  </label>
                  <input 
                    id="temp-slider"
                    type="range" 
                    min="0" max="1" step="0.1"
                    value={autonomyTemperature}
                    onChange={(e) => setAutonomyTemperature(parseFloat(e.target.value))}
                    className="w-32 accent-teal-400" 
                    title="0 = Always ask user | 1 = Fully autonomous"
                  />
                </div>
                <button
                  className="inline-flex items-center rounded-xl bg-teal-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-md transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={runBusy}
                  onClick={handleRunPipeline}
                  type="button"
                >
                  {runBusy ? "Starting..." : "Run / Resume Pipeline"}
                </button>
                <button
                  className="inline-flex items-center rounded-xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canGenerateDraft || draftBusy}
                  onClick={handleGenerateDraft}
                  type="button"
                >
                  {draftBusy ? "Generating..." : "Generate Draft"}
                </button>
                {status?.latestDraft ? (
                  <a
                    href={`/api/v2/meetings/${meetingId}/draft/file?download=1`}
                    className="inline-flex items-center rounded-xl border border-white/15 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                  >
                    Download PDF
                  </a>
                ) : null}
              </div>
              <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-black/15 p-4">
                <div className="flex items-center justify-between gap-4 text-sm text-white/80">
                  <span className="font-medium">Current Progress</span>
                  <span>{displayProgress}%</span>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-teal-400 transition-all"
                    style={{ width: `${displayProgress}%` }}
                  />
                </div>
                <p className="mt-3 text-sm text-white/70">{displayStep}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 sm:px-6">
          <div className="flex flex-wrap gap-2 rounded-2xl bg-slate-50 p-2">
            {([
              ["overview", "Overview"],
              ["review", "Agenda Review"],
              ["draft", "Draft Preview"],
              ["pipeline", "Pipeline"],
            ] as Array<[V2Tab, string]>).map(([tab, label]) => (
              <button
                key={tab}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${tabTone(activeTab === tab)}`}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {status && !status.meeting.integrity.isConsistent ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          {status.meeting.integrity.note}
        </div>
      ) : null}

      {status?.meeting.lastError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
          {status.meeting.lastError}
        </div>
      ) : null}

      <div className="space-y-6">
        {loading && !status ? <LoadingWorkspace /> : null}
        {status ? (
          <>
            {activeTab === "overview" ? (
              <OverviewPanel
                readyCount={readyCount}
                flaggedCount={flaggedCount}
                needsClarificationCount={needsClarificationCount}
                status={status}
              />
            ) : null}
            {activeTab === "review" ? (
              <AgendaReviewPanel meetingId={meetingId} status={status} />
            ) : null}
            {activeTab === "draft" ? (
              <DraftWorkspacePanel meetingId={meetingId} draft={status.latestDraft} />
            ) : null}
            {activeTab === "pipeline" ? <PipelinePanel status={status} /> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">{label}</div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function SectionCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 space-y-2">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
        ) : null}
        <h2 className="text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
        {description ? <p className="text-sm leading-6 text-slate-600">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function OverviewPanel({
  status,
  needsClarificationCount,
  flaggedCount,
  readyCount,
}: {
  status: MeetingV2Status;
  needsClarificationCount: number;
  flaggedCount: number;
  readyCount: number;
}) {
  return (
    <div className="space-y-6">
      <SectionCard
        eyebrow="Workflow"
        title="Meeting Readiness"
        description="This workspace follows the meeting from ingestion through review. The summary below keeps the operational state visible without pushing the document work off the page."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <MetricTile label="Needs clarification" value={String(needsClarificationCount)} detail="Agenda items with open questions for the user." />
          <MetricTile label="Review required" value={String(flaggedCount)} detail="Items with validator warnings or errors." />
          <MetricTile label="Ready items" value={String(readyCount)} detail="Items with no open questions and no validation flags." />
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Current State"
        title="Health Summary"
        description="A compact reading of the current run so someone opening the page can immediately tell whether the meeting is still processing, review-ready, or blocked."
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="grid gap-4 md:grid-cols-2">
            <HealthCallout
              label="Pipeline status"
              value={startCase(status.meeting.computedPipelineState)}
              tone={statusTone(status.meeting.computedPipelineState)}
              note={status.meeting.computedCurrentStep}
            />
            <HealthCallout
              label="Extraction quality"
              value={status.meeting.extractionQuality.likelyIncomplete ? "Needs attention" : "Looks healthy"}
              tone={
                status.meeting.extractionQuality.likelyIncomplete
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900"
              }
              note={status.meeting.extractionQuality.note}
            />
          </div>
          <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Source Coverage
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <DiagnosticTile label="Source artifacts" value={String(status.meeting.counts.sourceArtifacts)} />
              <DiagnosticTile label="Transcript segments" value={String(status.meeting.counts.transcriptSegments)} />
              <DiagnosticTile label="Document pages" value={String(status.meeting.counts.documentPages)} />
              <DiagnosticTile label="Document chunks" value={String(status.meeting.counts.documentChunks)} />
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              This gives the operator a quick sense of whether the uploaded transcript and package were fully carried into the meeting workspace before extraction and review.
            </p>
          </div>
        </div>
      </SectionCard>

    </div>
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
    <div className="rounded-2xl bg-slate-50 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
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
    <div className={`rounded-2xl border px-5 py-4 ${tone}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-80">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      <p className="mt-2 text-sm leading-6 opacity-90">{note}</p>
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
          const hasFlags = item.validation.length > 0;
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
                  <span>{item.validation.length} flags</span>
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

function DiagnosticTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {startCase(label)}
      </div>
      <div className="mt-2 text-xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function DraftWorkspacePanel({
  meetingId,
  draft,
}: {
  meetingId: string;
  draft: MeetingV2Status["latestDraft"] | null;
}) {
  return (
    <SectionCard
      eyebrow="Draft"
      title="Minutes draft preview"
      description="The latest generated draft appears here in the same workspace so the meeting review and document review stay connected."
    >
      <DraftPreviewBody meetingId={meetingId} draft={draft} heightClassName="h-[70dvh] min-h-[42rem]" />
    </SectionCard>
  );
}

function DraftPreviewBody({
  meetingId,
  draft,
  heightClassName,
}: {
  meetingId: string;
  draft: MeetingV2Status["latestDraft"] | null;
  heightClassName: string;
}) {
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
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        <iframe
          key={draft.id}
          title={`${draft.title} PDF preview`}
          src={`/api/v2/meetings/${meetingId}/draft/file`}
          className={`${heightClassName} w-full bg-white`}
        />
      </div>
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
