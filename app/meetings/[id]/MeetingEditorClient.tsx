"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { AttendeesEditorDialog } from "@/components/AttendeesEditorDialog";
import {
  AiUsageDialog,
  AiUsageIconButton,
} from "@/components/AiUsageDialog";
import {
  ContentTabStrip,
  type TabId,
} from "@/components/ContentTabStrip";
import { CheckOmissionsIconButton } from "@/components/CheckOmissionsIconButton";
import { CopyMarkdownButton } from "@/components/CopyMarkdownButton";
import { DeleteMeetingButton } from "@/components/DeleteMeetingButton";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { MergeToGlobalTodosButton } from "@/components/MergeToGlobalTodosButton";
import { MinutesEditor } from "@/components/MinutesEditor";
import { MinutesStructuredEditor } from "@/components/MinutesStructuredEditor";
import { OmissionsAnalysisDialog } from "@/components/OmissionsAnalysisDialog";
import { PdfExportControls } from "@/components/PdfExportControls";
import { TodosEditor } from "@/components/TodosEditor";
import { VttViewerDialog } from "@/components/VttViewerDialog";
import type { Meeting } from "@/lib/db/types";
import { formatMeetingDate } from "@/lib/format-meeting-date";
import { parseStoredAiUsage, countOmissionsAnalysisRuns } from "@/lib/gemini/usage";
import { loadModelSettings } from "@/lib/settings/model-settings";
import { enhanceMinutesMarkdown } from "@/lib/markdown/enhance-minutes";
import {
  applyAttendanceToMinutesJson,
  extractAttendanceFromMinutesJson,
  type EditableAttendance,
} from "@/lib/minutes/attendance-edit";
import { applyOmissionsToMinutesJson } from "@/lib/minutes/merge-omissions";
import {
  parseStoredOmissionsAnalysis,
  type OmissionFinding,
  type OmissionsAnalysisResult,
  type TodoOmissionFinding,
} from "@/lib/minutes/omissions-schema";
import { applyTodosOmissionsToMarkdown } from "@/lib/todos/merge-omissions";
import { serializeMinutesDoc } from "@/lib/minutes/doc-v2-edits";
import {
  derivedMinutesMarkdown,
  minutesEditorSeedMarkdown,
} from "@/lib/minutes/minutes-editor-seed";
import { parseMinutesJsonEnvelope } from "@/lib/minutes/schema-v2";
import type { MinutesDocumentV2 } from "@/lib/minutes/schema-v2";
import { v2ToMarkdown } from "@/lib/minutes/v2-to-markdown";

function parseMinutesDoc(json: string | null | undefined): MinutesDocumentV2 | null {
  if (!json?.trim()) return null;
  const envelope = parseMinutesJsonEnvelope(json);
  return envelope.version === "v2" && envelope.v2 ? envelope.v2 : null;
}

