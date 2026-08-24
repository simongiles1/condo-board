"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function stageTone(status: "complete" | "in_progress" | "incomplete"): string {
  if (status === "complete") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "in_progress") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function MeetingsV2Dashboard({ meetings }: { meetings: MeetingCard[] }) {
  if (meetings.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
        No V2 meetings exist yet. Uploading a meeting through the current meetings flow will seed a V2 row automatically.
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {meetings.map((meeting) => (
        <Link
          key={meeting.id}
          href={`/operations/meetings/v2/${meeting.id}`}
          className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-shadow hover:shadow-md"
        >
          <h3 className="font-semibold text-slate-900">{meeting.title}</h3>
          <p className="mt-1 text-sm text-slate-500">{formatDate(meeting.meetingDate)}</p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {meeting.pipelineState.replaceAll("_", " ")}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {meeting.currentStep ?? "Ready to start"}
          </p>
        </Link>
      ))}
    </div>
  );
}

export function MeetingV2Detail({
  meetingId,
}: {
  meetingId: string;
}) {
  const [status, setStatus] = useState<MeetingV2Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftBusy, setDraftBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);

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
        body: JSON.stringify({ meetingId }),
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
      if (payload.draft && status) {
        setStatus({ ...status, latestDraft: payload.draft });
      }
    } finally {
      setDraftBusy(false);
    }
  }

  const progress = status?.meeting.progressPercent ?? 0;
  const displayState = status?.meeting.computedPipelineState ?? status?.meeting.pipelineState ?? "created";
  const displayStep = status?.meeting.integrity.isConsistent
    ? status.meeting.currentStep ?? status.meeting.computedCurrentStep
    : status?.meeting.computedCurrentStep ?? status?.meeting.currentStep ?? "Waiting for first run";
  const displayProgress = status?.meeting.integrity.isConsistent
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

  return (
    <div className="space-y-6">
      <Link
        href="/operations/meetings?v=2"
        className="flex items-center space-x-1 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
      >
        <span>&larr;</span>
        <span>Back to V2 meetings</span>
      </Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {status?.meeting.title ?? "Loading meeting"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {status ? formatDate(status.meeting.meetingDate) : "Loading date"}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              className="inline-flex items-center rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={runBusy}
              onClick={handleRunPipeline}
              type="button"
            >
              {runBusy ? "Starting..." : "Run / Resume Pipeline"}
            </button>
            <button
              className="inline-flex items-center rounded-xl bg-slate-700 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canGenerateDraft || draftBusy}
              onClick={handleGenerateDraft}
              type="button"
            >
              {draftBusy ? "Generating..." : "Generate Draft"}
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between text-sm text-slate-700">
            <span className="font-medium">Pipeline state</span>
            <span>{displayState.replaceAll("_", " ")}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-teal-600 transition-all"
              style={{ width: `${displayProgress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>{displayStep}</span>
            <span>{displayProgress}%</span>
          </div>
          {status && !status.meeting.integrity.isConsistent ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {status.meeting.integrity.note}
            </p>
          ) : null}
          {status?.meeting.lastError ? (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {status.meeting.lastError}
            </p>
          ) : null}
          {loading ? (
            <p className="text-sm text-slate-500">Loading item details...</p>
          ) : null}
        </div>
      </div>

      <QnASection meetingId={meetingId} status={status} />
      {status ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <h3 className="text-lg font-semibold text-slate-900">Pipeline Stages</h3>
            <p className="text-sm text-slate-500">
              Each stage below reflects stored pipeline data, not just the last written meeting state.
            </p>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-5">
            {status.meeting.stages.map((stage) => (
              <div
                key={stage.key}
                className={`rounded-2xl border px-4 py-4 ${stageTone(stage.status)}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{stage.label}</div>
                  <div className="text-xs uppercase tracking-[0.16em]">
                    {stage.status.replaceAll("_", " ")}
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
        </div>
      ) : null}
      {status ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Extraction Quality</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Mode</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {status.meeting.extractionQuality.mode.replaceAll("_", " ")}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Likely incomplete</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {status.meeting.extractionQuality.likelyIncomplete ? "Yes" : "No"}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Page-like titles</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {status.meeting.extractionQuality.pageLikeTitleCount}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Suspicious titles</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {status.meeting.extractionQuality.suspiciousTitleCount}
              </div>
            </div>
          </div>
          <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {status.meeting.extractionQuality.note}
          </p>
        </div>
      ) : null}
      {status ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Pipeline Rows</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Object.entries(status.meeting.counts).map(([key, value]) => (
              <div key={key} className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {key.replaceAll(/([A-Z])/g, " $1")}
                </div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <DraftSection meetingId={meetingId} draft={status?.latestDraft ?? null} />
    </div>
  );
}

function QnASection({
  meetingId,
  status,
}: {
  meetingId: string;
  status: MeetingV2Status | null;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dirtyItems, setDirtyItems] = useState<Record<string, boolean>>({});
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!status) return;
    setAnswers((current) => {
      const nextAnswers = { ...current };
      for (const item of status.items) {
        if (!dirtyItems[item.id]) {
          nextAnswers[item.id] = item.userAnswers?.text ?? "";
        }
      }
      return nextAnswers;
    });
  }, [dirtyItems, status]);

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

  const items = status?.items ?? [];
  const canReviewItems = status?.meeting.computedPipelineState === "validated";

  if (!canReviewItems) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-sm text-slate-600">
        Agenda items will appear here after evidence gathering, investigation, and validation are fully completed.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Agenda Items</h3>
        <p className="mt-1 text-sm text-slate-500">
          Review each agenda item, answer any open questions, and re-run item validation as needed.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-sm text-slate-600">
          Run the pipeline to populate agenda items.
        </div>
      ) : null}

      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h4 className="font-semibold text-slate-900">
                {item.itemNumber ? `${item.itemNumber}. ` : ""}
                {item.title}
              </h4>
              <p className="mt-1 text-sm text-slate-600">
                {item.discussionSummary ?? "No investigation summary yet."}
              </p>
            </div>
            <div className="text-sm text-slate-600">
              <div>Outcome: {item.outcome ?? "pending"}</div>
              <div>Confidence: {item.confidence ?? "unknown"}</div>
            </div>
          </div>

          {item.validation.length > 0 ? (
            <div className="mt-4 space-y-2">
              {item.validation.map((validation) => (
                <p
                  key={`${item.id}-${validation.code}`}
                  className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700"
                >
                  [{validation.severity}] {validation.message}
                </p>
              ))}
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            {item.openQuestions.length > 0 ? (
              <div className="space-y-2 text-sm text-slate-700">
                {item.openQuestions.map((question, index) => (
                  <p key={`${item.id}-question-${index}`}>{question}</p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-emerald-700">No open questions on this item.</p>
            )}

            <textarea
              className="min-h-28 w-full rounded-xl border border-slate-300 p-3 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
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
              placeholder="Add clarification for this item if needed..."
              value={answers[item.id] ?? ""}
            />
            <button
              className="inline-flex items-center rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busyItemId === item.id}
              onClick={() => void handleSubmit(item.id)}
              type="button"
            >
              {busyItemId === item.id ? "Submitting..." : "Submit & Re-evaluate"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function DraftSection({
  meetingId,
  draft,
}: {
  meetingId: string;
  draft: MeetingV2Status["latestDraft"] | null;
}) {
  if (!draft) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-sm text-slate-600">
        No V2 draft has been generated yet.
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{draft.title}</h3>
          <p className="mt-1 text-sm text-slate-500">
            Updated {formatDate(draft.updatedAt)}
          </p>
        </div>
        <a
          href={`/api/v2/meetings/${meetingId}/draft/file?download=1`}
          className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          Download PDF
        </a>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        <iframe
          key={draft.id}
          title={`${draft.title} PDF preview`}
          src={`/api/v2/meetings/${meetingId}/draft/file`}
          className="h-[70dvh] min-h-[42rem] w-full bg-white"
        />
      </div>
    </div>
  );
}