export default function MeetingEditorClient({ meeting }: { meeting: Meeting }) {
  const router = useRouter();

  const [minutes, setMinutes] = useState(meeting.minutesContent);
  const [todos, setTodos] = useState(meeting.todosContent);
  const [minutesJson, setMinutesJson] = useState(meeting.minutesJson);
  const [minutesDoc, setMinutesDoc] = useState<MinutesDocumentV2 | null>(() =>
    parseMinutesDoc(meeting.minutesJson),
  );
  const [publishedMinutes, setPublishedMinutes] = useState(meeting.minutesContent);
  const [publishedTodos, setPublishedTodos] = useState(meeting.todosContent);

  const [baselineMinutes, setBaselineMinutes] = useState(() =>
    minutesEditorSeedMarkdown(meeting),
  );
  const [baselineTodos, setBaselineTodos] = useState(meeting.todosContent);
  const [minutesReloadVersion, setMinutesReloadVersion] = useState(0);
  const [todosReloadVersion, setTodosReloadVersion] = useState(0);

  const [presentationStatus, setPresentationStatus] = useState(meeting.status);
  const [activeTab, setActiveTab] = useState<TabId>("minutes");

  useEffect(() => {
    setPresentationStatus(meeting.status);
    setPublishedMinutes(meeting.minutesContent);
    setPublishedTodos(meeting.todosContent);
    setBaselineMinutes(minutesEditorSeedMarkdown(meeting));
    setBaselineTodos(meeting.todosContent);
    setMinutes(meeting.minutesContent);
    setTodos(meeting.todosContent);
    setMinutesJson(meeting.minutesJson);
    setMinutesDoc(parseMinutesDoc(meeting.minutesJson));
    setOmissionsAnalysis(parseStoredOmissionsAnalysis(meeting.omissionsAnalysisJson));
    setAiUsage(parseStoredAiUsage(meeting.aiUsageJson));
    setGlobalTodosMergedAt(meeting.globalTodosMergedAt);
  }, [meeting]);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | "draft" | "finalize" | "attendees">(
    null,
  );
  const [attendeesDialogOpen, setAttendeesDialogOpen] = useState(false);
  const [vttDialogOpen, setVttDialogOpen] = useState(false);
  const [usageDialogOpen, setUsageDialogOpen] = useState(false);
  const [omissionsDialogOpen, setOmissionsDialogOpen] = useState(false);
  const [omissionsAnalysis, setOmissionsAnalysis] =
    useState<OmissionsAnalysisResult | null>(() =>
      parseStoredOmissionsAnalysis(meeting.omissionsAnalysisJson),
    );
  const [omissionsLoading, setOmissionsLoading] = useState(false);
  const [omissionsApplyingMinutes, setOmissionsApplyingMinutes] =
    useState(false);
  const [omissionsApplyingTodos, setOmissionsApplyingTodos] = useState(false);
  const [omissionsError, setOmissionsError] = useState<string | null>(null);
  const [omissionsWarnings, setOmissionsWarnings] = useState<string[]>([]);
  const [globalTodosMergedAt, setGlobalTodosMergedAt] = useState(
    meeting.globalTodosMergedAt,
  );
  const [aiUsage, setAiUsage] = useState(() =>
    parseStoredAiUsage(meeting.aiUsageJson),
  );

  useEffect(() => {
    const key = `meeting-warnings:${meeting.id}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return;

    sessionStorage.removeItem(key);

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        setGenerationWarnings(parsed);
      }
    } catch {
      // Ignore malformed warning payloads.
    }
  }, [meeting.id]);

  const finalized = presentationStatus === "finalized";

  const derivedFromJson = useMemo(
    () => derivedMinutesMarkdown(minutesJson),
    [minutesJson],
  );

  const editableAttendance = useMemo((): EditableAttendance | null => {
    if (!minutesJson?.trim()) return null;
    return extractAttendanceFromMinutesJson(minutesJson);
  }, [minutesJson]);

  const displayPublishedMinutes = useMemo(() => {
    if (finalized && derivedFromJson) {
      return derivedFromJson;
    }
    return publishedMinutes;
  }, [derivedFromJson, finalized, publishedMinutes]);

  const useStructuredMinutesEditor = Boolean(minutesDoc) && !finalized;

  function handleMinutesDocChange(next: MinutesDocumentV2) {
    setMinutesDoc(next);
    setMinutesJson(serializeMinutesDoc(next));
    setMinutes(v2ToMarkdown(next));
  }

  const copyMarkdown =
    activeTab === "minutes"
      ? finalized
        ? displayPublishedMinutes
        : minutes
      : finalized
        ? publishedTodos
        : todos;

  async function persist(mode: "draft" | "finalize") {
    setError(null);
    setInfo(null);
    const finalize = mode === "finalize";

    try {
      setBusy(finalize ? "finalize" : "draft");

      const res = await fetch(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minutesContent: minutes,
          todosContent: todos,
          minutesJson,
          status: finalize ? "finalized" : "draft",
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Could not persist meeting workspace");
      }

      const payload = (await res.json()) as Meeting;

      setBaselineMinutes(minutesEditorSeedMarkdown(payload));
      setBaselineTodos(payload.todosContent);
      setMinutes(payload.minutesContent);
      setTodos(payload.todosContent);
      setPresentationStatus(payload.status);
      setPublishedMinutes(payload.minutesContent);
      setPublishedTodos(payload.todosContent);
      setMinutesJson(payload.minutesJson);
      setMinutesDoc(parseMinutesDoc(payload.minutesJson));
      setMinutesReloadVersion((version) => version + 1);
      setTodosReloadVersion((version) => version + 1);

      router.refresh();

      setInfo(
        finalize
          ? "Meeting finalized. Action items regenerated for dashboards."
          : "Draft saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setBusy(null);
    }
  }

  async function saveAttendees(
    attendance: Pick<
      EditableAttendance,
      "present" | "byInvitation" | "regrets" | "guests"
    >,
  ) {
    if (!minutesJson?.trim()) return;

    setError(null);
    setInfo(null);

    const updatedJson = applyAttendanceToMinutesJson(minutesJson, attendance);
    if (!updatedJson) {
      setError("Could not update attendance in structured minutes.");
      return;
    }

    const derived = derivedMinutesMarkdown(updatedJson);
    if (!derived) {
      setError("Updated attendance could not be converted to markdown.");
      return;
    }

    try {
      setBusy("attendees");

      const res = await fetch(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minutesContent: derived,
          todosContent: todos,
          minutesJson: updatedJson,
          status: "draft",
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Could not save attendees");
      }

      const payload = (await res.json()) as Meeting;

      setMinutesJson(payload.minutesJson);
      setMinutesDoc(parseMinutesDoc(payload.minutesJson));
      setMinutes(payload.minutesContent);
      setBaselineMinutes(minutesEditorSeedMarkdown(payload));
      setMinutesReloadVersion((version) => version + 1);
      setAttendeesDialogOpen(false);
      router.refresh();

      setInfo("Attendees updated. Minutes and PDF export reflect your changes.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setBusy(null);
    }
  }

  async function runOmissionsAnalysis() {
    setOmissionsError(null);
    setOmissionsWarnings([]);

    try {
      setOmissionsLoading(true);

      const modelSettings = loadModelSettings();

      const res = await fetch(
        `/api/meetings/${meeting.id}/analyze-omissions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelMinutes: modelSettings.omissionsMinutes,
            modelTodos: modelSettings.omissionsTodos,
          }),
        },
      );

      const payload = (await res.json()) as {
        analysis?: OmissionsAnalysisResult;
        warnings?: string[];
        error?: string;
        details?: string[];
        aiUsageJson?: string;
      };

      if (!res.ok) {
        const detailText = payload.details?.length
          ? `: ${payload.details.join("; ")}`
          : "";
        throw new Error(
          (payload.error ?? "Could not analyze omissions") + detailText,
        );
      }

      if (!payload.analysis) {
        throw new Error("Analysis response was empty.");
      }

      setOmissionsAnalysis(payload.analysis);
      setOmissionsWarnings(payload.warnings ?? []);
      if (payload.aiUsageJson) {
        setAiUsage(parseStoredAiUsage(payload.aiUsageJson));
      }
      router.refresh();
    } catch (e) {
      setOmissionsError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setOmissionsLoading(false);
    }
  }

  function openOmissionsDialog() {
    setOmissionsDialogOpen(true);
    setOmissionsError(null);
  }

  async function applyMinutesOmissions(selected: OmissionFinding[]) {
    if (!minutesJson?.trim() || !selected.length || finalized) return;

    setError(null);
    setInfo(null);

    const updatedJson = applyOmissionsToMinutesJson(minutesJson, selected);
    if (!updatedJson) {
      setOmissionsError("Could not merge omissions into structured minutes.");
      return;
    }

    const derived = derivedMinutesMarkdown(updatedJson);
    if (!derived) {
      setOmissionsError("Merged minutes could not be converted to markdown.");
      return;
    }

    try {
      setOmissionsApplyingMinutes(true);

      const res = await fetch(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minutesContent: derived,
          todosContent: todos,
          minutesJson: updatedJson,
          status: "draft",
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Could not save merged minutes");
      }

      const payload = (await res.json()) as Meeting;

      setMinutesJson(payload.minutesJson);
      setMinutesDoc(parseMinutesDoc(payload.minutesJson));
      setMinutes(payload.minutesContent);
      setBaselineMinutes(minutesEditorSeedMarkdown(payload));
      setMinutesReloadVersion((version) => version + 1);

      const appliedIds = new Set(selected.map((o) => o.id));
      setOmissionsAnalysis((current) =>
        current
          ? {
              ...current,
              omissions: current.omissions.filter((o) => !appliedIds.has(o.id)),
            }
          : current,
      );

      router.refresh();

      setInfo(
        `Added ${selected.length} item${selected.length === 1 ? "" : "s"} to structured minutes. PDF export reflects your changes.`,
      );
    } catch (e) {
      setOmissionsError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setOmissionsApplyingMinutes(false);
    }
  }

  async function applyTodosOmissions(selected: TodoOmissionFinding[]) {
    if (!selected.length || finalized) return;

    setError(null);
    setInfo(null);

    const updatedTodos = applyTodosOmissionsToMarkdown(todos, selected);
    if (!updatedTodos) {
      setOmissionsError("Could not merge omissions into the To-Do list.");
      return;
    }

    try {
      setOmissionsApplyingTodos(true);

      const res = await fetch(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minutesContent: minutes,
          todosContent: updatedTodos,
          minutesJson,
          status: "draft",
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Could not save merged To-Do list");
      }

      const payload = (await res.json()) as Meeting;

      setTodos(payload.todosContent);
      setBaselineTodos(payload.todosContent);
      setTodosReloadVersion((version) => version + 1);

      const appliedIds = new Set(selected.map((o) => o.id));
      setOmissionsAnalysis((current) =>
        current
          ? {
              ...current,
              todosOmissions: current.todosOmissions.filter(
                (o) => !appliedIds.has(o.id),
              ),
            }
          : current,
      );

      router.refresh();

      setInfo(
        `Added ${selected.length} item${selected.length === 1 ? "" : "s"} to the To-Do list.`,
      );
    } catch (e) {
      setOmissionsError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setOmissionsApplyingTodos(false);
    }
  }

  const omissionsApplying =
    omissionsApplyingMinutes || omissionsApplyingTodos;
  const workspaceBusy = busy !== null || omissionsLoading || omissionsApplying;
  const canCheckOmissions =
    Boolean(minutesJson?.trim()) && Boolean(todos.trim());
  const omissionsRunCount = useMemo(
    () => countOmissionsAnalysisRuns(aiUsage),
    [aiUsage],
  );

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
      <Link
        href="/meetings"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-900"
      >
        <svg
          aria-hidden
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 19l-7-7m0 0l7-7m-7 7h18"
          />
        </svg>
        Back to meetings
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-semibold text-slate-900">
            {meeting.title}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {!finalized && editableAttendance ? (
              <button
                type="button"
                onClick={() => setAttendeesDialogOpen(true)}
                disabled={workspaceBusy}
                title="Edit attendees"
                aria-label="Edit attendees"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
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
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </button>
            ) : null}
            {canCheckOmissions ? (
              <CheckOmissionsIconButton
                runCount={omissionsRunCount}
                onClick={openOmissionsDialog}
                disabled={workspaceBusy}
              />
            ) : null}
            <AiUsageIconButton
              onClick={() => setUsageDialogOpen(true)}
              disabled={workspaceBusy}
            />
            <DeleteMeetingButton
              meetingId={meeting.id}
              meetingTitle={meeting.title}
              redirectTo="/meetings"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span>
                Meeting date:&nbsp;
                <time dateTime={meeting.meetingDate}>
                  {formatMeetingDate(meeting.meetingDate)}
                </time>
              </span>
              <span
                className={`inline-flex rounded-full px-3 py-0.5 text-[11px] font-semibold ${
                  finalized
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-amber-100 text-amber-900"
                }`}
              >
                {finalized ? "FINALIZED" : "Draft"}
              </span>
            </p>
            <dl className="mt-4 space-y-1 text-xs font-mono text-slate-500">
              <div>
                <dt className="inline font-semibold text-slate-600">VTT:&nbsp;</dt>
                <dd className="inline">
                  <button
                    type="button"
                    onClick={() => setVttDialogOpen(true)}
                    className="font-mono text-teal-700 underline decoration-teal-300 underline-offset-2 hover:text-teal-900"
                    title="View transcript"
                  >
                    {meeting.vttFilePath.split(/[/\\]/).pop() ??
                      meeting.vttFilePath}
                  </button>
                </dd>
              </div>
              <div>
                <dt className="inline font-semibold text-slate-600">PDF:&nbsp;</dt>
                <dd className="inline">{meeting.pdfFilePath}</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PdfExportControls
              meetingId={meeting.id}
              disabled={!minutesJson?.trim()}
            />
            {!finalized ? (
              <>
                <button
                  type="button"
                  onClick={() => persist("draft")}
                  disabled={workspaceBusy}
                  className="rounded-md border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-900 hover:border-teal-300 disabled:opacity-60"
                >
                  {busy === "draft" ? "Saving draft…" : "Save draft"}
                </button>
                <button
                  type="button"
                  onClick={() => persist("finalize")}
                  disabled={
                    workspaceBusy || !minutes.trim() || !todos.trim()
                  }
                  className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy === "finalize" ? "Finalizing…" : "Finalize"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          {info}
        </div>
      ) : null}
      {generationWarnings.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Generation warnings</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {generationWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!minutesJson?.trim() ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          This meeting has no structured minutes payload. PDF export requires a
          newly generated meeting. Older workspaces only have markdown.
        </div>
      ) : null}

      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ContentTabStrip active={activeTab} onChange={setActiveTab} />
          <div className="flex flex-wrap items-center gap-2">
            {activeTab === "todos" ? (
              <MergeToGlobalTodosButton
                meetingId={meeting.id}
                todosMarkdown={finalized ? publishedTodos : todos}
                disabled={workspaceBusy}
                onSuccess={({ message, todosContent, globalTodosMergedAt: mergedAt }) => {
                  setTodos(todosContent);
                  setBaselineTodos(todosContent);
                  setPublishedTodos(todosContent);
                  setGlobalTodosMergedAt(mergedAt);
                  setTodosReloadVersion((v) => v + 1);
                  setInfo(message);
                  setError(null);
                }}
                onError={(message) => {
                  setError(message);
                  setInfo(null);
                }}
              />
            ) : null}
            <CopyMarkdownButton
              markdown={copyMarkdown}
              json={activeTab === "minutes" ? minutesJson : null}
            />
          </div>
        </div>

        {activeTab === "minutes" ? (
          <div role="tabpanel">
            {finalized ? (
              <>
                <h2 className="text-xl font-semibold text-slate-900">
                  Published minutes snapshot
                </h2>
                <div className="minutes-markdown-preview prose prose-sm mt-5 max-w-none rounded-2xl border border-slate-200 bg-white p-6 shadow-sm prose-headings:text-slate-900 prose-p:text-slate-800 prose-strong:text-slate-900">
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {enhanceMinutesMarkdown(displayPublishedMinutes)}
                  </Markdown>
                </div>
              </>
            ) : useStructuredMinutesEditor && minutesDoc ? (
              <MinutesStructuredEditor
                doc={minutesDoc}
                onDocChange={handleMinutesDocChange}
                onOpenAttendeesDialog={() => setAttendeesDialogOpen(true)}
              />
            ) : (
              <MinutesEditor
                seedMarkdown={baselineMinutes}
                reloadVersion={minutesReloadVersion}
                onMarkdownChange={setMinutes}
              />
            )}
          </div>
        ) : (
          <div role="tabpanel" className="space-y-3">
            {globalTodosMergedAt ? (
              <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-900">
                To-dos merged to the global checklist on{" "}
                <time dateTime={globalTodosMergedAt}>
                  {new Date(globalTodosMergedAt).toLocaleString()}
                </time>
                . Items below remain on this meeting record and are marked{" "}
                <span className="font-semibold">(merged to global)</span>.
              </p>
            ) : null}
            {finalized ? (
              <div className="todos-markdown-preview rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <MarkdownPreview>{publishedTodos}</MarkdownPreview>
              </div>
            ) : (
              <TodosEditor
                seedMarkdown={baselineTodos}
                reloadVersion={todosReloadVersion}
                onMarkdownChange={setTodos}
              />
            )}
          </div>
        )}
      </section>

      <AttendeesEditorDialog
        open={attendeesDialogOpen}
        attendance={editableAttendance}
        busy={busy === "attendees"}
        onClose={() => {
          if (busy !== "attendees") setAttendeesDialogOpen(false);
        }}
        onSave={saveAttendees}
      />

      <VttViewerDialog
        open={vttDialogOpen}
        meetingId={meeting.id}
        fileLabel={meeting.vttFilePath}
        onClose={() => setVttDialogOpen(false)}
      />

      <AiUsageDialog
        open={usageDialogOpen}
        usage={aiUsage}
        onClose={() => setUsageDialogOpen(false)}
      />

      <OmissionsAnalysisDialog
        open={omissionsDialogOpen}
        analysis={omissionsAnalysis}
        loading={omissionsLoading}
        applyingMinutes={omissionsApplyingMinutes}
        applyingTodos={omissionsApplyingTodos}
        error={omissionsError}
        warnings={omissionsWarnings}
        finalized={finalized}
        minutesDivergesFromPdfSource={false}
        onClose={() => {
          if (!omissionsLoading && !omissionsApplying) {
            setOmissionsDialogOpen(false);
          }
        }}
        onStartCheck={() => void runOmissionsAnalysis()}
        onReRun={() => void runOmissionsAnalysis()}
        onApplyMinutes={(selected) => void applyMinutesOmissions(selected)}
        onApplyTodos={(selected) => void applyTodosOmissions(selected)}
      />
    </div>
  );
}
