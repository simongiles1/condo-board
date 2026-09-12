"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { MinutesStructuredEditor } from "@/components/MinutesStructuredEditor";
import { AttendeesEditorDialog } from "@/components/AttendeesEditorDialog";
import { MeetingDocumentsDialog } from "@/components/MeetingDocumentsDialog";
import { PullMeetingSourcesButton } from "@/components/PullMeetingSourcesButton";
import {
  AiUsageDialog,
} from "@/components/AiUsageDialog";
import { DeleteMeetingButton } from "@/components/DeleteMeetingButton";
import {
  AgendaApprovalConfirmDialog,
  type AgendaApprovalConfirmMode,
} from "@/components/AgendaApprovalConfirmDialog";
import {
  PipelineRunConfirmDialog,
  type PipelineConfirmAction,
} from "@/components/PipelineRunConfirmDialog";
import { PipelineTransitionsDialog } from "@/components/PipelineTransitionsDialog";
import { GoldStandardValidationBadge } from "@/components/GoldStandardValidationBadge";
import { GoldStandardCompareDialog } from "@/components/GoldStandardCompareDialog";
import { GoldStandardValidationSidePanel } from "@/components/GoldStandardValidationSidePanel";
import type { GoldStandardValidationTab } from "@/components/GoldStandardValidationSidePanel";
import { PdfTemplateDialog } from "@/components/PdfTemplateDialog";
import { GoldStandardItemFindingBadgesRow } from "@/components/GoldStandardItemFindingBadge";
import {
  AgendaItemDetailSidePanel,
  type AgendaItemDetail,
} from "@/components/AgendaItemDetailSidePanel";
import { headlineValidationScore } from "@/lib/minutes/gold-standard-compare";
import {
  parseStoredGoldStandardValidation,
  validationScoreLabel,
  type GoldStandardValidationResult,
} from "@/lib/minutes/gold-standard-schema";
import type { AttendanceSavePayload, EditableAttendance } from "@/lib/minutes/attendance-edit";
import {
  applyAttendanceToMinutesDoc,
  extractEditableAttendanceFromDoc,
} from "@/lib/minutes/attendance-edit";
import type { AiUsageStageRow } from "@/lib/gemini/usage";
import { v2ToMarkdown } from "@/lib/minutes/v2-to-markdown";
import {
  buildGoldStandardFindingsByItemId,
  type ItemGoldStandardFindings,
} from "@/lib/minutes/gold-standard-item-match";
import {
  parseDraftMinutesDoc,
  serializeDraftSummaryJson,
} from "@/lib/minutes/doc-v2-edits";
import type { AttendeeV2, MinutesDocumentV2 } from "@/lib/minutes/schema-v2";
import { formatAttendeeLine } from "@/lib/minutes/v2-render-helpers";
import type { PdfMargins } from "@/lib/pdf/margins";
import { usePdfTemplateSettings } from "@/lib/pdf/use-pdf-template-settings";
import type { PdfTemplatePreviewContext } from "@/lib/pdf/template-preview";
import { ChunkPreviewModal } from "@/components/ChunkPreviewModal";
import { TranscriptRangeModal } from "@/components/TranscriptRangeModal";
import {
  buildAgendaOutlineTree,
  decorateAgendaOutlineTree,
  filterAgendaItemsPreservingAncestors,
  inferPropertyManagementReportNumber,
  planAdHocPlacement,
  type AgendaListMarker,
  type AgendaOutlineNode as OutlineTreeNode,
} from "@/lib/meeting-v2/agenda-outline";
import {
  buildMeetingV2DisplayProgress,
  buildMeetingV2WorkflowProgress,
  getMeetingV2PipelineStateDescription,
  shouldPollMeetingV2Status,
  type MeetingV2WorkflowProgress,
} from "@/lib/meeting-v2/workflow-progress";
import { useMeetingV2StepRateEta } from "@/lib/ui/use-meeting-v2-step-rate-eta";
import type { MeetingV2DashboardCard } from "@/lib/meeting-v2/service";
import type {
  MeetingV2Alert,
  MeetingV2ExtractionQuality,
} from "@/lib/meeting-v2/extraction-diagnostics";
import {
  filterRedundantAddToAgendaDiscrepancies,
  resolveTranscriptDiscrepancyKind,
} from "@/lib/meeting-v2/transcript-discrepancies";
import {
  formatMeetingDate,
  meetingDateSortKey,
} from "@/lib/format-meeting-date";

type MeetingCard = MeetingV2DashboardCard;

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
    pipelineActivelyRunning: boolean;
    goldStandardFilePath?: string | null;
    goldStandardValidationJson?: string | null;
    aiUsageJson?: string | null;
    agendaApproval?: {
      status: "pending_review" | "approved";
      approvedAt: string | null;
      approvedBy?: string | null;
      itemStatuses?: Record<string, "discussed" | "not_discussed" | "ad_hoc">;
      excludedItemIds?: string[];
      discrepancies?: Array<{
        id: string;
        transcriptRange: [number, number];
        timestamp: string;
        speaker?: string | null;
        snippet: string;
        suggestedTitle: string;
        suggestedSection?: string | null;
        clarificationQuestion: string;
        kind?: "add_to_agenda" | "status_inquiry";
        status: "pending" | "accepted" | "dismissed";
      }>;
    } | null;
  };
  items: Array<{
    id: string;
    title: string;
    itemNumber: string | null;
    itemType: string;
    sectionLabel?: string | null;
    sourceText?: string | null;
    discussionStatus?: "discussed" | "not_discussed" | "ad_hoc";
    sourceSectionId: string | null;
    sourcePages?: number[];
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
    evidence?: Array<{
      id: string;
      sourceType: "transcript_segment" | "document_page" | "document_section";
      sourceId: string;
      rationale: string | null;
      relevanceScore: number;
      snippet: string | null;
      speakerLabel?: string | null;
      timestamp?: string | null;
      pageNumber?: number | null;
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

type MeetingV2LatestDraft = MeetingV2Status["latestDraft"];

/** Status polls return draft metadata only (json: null). Keep richer local draft data. */
function mergeLatestDraft(
  current: MeetingV2LatestDraft | null | undefined,
  next: MeetingV2LatestDraft | null | undefined,
): MeetingV2LatestDraft | null {
  if (!current) return next ?? null;
  if (!next) return current;
  if (current.id !== next.id) return next;
  if (current.json && !next.json) return current;
  if (!current.json && next.json) return next;
  if (current.json && next.json) return current;
  return next;
}

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

function tabTone(active: boolean): string {
  return active
    ? "bg-slate-900 text-white shadow-sm"
    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900";
}

type AgendaReviewViewMode = "validated" | "approval";

function AgendaReviewViewToggle({
  mode,
  onModeChange,
}: {
  mode: AgendaReviewViewMode;
  onModeChange: (mode: AgendaReviewViewMode) => void;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Review view
      </span>
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium shadow-sm">
        <button
          type="button"
          onClick={() => onModeChange("validated")}
          className={`rounded-lg px-3 py-1.5 transition ${
            mode === "validated"
              ? "bg-white font-semibold text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Item review
        </button>
        <button
          type="button"
          onClick={() => onModeChange("approval")}
          className={`rounded-lg px-3 py-1.5 transition ${
            mode === "approval"
              ? "bg-white font-semibold text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Agenda approval
        </button>
      </div>
    </div>
  );
}

type MeetingDateSort = "asc" | "desc";

export function MeetingsV2Dashboard({ meetings }: { meetings: MeetingCard[] }) {
  const [panelMeetingId, setPanelMeetingId] = useState<string | null>(null);
  const [compareDialogMeetingId, setCompareDialogMeetingId] = useState<string | null>(null);
  const [meetingDateSort, setMeetingDateSort] = useState<MeetingDateSort>("desc");
  const [liveValidationByMeetingId, setLiveValidationByMeetingId] = useState<
    Record<string, GoldStandardValidationResult>
  >({});
  const [liveAiUsageByMeetingId, setLiveAiUsageByMeetingId] = useState<
    Record<string, string>
  >({});

  const panelMeeting = useMemo(() => {
    const meeting = meetings.find((row) => row.id === panelMeetingId) ?? null;
    if (!meeting) return null;
    const aiUsageJson =
      liveAiUsageByMeetingId[meeting.id] ?? meeting.aiUsageJson ?? null;
    return {
      id: meeting.id,
      title: meeting.title,
      meetingDate: meeting.meetingDate,
      aiUsageJson,
    };
  }, [meetings, panelMeetingId, liveAiUsageByMeetingId]);

  const compareDialogMeeting = useMemo(
    () => meetings.find((m) => m.id === compareDialogMeetingId) ?? null,
    [meetings, compareDialogMeetingId],
  );

  const panelValidation = useMemo(() => {
    if (!panelMeetingId) return null;
    if (liveValidationByMeetingId[panelMeetingId]) {
      return liveValidationByMeetingId[panelMeetingId];
    }
    const meeting = meetings.find((row) => row.id === panelMeetingId);
    return parseStoredGoldStandardValidation(meeting?.goldStandardValidationJson);
  }, [panelMeetingId, liveValidationByMeetingId, meetings]);

  const getValidationScore = useCallback(
    (meeting: MeetingCard): number | null => {
      const live = liveValidationByMeetingId[meeting.id];
      if (live) return headlineValidationScore(live);
      const stored = parseStoredGoldStandardValidation(meeting.goldStandardValidationJson);
      return stored ? headlineValidationScore(stored) : null;
    },
    [liveValidationByMeetingId],
  );

  function handleValidationBadgeClick(meeting: MeetingCard) {
    const score = getValidationScore(meeting);
    if (score !== null) {
      setPanelMeetingId(meeting.id);
      return;
    }
    setCompareDialogMeetingId(meeting.id);
  }

  function handleCompareSuccess(
    validation: GoldStandardValidationResult,
    aiUsageJson: string,
  ) {
    if (!compareDialogMeetingId) return;
    setLiveValidationByMeetingId((current) => ({
      ...current,
      [compareDialogMeetingId]: validation,
    }));
    setLiveAiUsageByMeetingId((current) => ({
      ...current,
      [compareDialogMeetingId]: aiUsageJson,
    }));
    const targetMeetingId = compareDialogMeetingId;
    setCompareDialogMeetingId(null);
    setPanelMeetingId(targetMeetingId);
  }

  const sortedMeetings = useMemo(() => {
    const rows = [...meetings];
    rows.sort((left, right) => {
      const delta = meetingDateSortKey(left.meetingDate) - meetingDateSortKey(right.meetingDate);
      if (delta !== 0) {
        return meetingDateSort === "asc" ? delta : -delta;
      }
      const titleCmp = left.title.localeCompare(right.title, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return meetingDateSort === "asc" ? titleCmp : -titleCmp;
    });
    return rows;
  }, [meetings, meetingDateSort]);

  if (meetings.length === 0) {
    return (
      <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
        No V2 meetings exist yet. Uploading a meeting through the current meetings flow will seed a V2 row automatically.
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="whitespace-nowrap px-3 py-2.5">
                <button
                  type="button"
                  onClick={() =>
                    setMeetingDateSort((current) => (current === "asc" ? "desc" : "asc"))
                  }
                  className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left uppercase tracking-wide transition hover:bg-slate-200/80 hover:text-slate-900"
                  aria-sort={meetingDateSort === "asc" ? "ascending" : "descending"}
                >
                  Meeting date
                  <span className="font-normal normal-case tracking-normal text-slate-500" aria-hidden>
                    {meetingDateSort === "asc" ? "↑" : "↓"}
                  </span>
                </button>
              </th>
              <th scope="col" className="px-3 py-2.5">Title</th>
              <th scope="col" className="px-3 py-2.5">Pipeline</th>
              <th scope="col" className="px-3 py-2.5">Validation</th>
              <th scope="col" className="px-3 py-2.5">Stage</th>
              <th scope="col" className="min-w-[12rem] px-3 py-2.5">Note</th>
              <th scope="col" className="px-3 py-2.5 text-right"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedMeetings.map((meeting) => (
              <tr key={meeting.id} className="hover:bg-slate-50/80">
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">
                  <time dateTime={meeting.meetingDate}>
                    {formatMeetingDate(meeting.meetingDate)}
                  </time>
                </td>
                <td className="px-3 py-2.5 font-medium text-slate-900">
                  <Link
                    href={`/operations/meetings/v2/${meeting.id}`}
                    className="hover:text-teal-700"
                  >
                    {meeting.title}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${statusTone(meeting.pipelineState)}`}
                    title={getMeetingV2PipelineStateDescription(meeting.pipelineState)}
                  >
                    {startCase(meeting.pipelineState)}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <GoldStandardValidationBadge
                    validationScore={getValidationScore(meeting)}
                    onClick={() => handleValidationBadgeClick(meeting)}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${stageTone(meeting.progressStatus)}`}
                  >
                    <span>{meeting.progressLabel}</span>
                    <span className="rounded-full border border-current/20 px-1.5 py-px text-[10px] font-bold tabular-nums tracking-normal">
                      {meeting.progressStepNumber}/{meeting.progressTotalSteps}
                    </span>
                  </span>
                </td>
                <td className="max-w-md px-3 py-2.5 text-slate-600">
                  <span className="line-clamp-2">{meeting.progressNote}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <Link
                    href={`/operations/meetings/v2/${meeting.id}`}
                    className="font-medium text-teal-700 hover:text-teal-900"
                  >
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <GoldStandardCompareDialog
        open={compareDialogMeetingId !== null}
        meetingId={compareDialogMeetingId}
        meetingTitle={compareDialogMeeting?.title ?? null}
        onClose={() => setCompareDialogMeetingId(null)}
        onSuccess={handleCompareSuccess}
      />

      <GoldStandardValidationSidePanel
        meeting={panelMeeting}
        validation={panelValidation}
        onClose={() => setPanelMeetingId(null)}
        onReCompare={() => {
          if (!panelMeetingId) return;
          setCompareDialogMeetingId(panelMeetingId);
        }}
        onUploadDifferent={() => {
          if (!panelMeetingId) return;
          setCompareDialogMeetingId(panelMeetingId);
        }}
      />
    </>
  );
}

export function MeetingV2Detail({ meetingId }: { meetingId: string }) {
  const [status, setStatus] = useState<MeetingV2Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<V2Tab>("overview");
  const isAgendaApprovalPending = Boolean(
    status?.items?.length &&
      (!status.meeting.agendaApproval?.approvedAt ||
        status.meeting.computedPipelineState === "extracted"),
  );
  const prevPendingRef = useRef(false);
  useEffect(() => {
    if (isAgendaApprovalPending && !prevPendingRef.current) {
      setActiveTab("review");
      prevPendingRef.current = true;
    }
  }, [isAgendaApprovalPending]);
  const [autonomyTemperature, setAutonomyTemperature] = useState(0.8);
  const [documentsDialogOpen, setDocumentsDialogOpen] = useState(false);
  const [usageDialogOpen, setUsageDialogOpen] = useState(false);
  const [usageStages, setUsageStages] = useState<AiUsageStageRow[] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [pollWindowUntil, setPollWindowUntil] = useState<number | null>(null);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [transitionsDialogOpen, setTransitionsDialogOpen] = useState(false);
  const [pdfTemplateDialogOpen, setPdfTemplateDialogOpen] = useState(false);
  const { margins: pdfMargins, saveMargins: savePdfTemplateMargins } =
    usePdfTemplateSettings();
  const [pdfMarginsRevision, setPdfMarginsRevision] = useState(0);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelInitialTab, setSidePanelInitialTab] =
    useState<GoldStandardValidationTab>("generatedOnly");
  const [focusAgendaItemId, setFocusAgendaItemId] = useState<string | null>(null);
  const [reCompareBusy, setReCompareBusy] = useState(false);
  const [liveValidation, setLiveValidation] =
    useState<GoldStandardValidationResult | null>(null);
  const [liveAiUsage, setLiveAiUsage] = useState<string | null>(null);
  const statusRequestSeq = useRef(0);
  const statusAbortRef = useRef<AbortController | null>(null);

  const pdfTemplatePreviewContext = useMemo((): PdfTemplatePreviewContext => {
    const draftJson = status?.latestDraft?.json;
    if (!draftJson) {
      return {
        meetingDate: status?.meeting.meetingDate,
      };
    }
    const doc = parseDraftMinutesDoc(draftJson);
    if (!doc) {
      return {
        meetingDate: status?.meeting.meetingDate,
      };
    }
    return {
      corporationName: doc.metadata.corporationName,
      meetingDate: doc.metadata.meetingDate || status?.meeting.meetingDate,
      meetingTime: doc.metadata.meetingTime,
      meetingPlatform: doc.metadata.meetingPlatform,
    };
  }, [status?.latestDraft?.json, status?.meeting.meetingDate]);

  async function handlePdfTemplateSave(nextMargins: PdfMargins) {
    await savePdfTemplateMargins(nextMargins);
    setPdfMarginsRevision((revision) => revision + 1);
    setPdfTemplateDialogOpen(false);
  }

  const currentValidation = useMemo(() => {
    if (liveValidation) return liveValidation;
    return parseStoredGoldStandardValidation(
      status?.meeting.goldStandardValidationJson,
    );
  }, [liveValidation, status?.meeting.goldStandardValidationJson]);

  const validationScore = currentValidation
    ? headlineValidationScore(currentValidation)
    : null;

  function handleValidationBadgeClick() {
    if (validationScore !== null) {
      setSidePanelInitialTab("generatedOnly");
      setFocusAgendaItemId(null);
      setSidePanelOpen(true);
    } else {
      setCompareDialogOpen(true);
    }
  }

  function handleOpenGoldStandardPanel(
    tab: GoldStandardValidationTab = "generatedOnly",
    agendaItemId?: string,
  ) {
    if (validationScore !== null) {
      setSidePanelInitialTab(tab);
      setFocusAgendaItemId(agendaItemId ?? null);
      setSidePanelOpen(true);
    } else {
      setCompareDialogOpen(true);
    }
  }

  function applyCompareResult(
    validation: GoldStandardValidationResult,
    aiUsageJson: string,
  ) {
    setLiveValidation(validation);
    setLiveAiUsage(aiUsageJson);
    void refreshStatus({ allowHidden: true });
    void fetch(`/api/v2/meetings/${meetingId}/ai-usage`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { stages?: AiUsageStageRow[] } | null) => {
        if (payload?.stages) setUsageStages(payload.stages);
      })
      .catch(() => undefined);
  }

  function handleCompareSuccess(
    validation: GoldStandardValidationResult,
    aiUsageJson: string,
  ) {
    applyCompareResult(validation, aiUsageJson);
    setCompareDialogOpen(false);
    setSidePanelOpen(true);
  }

  async function handleReuseCompare() {
    if (!status?.meeting.goldStandardFilePath) {
      setSidePanelOpen(false);
      setCompareDialogOpen(true);
      return;
    }
    setReCompareBusy(true);
    try {
      const formData = new FormData();
      formData.set("reuseStored", "1");
      const response = await fetch(
        `/api/meetings/${meetingId}/compare-gold-standard`,
        { method: "POST", body: formData },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string" ? payload.error : "Re-compare failed.",
        );
      }
      const validation = payload?.validation as GoldStandardValidationResult | undefined;
      if (!validation) throw new Error("Comparison returned no validation result.");
      applyCompareResult(
        validation,
        typeof payload?.aiUsageJson === "string" ? payload.aiUsageJson : "",
      );
    } catch (error) {
      console.error("[MeetingV2Detail] re-compare failed:", error);
      setCompareDialogOpen(true);
    } finally {
      setReCompareBusy(false);
    }
  }

  const kickPollWindow = useCallback((durationMs = 120_000) => {
    setPollWindowUntil(Date.now() + durationMs);
  }, []);

  useEffect(() => {
    const freshKey = `meeting-v2-fresh:${meetingId}`;
    if (sessionStorage.getItem(freshKey)) {
      sessionStorage.removeItem(freshKey);
      kickPollWindow(60_000);
    }
  }, [kickPollWindow, meetingId]);

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

  const refreshStatus = useCallback(
    async (options?: { active?: boolean; allowHidden?: boolean }) => {
      const active = options?.active ?? true;
      const allowHidden = options?.allowHidden ?? false;
      if (typeof document !== "undefined" && document.hidden && !allowHidden) return;

      const seq = ++statusRequestSeq.current;
      statusAbortRef.current?.abort();
      const controller = new AbortController();
      statusAbortRef.current = controller;

      try {
        const response = await fetch(`/api/v2/meetings/${meetingId}/status`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (seq !== statusRequestSeq.current) return;
        if (!response.ok) {
          if (active) setLoading(false);
          return;
        }
        const payload = (await response.json()) as MeetingV2Status;
        if (seq !== statusRequestSeq.current) return;
        if (active) {
          setStatus((current) => {
            const mergedDraft = mergeLatestDraft(current?.latestDraft, payload.latestDraft);
            if (mergedDraft === payload.latestDraft) return payload;
            return { ...payload, latestDraft: mergedDraft };
          });
          setLoading(false);
        }
      } catch (error) {
        if (seq !== statusRequestSeq.current) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("[MeetingV2Detail] status refresh failed:", error);
        if (active) {
          setStatusError("Could not load this meeting workspace. Check your connection and try again.");
          setLoading(false);
        }
      }
    },
    [meetingId],
  );

  const pipelineState =
    status?.meeting.pipelineState ?? status?.meeting.computedPipelineState ?? "created";
  const pipelineNotStarted =
    status?.meeting.pipelineState === "created" ||
    status?.meeting.currentStep === "Ready to start";
  const pipelineActivelyRunning = status?.meeting.pipelineActivelyRunning ?? false;
  const pipelineHalted =
    !pipelineNotStarted &&
    Boolean(status?.meeting.alerts.some((alert) => alert.blocksPipeline));
  const awaitingBackgroundWork =
    runBusy ||
    draftBusy ||
    (pollWindowUntil !== null && Date.now() < pollWindowUntil);
  const shouldPollStatus = shouldPollMeetingV2Status({
    pipelineState,
    pipelineHalted,
    awaitingBackgroundWork,
    currentStep: status?.meeting.currentStep,
  });

  useEffect(() => {
    if (!usageDialogOpen || !pipelineActivelyRunning) return;

    const timer = window.setInterval(() => {
      void fetch(`/api/v2/meetings/${meetingId}/ai-usage`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { stages?: AiUsageStageRow[] } | null) => {
          if (payload?.stages) setUsageStages(payload.stages);
        })
        .catch(() => undefined);
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [meetingId, pipelineActivelyRunning, usageDialogOpen]);

  useEffect(() => {
    if (!pollWindowUntil) return;
    const remaining = pollWindowUntil - Date.now();
    if (remaining <= 0) {
      setPollWindowUntil(null);
      return;
    }
    const timer = window.setTimeout(() => setPollWindowUntil(null), remaining);
    return () => window.clearTimeout(timer);
  }, [pollWindowUntil]);

  useEffect(() => {
    let active = true;

    async function loadStatus(allowHidden = false) {
      await refreshStatus({ active, allowHidden });
    }

    function onVisibilityChange() {
      if (!document.hidden) {
        void loadStatus();
      }
    }

    void loadStatus(true);

    if (!shouldPollStatus) {
      document.addEventListener("visibilitychange", onVisibilityChange);
      return () => {
        active = false;
        document.removeEventListener("visibilitychange", onVisibilityChange);
        statusAbortRef.current?.abort();
      };
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadStatus();
      }
    }, 10000);

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      statusAbortRef.current?.abort();
    };
  }, [meetingId, refreshStatus, shouldPollStatus]);

  useEffect(() => {
    const draftId = status?.latestDraft?.id;
    const draftJson = status?.latestDraft?.json;
    if (activeTab !== "draft" || !draftId || draftJson !== null) return;

    let active = true;
    async function loadDraft() {
      const response = await fetch(`/api/v2/meetings/${meetingId}/draft`, {
        cache: "no-store",
      });
      if (!response.ok || !active) return;
      const payload = (await response.json()) as {
        draft: MeetingV2Status["latestDraft"];
      };
      if (payload.draft && active) {
        setStatus((current) =>
          current ? { ...current, latestDraft: payload.draft ?? null } : current,
        );
      }
    }

    void loadDraft();
    return () => {
      active = false;
    };
  }, [activeTab, meetingId, status?.latestDraft?.id, status?.latestDraft?.json]);

  async function handleRunPipeline() {
    setRunBusy(true);
    kickPollWindow();
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
    setRunBusy(true);
    kickPollWindow();
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
    setDraftError(null);
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}/draft`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        draft?: MeetingV2Status["latestDraft"];
      };
      if (!response.ok) {
        setDraftError(payload.error ?? "Failed to generate draft.");
        return;
      }
      if (payload.draft) {
        // Ignore in-flight status polls that may still return pre-draft state.
        statusAbortRef.current?.abort();
        statusRequestSeq.current += 1;
        setStatus((current) =>
          current ? { ...current, latestDraft: payload.draft ?? null } : current,
        );
        setActiveTab("draft");
      }
    } finally {
      setDraftBusy(false);
    }
  }

  const progress = status?.meeting.progressPercent ?? 0;
  const displayState = pipelineNotStarted
    ? "created"
    : status?.meeting.computedPipelineState ?? status?.meeting.pipelineState ?? "created";
  const reviewableItems = status?.items ?? [];
  const needsClarificationCount = reviewableItems.filter((item) => item.openQuestions.length > 0).length;
  const flaggedCount = reviewableItems.filter((item) =>
    item.validation.some((validation) => validation.severity === "error" || validation.severity === "warning"),
  ).length;
  const readyCount = reviewableItems.filter(
    (item) => item.openQuestions.length === 0 && !item.validation.some(v => v.severity === "error" || v.severity === "warning"),
  ).length;
  const workflowProgress = status
    ? buildMeetingV2WorkflowProgress({
        pipelineStages: status.meeting.stages.map((stage) => ({
          key: stage.key,
          label: stage.label,
          status: stage.status,
          note: stage.note,
        })),
        agendaItemCount: status.meeting.counts.agendaItems,
        needsClarificationCount,
        flaggedCount,
        draftCount: status.meeting.counts.drafts,
        hasLatestDraft: Boolean(status.latestDraft),
      })
    : null;
  const displayProgressState = buildMeetingV2DisplayProgress({
    pipelineNotStarted,
    pipelineActivelyRunning,
    pipelineState: status?.meeting.pipelineState ?? "created",
    storedProgressPercent: status?.meeting.progressPercent,
    storedCurrentStep: status?.meeting.currentStep,
    workflowProgress,
  });
  const displayStep = displayProgressState.currentStep;
  const displayProgress = displayProgressState.progressPercent;
  const stepRateEta = useMeetingV2StepRateEta({
    active: pipelineActivelyRunning && !pipelineHalted,
    currentStep: displayStep,
    progressPercent: displayProgress,
  });
  const displayLabel = pipelineNotStarted
    ? "Ready to start"
    : pipelineHalted && displayState !== "failed"
      ? `Stopped · ${displayProgressState.currentLabel}`
      : displayProgressState.currentLabel;
  const hasSuccessfulRun = displayState === "validated" || isAgendaApprovalPending;
  const pipelineValidated = displayState === "validated";
  const hasMeetingDocuments = Boolean(
    status?.sources.transcript?.available || status?.sources.boardPackage?.available,
  );
  const pipelineSourcesReady = Boolean(
    status?.sources.transcript?.available && status?.sources.boardPackage?.available,
  );
  const pipelineRunning = pipelineActivelyRunning && !pipelineHalted;
  const pipelineDisabledReason = !status
    ? "Loading meeting sources…"
    : pipelineRunning
      ? "Pipeline is already running."
      : !status.sources.transcript?.available && !status.sources.boardPackage?.available
        ? "Transcript and board package are not available on this machine."
        : !status.sources.transcript?.available
          ? "Transcript file is not available on this machine."
          : !status.sources.boardPackage?.available
            ? "Board package is not available on this machine."
            : null;

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

      <div className="-mx-4 border-y border-slate-200 bg-white shadow-sm sm:mx-0 sm:rounded-2xl sm:border">
        <div
          className={`border-b border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-4 py-4 text-white sm:rounded-t-2xl ${
            hasSuccessfulRun ? "" : "sm:rounded-b-2xl border-b-0"
          }`}
        >
          <div className="grid gap-3 max-xl:relative xl:grid-cols-[minmax(0,16rem)_1fr_auto] xl:items-center">
            <div className="min-w-0 max-xl:pr-10">
              <h1 className="text-xl font-semibold tracking-tight">
                {status?.meeting.title ?? "Loading meeting"}
              </h1>
              <p className="mt-0.5 text-sm text-white/65">
                {status
                  ? formatMeetingDate(status.meeting.meetingDate)
                  : "Loading date"}
              </p>
            </div>

            <div className="w-full min-w-0 rounded-xl border border-white/10 bg-black/15 p-3 xl:mx-2">
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium text-white/80">Current Progress</span>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                    pipelineHalted
                      ? "border-rose-300 bg-rose-600 text-white"
                      : pipelineActivelyRunning
                        ? "border-teal-200 bg-teal-500/90 text-white"
                        : pipelineNotStarted
                          ? "border-teal-200 bg-teal-500/90 text-white"
                          : "border-white/20 bg-white/10 text-white/90"
                  }`}
                >
                  {pipelineActivelyRunning && !pipelineHalted
                    ? `Running · ${displayLabel}`
                    : displayLabel}
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
              {pipelineActivelyRunning && !pipelineHalted ? (
                <div className="mt-2 grid gap-2 border-t border-white/10 pt-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
                      Current rate
                    </p>
                    <p className="mt-0.5 text-sm font-medium tabular-nums text-white/85">
                      {stepRateEta?.rateLabel ?? "Calculating…"}
                    </p>
                  </div>
                  <div className="sm:text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
                      Step ETA
                    </p>
                    <p className="mt-0.5 text-sm font-medium tabular-nums text-white/85">
                      {stepRateEta?.etaLabel ?? "Calculating…"}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="max-xl:absolute max-xl:right-0 max-xl:top-0 max-xl:z-10 xl:justify-self-end">
              <MeetingWorkspaceMoreMenu
                hasMeetingDocuments={hasMeetingDocuments}
                validationScore={validationScore}
                meetingId={meetingId}
                meetingTitle={status?.meeting.title ?? "Meeting"}
                sourcesMissing={!pipelineSourcesReady}
                onCompare={handleValidationBadgeClick}
                onOpenDocuments={() => setDocumentsDialogOpen(true)}
                onOpenUsage={() => setUsageDialogOpen(true)}
                onOpenPdfTemplate={() => setPdfTemplateDialogOpen(true)}
                onSourcesPulled={() => void refreshStatus()}
                autonomyTemperature={autonomyTemperature}
                onAutonomyChange={setAutonomyTemperature}
                hasDraftPdf={Boolean(status?.latestDraft)}
                pipelineSlot={
                  <PipelineActionButton
                    runBusy={runBusy}
                    pipelineNotStarted={pipelineNotStarted}
                    pipelineValidated={pipelineValidated}
                    pipelineActivelyRunning={pipelineRunning}
                    disabled={!pipelineSourcesReady || pipelineRunning}
                    disabledReason={pipelineDisabledReason}
                    onRun={handleRunPipeline}
                    onRestart={handleRestartPipeline}
                    presentation="menu"
                  />
                }
              />
            </div>
          </div>
        </div>

        {hasSuccessfulRun ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-2xl px-3 py-2 sm:px-4">
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
                  {tab === "review" && isAgendaApprovalPending ? (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-200/90 px-2 py-0.5 text-xs font-bold text-amber-900">
                      Action needed
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setTransitionsDialogOpen(true)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            >
              JSON transitions
            </button>
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
        {!loading && !status && statusError ? (
          <StatusLoadError
            message={statusError}
            onRetry={() => {
              setLoading(true);
              setStatusError(null);
              void refreshStatus();
            }}
          />
        ) : null}
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
                    onGoToReview={() => setActiveTab("review")}
                  />
                ) : null}
                {activeTab === "review" ? (
                  <AgendaReviewPanel
                    meetingId={meetingId}
                    status={status}
                    goldStandardValidation={currentValidation}
                    onOpenGoldStandardPanel={handleOpenGoldStandardPanel}
                    onReEvaluateSubmitted={kickPollWindow}
                  />
                ) : null}
                {activeTab === "draft" ? (
                  <DraftWorkspacePanel
                    meetingId={meetingId}
                    draft={status.latestDraft}
                    draftBusy={draftBusy}
                    draftError={draftError}
                    validationScore={validationScore}
                    pdfMarginsRevision={pdfMarginsRevision}
                    onValidationBadgeClick={handleValidationBadgeClick}
                    onGenerateDraft={handleGenerateDraft}
                    onDraftJsonSaved={(summaryJson) => {
                      setStatus((current) =>
                        current?.latestDraft
                          ? {
                              ...current,
                              latestDraft: {
                                ...current.latestDraft,
                                json: summaryJson,
                                updatedAt: new Date().toISOString(),
                              },
                            }
                          : current,
                      );
                    }}
                  />
                ) : null}
                {activeTab === "pipeline" ? (
                  <PipelinePanel status={status} workflowProgress={workflowProgress} />
                ) : null}
              </>
            ) : (
              <PreRunPanel
                status={status}
                pipelineNotStarted={pipelineNotStarted}
                pipelineHalted={pipelineHalted}
                pipelineActivelyRunning={pipelineActivelyRunning}
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
        agendaItems={status?.items}
        onClose={() => setDocumentsDialogOpen(false)}
      />
      <AiUsageDialog
        open={usageDialogOpen}
        stages={usageStages}
        loading={usageLoading}
        onClose={() => setUsageDialogOpen(false)}
      />
      <GoldStandardCompareDialog
        open={compareDialogOpen}
        meetingId={meetingId}
        meetingTitle={status?.meeting.title ?? null}
        onClose={() => setCompareDialogOpen(false)}
        onSuccess={handleCompareSuccess}
      />
      <PipelineTransitionsDialog
        open={transitionsDialogOpen}
        meetingId={meetingId}
        meetingTitle={status?.meeting.title ?? null}
        onClose={() => setTransitionsDialogOpen(false)}
      />
      <GoldStandardValidationSidePanel
        meeting={
          sidePanelOpen && status?.meeting
            ? {
                id: meetingId,
                title: status.meeting.title,
                meetingDate: status.meeting.meetingDate,
                aiUsageJson: liveAiUsage ?? status.meeting.aiUsageJson ?? null,
                goldStandardFilePath: status.meeting.goldStandardFilePath ?? null,
              }
            : null
        }
        validation={sidePanelOpen ? currentValidation : null}
        initialTab={sidePanelInitialTab}
        focusAgendaItemId={focusAgendaItemId}
        reCompareBusy={reCompareBusy}
        onClose={() => setSidePanelOpen(false)}
        onReCompare={() => {
          void handleReuseCompare();
        }}
        onUploadDifferent={() => {
          setSidePanelOpen(false);
          setCompareDialogOpen(true);
        }}
      />
      <PdfTemplateDialog
        open={pdfTemplateDialogOpen}
        pdfMargins={pdfMargins}
        previewContext={pdfTemplatePreviewContext}
        onClose={() => setPdfTemplateDialogOpen(false)}
        onSave={handlePdfTemplateSave}
      />
    </div>
  );
}

function MeetingWorkspaceMoreMenu({
  hasMeetingDocuments,
  validationScore,
  meetingId,
  meetingTitle,
  sourcesMissing,
  onCompare,
  onOpenDocuments,
  onOpenUsage,
  onOpenPdfTemplate,
  onSourcesPulled,
  autonomyTemperature,
  onAutonomyChange,
  hasDraftPdf,
  pipelineSlot,
}: {
  hasMeetingDocuments: boolean;
  validationScore: number | null;
  meetingId: string;
  meetingTitle: string;
  sourcesMissing: boolean;
  onCompare: () => void;
  onOpenDocuments: () => void;
  onOpenUsage: () => void;
  onOpenPdfTemplate: () => void;
  onSourcesPulled: () => void;
  autonomyTemperature: number;
  onAutonomyChange: (value: number) => void;
  hasDraftPdf: boolean;
  pipelineSlot: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const validated = validationScore !== null;
  const compareLabel = validated
    ? `Gold standard · ${validationScoreLabel(validationScore)}`
    : "Compare against gold standard";
  const compareDescription = validated
    ? "View validation results and diff"
    : "Compare AI minutes against approved PDF";

  useEffect(() => {
    if (!menuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="relative self-end" ref={containerRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="More meeting actions"
        title="More actions"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white shadow-sm transition hover:border-white/25 hover:bg-white/15"
      >
        <EllipsisVerticalIcon />
      </button>
      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2.5">
            <label
              htmlFor="meeting-autonomy-slider"
              className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
            >
              AI Autonomy: {autonomyTemperature.toFixed(1)}
            </label>
            <input
              id="meeting-autonomy-slider"
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={autonomyTemperature}
              onChange={(event) => onAutonomyChange(parseFloat(event.target.value))}
              className="mt-1.5 w-full accent-teal-600"
              title="0 = Always ask user | 1 = Fully autonomous"
            />
          </div>
          <div className="border-b border-slate-100 px-3 py-2.5">{pipelineSlot}</div>
          {hasDraftPdf ? (
            <a
              role="menuitem"
              href={`/api/v2/meetings/${meetingId}/draft/file?download=1`}
              onClick={closeMenu}
              className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <PdfTemplateMenuIcon className="h-5 w-5 shrink-0 text-slate-500" />
              <span>
                <span className="block font-medium text-slate-900">Download PDF</span>
                <span className="block text-xs text-slate-500">Latest generated minutes draft</span>
              </span>
            </a>
          ) : null}
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              closeMenu();
              onCompare();
            }}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            <DocumentsCompareIcon className="h-5 w-5 shrink-0 text-slate-500" />
            <span>
              <span className="block font-medium text-slate-900">{compareLabel}</span>
              <span className="block text-xs text-slate-500">{compareDescription}</span>
            </span>
          </button>
          {hasMeetingDocuments ? (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                closeMenu();
                onOpenDocuments();
              }}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <MeetingDocumentsIcon className="h-5 w-5 shrink-0 text-slate-500" />
              <span>
                <span className="block font-medium text-slate-900">Meeting documents</span>
                <span className="block text-xs text-slate-500">Transcript and board package</span>
              </span>
            </button>
          ) : null}
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              closeMenu();
              onOpenUsage();
            }}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            <AiUsageMenuIcon className="h-5 w-5 shrink-0 text-slate-500" />
            <span>
              <span className="block font-medium text-slate-900">AI usage &amp; cost</span>
              <span className="block text-xs text-slate-500">Token usage and spend by stage</span>
            </span>
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              closeMenu();
              onOpenPdfTemplate();
            }}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            <PdfTemplateMenuIcon className="h-5 w-5 shrink-0 text-slate-500" />
            <span>
              <span className="block font-medium text-slate-900">PDF template</span>
              <span className="block text-xs text-slate-500">
                Margins and layout for minutes export
              </span>
            </span>
          </button>
          <PullMeetingSourcesButton
            meetingId={meetingId}
            showWhenSourcesMissing
            sourcesMissing={sourcesMissing}
            presentation="menuItem"
            onMenuOpen={closeMenu}
            onPulled={onSourcesPulled}
          />
          <div className="my-1 border-t border-slate-100" />
          <DeleteMeetingButton
            meetingId={meetingId}
            meetingTitle={meetingTitle}
            redirectTo="/operations/meetings"
            apiVersion="v2"
            presentation="menuItem"
            onMenuOpen={closeMenu}
          />
        </div>
      ) : null}
    </div>
  );
}

function EllipsisVerticalIcon() {
  return (
    <svg aria-hidden className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}

function DocumentsCompareIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 4.5h9a1 1 0 0 1 1 1v12.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6.5h9a1 1 0 0 1 1 1v12.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1Z"
      />
      <path strokeLinecap="round" d="M12.5 10h4.5M12.5 13h3.5M12.5 16h4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 20.5h4M6 18.5l-2 2 2 2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 20.5h-4M18 18.5l2 2-2 2" />
    </svg>
  );
}

function MeetingDocumentsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 4.5h8l3 3v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z"
      />
      <path strokeLinecap="round" d="M16 4.5v3h3M9 12h6M9 15.5h4.5" />
    </svg>
  );
}

function AiUsageMenuIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" d="M12 6v12M9.5 8.5c0-1.25 1.12-2.25 2.5-2.25s2.5 1 2.5 2.25M9.5 15.5c0 1.25 1.12 2.25 2.5 2.25s2.5-1 2.5-2.25" />
    </svg>
  );
}

function PdfTemplateMenuIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 4.5h8l3 3v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z"
      />
      <path strokeLinecap="round" d="M16 4.5v3h3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6M9 15h4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 19.5 4 21l1.5 1.5" />
    </svg>
  );
}

function PipelineActionButton({
  runBusy,
  pipelineNotStarted,
  pipelineValidated = false,
  pipelineActivelyRunning = false,
  disabled = false,
  disabledReason,
  onRun,
  onRestart,
  presentation = "header",
}: {
  runBusy: boolean;
  pipelineNotStarted: boolean;
  pipelineValidated?: boolean;
  pipelineActivelyRunning?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  onRun: () => void | Promise<void>;
  onRestart: () => void | Promise<void>;
  presentation?: "header" | "menu";
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PipelineConfirmAction>("start");
  const containerRef = useRef<HTMLDivElement>(null);
  const isDisabled = runBusy || disabled;

  function openConfirm(action: PipelineConfirmAction) {
    setPendingAction(action);
    setConfirmOpen(true);
    setMenuOpen(false);
  }

  function resolvePrimaryAction(): PipelineConfirmAction {
    if (pipelineNotStarted) return "start";
    if (pipelineValidated) return "rerun";
    return "resume";
  }

  async function handleConfirm() {
    try {
      if (pendingAction === "restart") {
        await onRestart();
      } else {
        await onRun();
      }
      setConfirmOpen(false);
    } catch {
      // Parent handlers swallow errors today; keep dialog open if thrown.
    }
  }

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
      : pipelineValidated
        ? "Re-running..."
        : "Resuming..."
    : pipelineActivelyRunning
      ? "Pipeline Running"
      : pipelineNotStarted
        ? "Start Pipeline"
        : pipelineValidated
          ? "Re-run Pipeline"
          : "Resume Pipeline";

  const title = isDisabled && disabledReason ? disabledReason : undefined;
  const showDropdown = pipelineValidated || !pipelineNotStarted;
  const inMenu = presentation === "menu";

  return (
    <div className={`relative ${inMenu ? "w-full" : ""}`} ref={containerRef} title={title}>
      <div
        className={`overflow-hidden rounded-lg shadow-md ${inMenu ? "flex w-full" : "inline-flex"}`}
      >
        <button
          className={`inline-flex items-center bg-teal-500 text-sm font-semibold text-slate-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50 ${
            inMenu ? "min-w-0 flex-1 justify-center px-3 py-2" : "px-3 py-2"
          }`}
          disabled={isDisabled}
          onClick={() => openConfirm(resolvePrimaryAction())}
          type="button"
          title={title}
        >
          {primaryLabel}
        </button>
        <button
          className="inline-flex items-center border-l border-teal-600/30 bg-teal-500 px-2 py-2 text-slate-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isDisabled || !showDropdown}
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
      {menuOpen && showDropdown ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            role="menuitem"
            type="button"
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => openConfirm("restart")}
          >
            Restart from Beginning
          </button>
        </div>
      ) : null}
      <PipelineRunConfirmDialog
        open={confirmOpen}
        action={pendingAction}
        busy={runBusy}
        onConfirm={() => void handleConfirm()}
        onCancel={() => {
          if (!runBusy) setConfirmOpen(false);
        }}
      />
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
  const blockedCount = alerts.filter((alert) => alert.blocksPipeline).length;

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
        const stopped = Boolean(alert.blocksPipeline);
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

function SectionCard({
  eyebrow,
  title,
  description,
  headerAside,
  children,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  headerAside?: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${compact ? "p-4" : "p-5"}`}>
      <div
        className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${compact ? "mb-3" : "mb-4"}`}
      >
        <div className="min-w-0 space-y-1">
          {eyebrow ? (
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</p>
          ) : null}
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">{title}</h2>
          {description ? <p className="text-sm leading-5 text-slate-600">{description}</p> : null}
        </div>
        {headerAside ? <div className="shrink-0 self-start sm:pt-0.5">{headerAside}</div> : null}
      </div>
      {children}
    </div>
  );
}

function PreRunPanel({
  status,
  pipelineNotStarted,
  pipelineHalted,
  pipelineActivelyRunning,
  onOpenDocuments,
}: {
  status: MeetingV2Status;
  pipelineNotStarted: boolean;
  pipelineHalted: boolean;
  pipelineActivelyRunning: boolean;
  onOpenDocuments: () => void;
}) {
  const hasDocuments = Boolean(
    status.sources.transcript?.available || status.sources.boardPackage?.available,
  );

  return (
    <SectionCard
      eyebrow="Status"
      title={
        pipelineNotStarted
          ? "Ready to start"
          : pipelineHalted
            ? "Pipeline stopped"
            : pipelineActivelyRunning
              ? "Pipeline running"
              : "Pipeline not complete"
      }
      description={
        pipelineNotStarted
          ? "Your transcript and board package are uploaded. Click Start Pipeline when you are ready."
          : pipelineHalted
            ? "The pipeline did not finish successfully. Review the alerts above, then resume or restart the run."
            : pipelineActivelyRunning
              ? "Automated work is in progress. The step text and percentage above update as each sub-stage completes."
              : "The meeting workspace is set up but the pipeline has not reached validation yet. Start or resume the run to continue."
      }
      compact
    >
      <div className="grid gap-3 md:grid-cols-2">
        <HealthCallout
          label="Pipeline status"
          value={
            pipelineNotStarted ? "Ready to start" : startCase(status.meeting.computedPipelineState)
          }
          tone={pipelineNotStarted ? statusTone("created") : statusTone(status.meeting.computedPipelineState)}
          note={
            pipelineNotStarted
              ? "The automated pipeline has not started yet."
              : status.meeting.computedCurrentStep
          }
        />
        <HealthCallout
          label="Extraction quality"
          value={
            pipelineNotStarted
              ? "Not started"
              : pipelineActivelyRunning
                ? "Running"
                : status.meeting.extractionQuality.likelyIncomplete || pipelineHalted
                  ? "Needs attention"
                  : "In progress"
          }
          tone={
            pipelineNotStarted
              ? "border-slate-200 bg-slate-50 text-slate-700"
              : pipelineActivelyRunning
                ? "border-teal-200 bg-teal-50 text-teal-900"
                : status.meeting.extractionQuality.likelyIncomplete || pipelineHalted
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-slate-200 bg-slate-50 text-slate-700"
          }
          note={
            pipelineNotStarted
              ? "Agenda extraction runs after you start the pipeline."
              : formatExtractionQualitySummary(status.meeting.extractionQuality)
          }
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
  onGoToReview,
}: {
  status: MeetingV2Status;
  needsClarificationCount: number;
  flaggedCount: number;
  readyCount: number;
  onOpenDocuments: () => void;
  onGoToReview?: () => void;
}) {
  const hasDocuments = Boolean(
    status.sources.transcript?.available || status.sources.boardPackage?.available,
  );
  const isAgendaApprovalPending = Boolean(
    status.items.length > 0 &&
      (!status.meeting.agendaApproval?.approvedAt ||
        status.meeting.computedPipelineState === "extracted"),
  );

  return (
    <SectionCard
      eyebrow="Overview"
      title="Meeting status & readiness"
      description="Pipeline health, source coverage, and review readiness in one place."
      compact
    >
      {isAgendaApprovalPending ? (
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
              <p className="font-semibold text-sm">Action Required: Agenda Review & Approval</p>
            </div>
            <p className="text-xs text-amber-800 mt-1">
              Candidate agenda has been synthesized from the board package and recording. Please verify which topics were discussed and resolve any detected transcript discrepancies before investigation.
            </p>
          </div>
          {onGoToReview ? (
            <button
              type="button"
              onClick={onGoToReview}
              className="shrink-0 rounded-lg bg-amber-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-800 transition"
            >
              Review Agenda →
            </button>
          ) : null}
        </div>
      ) : null}

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

function parseSourceSnippet(rawText: string, itemTitle: string) {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let timing: string | null = null;
  const chunkIds: string[] = [];
  let evidenceStrength: string | null = null;
  let status: string | null = null;
  const contentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("Discussion status:")) {
      status = line.replace("Discussion status:", "").trim();
    } else if (line.startsWith("Discussion timing:")) {
      timing = line.replace("Discussion timing:", "").trim();
    } else if (line.startsWith("Chunk IDs:")) {
      const parts = line.replace("Chunk IDs:", "").split(",");
      for (const p of parts) {
        const id = p.trim();
        if (id) chunkIds.push(id);
      }
    } else if (line.startsWith("Transcript ranges:")) {
      // Ignored: internal database sequence indices
    } else if (line.startsWith("Evidence strength:")) {
      evidenceStrength = line.replace("Evidence strength:", "").trim();
    } else {
      // Check if line duplicates the item title
      const normLine = line.toLowerCase().replace(/[^a-z0-9]/g, "");
      const normTitle = itemTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (
        normLine &&
        normTitle &&
        (normLine === normTitle ||
          normTitle.startsWith(normLine) ||
          normLine.startsWith(normTitle))
      ) {
        // Skip duplicate title line
        continue;
      }
      contentLines.push(line);
    }
  }

  const isUncertain =
    evidenceStrength?.toUpperCase() === "UNCERTAIN" ||
    rawText.includes("UNCERTAIN");

  return {
    timing,
    chunkIds,
    evidenceStrength,
    status,
    contentLines,
    isUncertain,
  };
}

type AgendaReviewTab = "agenda" | "discrepancies";
type AgendaReviewItem = MeetingV2Status["items"][number];
type AgendaOutlineNode = OutlineTreeNode<AgendaReviewItem> & {
  subItems: Array<{ label: string; title: string }>;
};

function getDiscrepancyKind(disc: {
  kind?: "add_to_agenda" | "status_inquiry";
  id?: string;
  clarificationQuestion?: string;
}): "add_to_agenda" | "status_inquiry" {
  return resolveTranscriptDiscrepancyKind(disc);
}

function extractAgendaSubItemsFromSource(
  item: MeetingV2Status["items"][number],
): Array<{ label: string; title: string }> {
  const sourceText = item.sourceText ?? "";
  const notesMatch = sourceText.match(/Notes:\s*(.+?)(?:\n|$)/i);
  if (notesMatch) {
    const parts = notesMatch[1]
      .split(/[;•|]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      return parts.map((title, index) => ({
        label: String.fromCharCode(97 + index),
        title,
      }));
    }
  }

  const aliasesMatch = sourceText.match(/Aliases:\s*(.+?)(?:\n|$)/i);
  if (aliasesMatch) {
    const parts = aliasesMatch[1]
      .split(/[;•|]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      return parts.map((title, index) => ({
        label: String.fromCharCode(97 + index),
        title,
      }));
    }
  }

  return [];
}

function attachSourceSubItems(nodes: Array<OutlineTreeNode<AgendaReviewItem>>): AgendaOutlineNode[] {
  return nodes.map((node) => ({
    ...node,
    subItems: node.children.length > 0 ? [] : extractAgendaSubItemsFromSource(node.item),
    children: attachSourceSubItems(node.children),
  }));
}

function syntheticReviewItem(options: {
  id: string;
  title: string;
  itemNumber: string;
  sectionLabel: string;
  discussionStatus: "discussed" | "ad_hoc";
}): AgendaReviewItem {
  return {
    id: options.id,
    title: options.title,
    itemNumber: options.itemNumber,
    itemType: "ad_hoc_discussion",
    sectionLabel: options.sectionLabel,
    sourceText: `Discussion status: ${options.discussionStatus}`,
    discussionStatus: options.discussionStatus,
    sourceSectionId: null,
    sourcePages: [],
    discussionSummary: null,
    confidence: null,
    outcome: null,
    openQuestions: [],
    userAnswers: null,
    validation: [],
    evidence: [],
  };
}

function mergeAdHocItemsIntoReview(
  items: AgendaReviewItem[],
  newItems: Array<{
    id: string;
    title: string;
    sectionLabel: string;
    discussionStatus: "discussed" | "ad_hoc";
  }>,
): AgendaReviewItem[] {
  if (newItems.length === 0) return items;
  const placement = planAdHocPlacement(
    items.map((item) => item.itemNumber),
    newItems.length,
    inferPropertyManagementReportNumber(items),
  );
  if (!placement) return items;

  const extras: AgendaReviewItem[] = [];
  if (placement.sectionMissing) {
    extras.push(
      syntheticReviewItem({
        id: "synthetic-adhoc-section",
        title: "Ad-hoc items",
        itemNumber: placement.sectionCode,
        sectionLabel: "Property Management Report",
        discussionStatus: "ad_hoc",
      }),
    );
  }
  newItems.forEach((item, index) => {
    extras.push(
      syntheticReviewItem({
        id: item.id,
        title: item.title,
        itemNumber: placement.nextItemCodes[index],
        sectionLabel: item.sectionLabel || "Property Management Report: Ad-hoc items",
        discussionStatus: item.discussionStatus,
      }),
    );
  });
  return [...items, ...extras];
}

function buildAgendaOutline(items: MeetingV2Status["items"]): AgendaOutlineNode[] {
  const tree = attachSourceSubItems(buildAgendaOutlineTree(items));
  decorateAgendaOutlineTree(tree, {
    items,
    getTiming: (item) => parseSourceSnippet(item.sourceText || "", item.title || "").timing,
  });
  return tree;
}

function filterItemsForValidatedReview(
  items: AgendaReviewItem[],
  agendaApproval?: MeetingV2Status["meeting"]["agendaApproval"],
): AgendaReviewItem[] {
  const excluded = new Set(agendaApproval?.excludedItemIds ?? []);
  const itemStatuses = agendaApproval?.itemStatuses ?? {};

  return filterAgendaItemsPreservingAncestors(items, (item) => {
    if (excluded.has(item.id)) return false;
    const status = itemStatuses[item.id] ?? item.discussionStatus ?? "discussed";
    return status !== "not_discussed";
  });
}

function findAgendaItemForDiscrepancy(
  items: MeetingV2Status["items"],
  suggestedTitle: string,
): MeetingV2Status["items"][number] | null {
  const normalizedSuggested = suggestedTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalizedSuggested) return null;

  let best: MeetingV2Status["items"][number] | null = null;
  let bestScore = 0;

  for (const item of items) {
    const normalizedTitle = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!normalizedTitle) continue;
    if (
      normalizedTitle === normalizedSuggested ||
      normalizedTitle.includes(normalizedSuggested) ||
      normalizedSuggested.includes(normalizedTitle)
    ) {
      const score = Math.min(normalizedTitle.length, normalizedSuggested.length);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
  }

  return best;
}

function SourceSnippetPopover({
  parsedSnippet,
  onSelectChunkId,
  onSelectTimeRange,
}: {
  parsedSnippet: ReturnType<typeof parseSourceSnippet>;
  onSelectChunkId: (chunkId: string) => void;
  onSelectTimeRange: (timeRange: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-700"
      >
        {open ? "Hide source text" : "Show source text snippet"}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-[min(22rem,calc(100vw-2rem))] space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
          {parsedSnippet.timing ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-600">Timing:</span>
              <button
                type="button"
                onClick={() => onSelectTimeRange(parsedSnippet.timing!)}
                className="inline-flex items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-teal-800 transition hover:bg-teal-100"
                title="Click to view discussion in transcript"
              >
                <span>🎧</span> {parsedSnippet.timing}
              </button>
            </div>
          ) : null}

          {parsedSnippet.chunkIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-600">Referenced Chunks:</span>
              {parsedSnippet.chunkIds.map((chunkId) => (
                <button
                  key={chunkId}
                  type="button"
                  onClick={() => onSelectChunkId(chunkId)}
                  className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100"
                  title={`Click to inspect ${chunkId}`}
                >
                  <span>{chunkId.startsWith("doc") ? "📄" : "🎙️"}</span> {chunkId}
                </button>
              ))}
            </div>
          ) : null}

          {parsedSnippet.evidenceStrength ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-600">Evidence strength:</span>
              <span
                className={`rounded px-1.5 py-0.2 font-mono text-[11px] font-bold ${
                  parsedSnippet.isUncertain
                    ? "border border-amber-300 bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-800"
                }`}
              >
                {parsedSnippet.evidenceStrength}
              </span>
            </div>
          ) : null}

          {parsedSnippet.contentLines.length > 0 ? (
            <div className="border-t border-slate-200/80 pt-1 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-600">
              {parsedSnippet.contentLines.join("\n")}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AgendaReviewListItem({
  item,
  displayNumber,
  listMarker = "decimal",
  subItems = [],
  discussionTiming = null,
  showStatusControls = true,
  isHeading = false,
  itemStatuses,
  excludedItemIds,
  editedTitles,
  editingItemId,
  onToggleStatus,
  onToggleExclude,
  onEditTitle,
  onSetEditingItemId,
  onSelectChunkId,
  onSelectTimeRange,
  goldStandardFindings,
  onOpenGoldStandardPanel,
}: {
  item: MeetingV2Status["items"][number];
  displayNumber: string;
  listMarker?: AgendaListMarker;
  subItems?: Array<{ label: string; title: string }>;
  discussionTiming?: string | null;
  showStatusControls?: boolean;
  isHeading?: boolean;
  itemStatuses: Record<string, "discussed" | "not_discussed" | "ad_hoc">;
  excludedItemIds: Set<string>;
  editedTitles: Record<string, string>;
  editingItemId: string | null;
  onToggleStatus: (itemId: string, nextStatus: "discussed" | "not_discussed" | "ad_hoc") => void;
  onToggleExclude: (itemId: string) => void;
  onEditTitle: (itemId: string, title: string) => void;
  onSetEditingItemId: (itemId: string | null) => void;
  onSelectChunkId: (chunkId: string) => void;
  onSelectTimeRange: (timeRange: string) => void;
  goldStandardFindings?: ItemGoldStandardFindings;
  onOpenGoldStandardPanel?: (
    tab: GoldStandardValidationTab,
    agendaItemId?: string,
  ) => void;
}) {
  const isExcluded = excludedItemIds.has(item.id);
    const currentStatus = itemStatuses[item.id] || item.discussionStatus || "discussed";
  const displayTitle = editedTitles[item.id] ?? item.title;
  const isEditingThis = editingItemId === item.id;
  const parsedSnippet = parseSourceSnippet(item.sourceText || "", displayTitle);
  if (discussionTiming) parsedSnippet.timing = discussionTiming;
  const isRyanRatcliffGuestItem = displayTitle.toLowerCase().includes("ryan ratcliff");

  return (
    <li
      className={`border-b border-slate-100 last:border-b-0 ${
        isExcluded
          ? "bg-slate-50/60 opacity-60"
          : currentStatus === "not_discussed"
            ? "bg-slate-50/30"
            : "hover:bg-slate-50/40"
      }`}
    >
      <div className="flex gap-3 px-4 py-3">
        <div
          className={`shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-slate-700 ${
            listMarker === "decimal" ? "w-8" : "w-6"
          }`}
        >
          {`${displayNumber}.`}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {isEditingThis ? (
                  <input
                    type="text"
                    value={displayTitle}
                    onChange={(event) => onEditTitle(item.id, event.target.value)}
                    onBlur={() => onSetEditingItemId(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onSetEditingItemId(null);
                    }}
                    autoFocus
                    className="rounded-md border border-teal-500 px-2 py-0.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                ) : (
                  <span
                    onDoubleClick={() => onSetEditingItemId(item.id)}
                    className={`cursor-pointer text-sm font-semibold ${
                      isExcluded ? "line-through text-slate-400" : "text-slate-900"
                    }`}
                    title="Double-click to edit title"
                  >
                    {displayTitle}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => onSetEditingItemId(isEditingThis ? null : item.id)}
                  className="text-[11px] text-slate-400 hover:text-slate-600"
                  title="Edit title"
                >
                  ✏️
                </button>

                {item.sourcePages && item.sourcePages.length > 0 ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                    📄 p. {item.sourcePages.join(", ")}
                  </span>
                ) : null}

                {!isHeading && currentStatus === "not_discussed" ? (
                  <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    Deferred (Zero LLM Tokens)
                  </span>
                ) : !isHeading && currentStatus === "ad_hoc" ? (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    Ad-Hoc Discussion
                  </span>
                ) : !isHeading && parsedSnippet.isUncertain ? (
                  <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    ⚠️ Uncertain Match
                  </span>
                ) : !isHeading ? (
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    Verified in Audio
                  </span>
                ) : null}

                {isRyanRatcliffGuestItem ? (
                  <span
                    className="cursor-help rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800"
                    title="Ryan Ratcliff was not present in this recording; discussion was only mentioned while amending prior minutes."
                  >
                    ℹ️ Presenter not in audio
                  </span>
                ) : null}

                <GoldStandardItemFindingBadgesRow
                  findings={goldStandardFindings}
                  agendaItemId={item.id}
                  onOpenGoldStandardPanel={onOpenGoldStandardPanel}
                />
              </div>

              {subItems.length > 0 ? (
                <ol className="ml-1 list-[lower-alpha] space-y-1 pl-5 text-sm text-slate-700 marker:font-semibold marker:text-slate-500">
                  {subItems.map((subItem) => (
                    <li key={`${item.id}-${subItem.label}`}>{subItem.title}</li>
                  ))}
                </ol>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              {showStatusControls ? (
                <>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => onToggleStatus(item.id, "discussed")}
                        disabled={isExcluded}
                        className={`rounded-md px-2.5 py-1 transition ${
                          currentStatus === "discussed" && !isExcluded
                            ? "bg-emerald-600 font-semibold text-white shadow-sm"
                            : "text-slate-600 hover:text-slate-900 disabled:opacity-40"
                        }`}
                        title="Verified in audio transcript"
                      >
                        🟢 Discussed
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleStatus(item.id, "not_discussed")}
                        disabled={isExcluded}
                        className={`rounded-md px-2.5 py-1 transition ${
                          currentStatus === "not_discussed" && !isExcluded
                            ? "bg-slate-700 font-semibold text-white shadow-sm"
                            : "text-slate-600 hover:text-slate-900 disabled:opacity-40"
                        }`}
                        title="Adjourned / not reached in this recording (skips LLM investigation)"
                      >
                        ⏸️ Not Discussed
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleStatus(item.id, "ad_hoc")}
                        disabled={isExcluded}
                        className={`rounded-md px-2.5 py-1 transition ${
                          currentStatus === "ad_hoc" && !isExcluded
                            ? "bg-amber-600 font-semibold text-white shadow-sm"
                            : "text-slate-600 hover:text-slate-900 disabled:opacity-40"
                        }`}
                        title="Informal / ad-hoc discussion not in formal agenda"
                      >
                        ⚡ Ad-Hoc
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => onToggleExclude(item.id)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition ${
                        isExcluded
                          ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          : "border-transparent text-rose-600 hover:bg-rose-50"
                      }`}
                    >
                      {isExcluded ? "↩️ Restore" : "Exclude"}
                    </button>
                  </div>
                </>
              ) : null}

              {item.sourceText ? (
                <SourceSnippetPopover
                  parsedSnippet={parsedSnippet}
                  onSelectChunkId={onSelectChunkId}
                  onSelectTimeRange={onSelectTimeRange}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function ValidatedAgendaReviewListItem({
  item,
  displayNumber,
  listMarker = "decimal",
  subItems = [],
  discussionTiming = null,
  isHeading = false,
  isOpen,
  answers,
  dirtyItems,
  busyItemId,
  onToggleOpen,
  onAnswerChange,
  onSubmit,
  onOpenDetailPanel,
  onSelectChunkId,
  onSelectTimeRange,
  goldStandardFindings,
  onOpenGoldStandardPanel,
}: {
  item: AgendaReviewItem;
  displayNumber: string;
  listMarker?: AgendaListMarker;
  subItems?: Array<{ label: string; title: string }>;
  discussionTiming?: string | null;
  isHeading?: boolean;
  isOpen: boolean;
  answers: Record<string, string>;
  dirtyItems: Record<string, boolean>;
  busyItemId: string | null;
  onToggleOpen: () => void;
  onAnswerChange: (itemId: string, value: string) => void;
  onSubmit: (itemId: string) => void;
  onOpenDetailPanel: (item: AgendaReviewItem, initialTab: "flags" | "questions" | "evidence") => void;
  onSelectChunkId: (chunkId: string) => void;
  onSelectTimeRange: (timeRange: string) => void;
  goldStandardFindings?: ItemGoldStandardFindings;
  onOpenGoldStandardPanel?: (
    tab: GoldStandardValidationTab,
    agendaItemId?: string,
  ) => void;
}) {
  const flagCount = item.validation.filter(
    (validation) => validation.severity === "error" || validation.severity === "warning",
  ).length;
  const openQuestionCount = item.openQuestions.length;
  const hasErrorFlags = item.validation.some((validation) => validation.severity === "error");
  const parsedSnippet = parseSourceSnippet(item.sourceText || "", item.title);
  if (discussionTiming) parsedSnippet.timing = discussionTiming;

  return (
    <li
      className={`border-b border-slate-100 last:border-b-0 ${
        isHeading
          ? "hover:bg-slate-50/40"
          : openQuestionCount > 0
            ? "bg-amber-50/30"
            : flagCount > 0
              ? hasErrorFlags
                ? "bg-rose-50/20"
                : "bg-amber-50/20"
              : "hover:bg-slate-50/40"
      }`}
    >
      <div className="flex gap-3 px-4 py-3">
        <div
          className={`shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-slate-700 ${
            listMarker === "decimal" ? "w-8" : "w-6"
          }`}
        >
          {`${displayNumber}.`}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div
                role={isHeading ? undefined : "button"}
                tabIndex={isHeading ? undefined : 0}
                onClick={isHeading ? undefined : onToggleOpen}
                onKeyDown={
                  isHeading
                    ? undefined
                    : (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onToggleOpen();
                        }
                      }
                }
                className={`flex w-full flex-wrap items-center gap-2 text-left ${
                  isHeading ? "" : "cursor-pointer"
                }`}
              >
                <span className="text-sm font-semibold text-slate-900">{item.title}</span>

                {item.sourcePages && item.sourcePages.length > 0 ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                    📄 p. {item.sourcePages.join(", ")}
                  </span>
                ) : null}

                {discussionTiming ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectTimeRange(discussionTiming);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-teal-800 transition hover:bg-teal-100"
                    title="Click to view discussion in transcript"
                  >
                    <span>🎧</span> {discussionTiming}
                  </button>
                ) : null}

                {!isHeading ? (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${outcomeTone(item.outcome)}`}
                  >
                    {startCase(item.outcome ?? "pending")}
                  </span>
                ) : null}

                {!isHeading ? (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                    {item.confidence ? startCase(item.confidence) : "Unknown"}
                  </span>
                ) : null}

                {!isHeading && openQuestionCount > 0 ? (
                  <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-950">
                    {openQuestionCount} {openQuestionCount === 1 ? "Question" : "Questions"}
                  </span>
                ) : null}

                {!isHeading && flagCount > 0 ? (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                      hasErrorFlags
                        ? "border-rose-300 bg-rose-100 text-rose-950"
                        : "border-amber-300 bg-amber-50 text-amber-950"
                    }`}
                  >
                    {flagCount} {flagCount === 1 ? "Flag" : "Flags"}
                  </span>
                ) : null}
              </div>

              {!isHeading && goldStandardFindings && onOpenGoldStandardPanel ? (
                <GoldStandardItemFindingBadgesRow
                  findings={goldStandardFindings}
                  agendaItemId={item.id}
                  onOpenGoldStandardPanel={onOpenGoldStandardPanel}
                />
              ) : null}

              {!isHeading && item.discussionSummary ? (
                <p className="text-xs leading-5 text-slate-600">{item.discussionSummary}</p>
              ) : null}

              {subItems.length > 0 ? (
                <ol className="ml-1 list-[lower-alpha] space-y-1 pl-5 text-sm text-slate-700 marker:font-semibold marker:text-slate-500">
                  {subItems.map((subItem) => (
                    <li key={`${item.id}-${subItem.label}`}>{subItem.title}</li>
                  ))}
                </ol>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              {item.sourceText ? (
                <SourceSnippetPopover
                  parsedSnippet={parsedSnippet}
                  onSelectChunkId={onSelectChunkId}
                  onSelectTimeRange={onSelectTimeRange}
                />
              ) : null}
            </div>
          </div>

          {!isHeading && isOpen ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    onOpenDetailPanel(
                      item,
                      flagCount > 0 ? "flags" : openQuestionCount > 0 ? "questions" : "evidence",
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900"
                >
                  <span>Flags, questions & evidence</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {flagCount + openQuestionCount + (item.evidence?.length ?? 0)}
                  </span>
                </button>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)]">
                <div className="space-y-3">
                  <label
                    htmlFor={`clarification-${item.id}`}
                    className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500"
                  >
                    Clarification
                  </label>
                  <textarea
                    id={`clarification-${item.id}`}
                    className="min-h-28 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    onChange={(event) => onAnswerChange(item.id, event.target.value)}
                    placeholder="Add a precise clarification for this agenda item if needed..."
                    value={answers[item.id] ?? ""}
                  />
                  <div className="flex items-center gap-3">
                    <button
                      className="inline-flex items-center rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busyItemId === item.id}
                      onClick={() => onSubmit(item.id)}
                      type="button"
                    >
                      {busyItemId === item.id ? "Submitting..." : "Submit & Re-evaluate"}
                    </button>
                    {dirtyItems[item.id] ? (
                      <span className="text-xs text-slate-500">Unsaved clarification</span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Review Snapshot
                  </h4>
                  <dl className="mt-3 space-y-2 text-xs">
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
      </div>
    </li>
  );
}

function HitlAgendaApprovalWorkspace({
  meetingId,
  status,
  onApproved,
  onSwitchToValidatedReview,
  headerAside,
  goldStandardFindingsByItemId,
  onOpenGoldStandardPanel,
}: {
  meetingId: string;
  status: MeetingV2Status;
  onApproved?: () => void;
  onSwitchToValidatedReview?: () => void;
  headerAside?: ReactNode;
  goldStandardFindingsByItemId?: Map<string, ItemGoldStandardFindings>;
  onOpenGoldStandardPanel?: (
    tab: GoldStandardValidationTab,
    agendaItemId?: string,
  ) => void;
}) {
  const [itemStatuses, setItemStatuses] = useState<Record<string, "discussed" | "not_discussed" | "ad_hoc">>(() => {
    const initial: Record<string, "discussed" | "not_discussed" | "ad_hoc"> = {};
    for (const item of status.items) {
      initial[item.id] =
        status.meeting.agendaApproval?.itemStatuses?.[item.id] ||
        item.discussionStatus ||
        "discussed";
    }
    return initial;
  });

  const [excludedItemIds, setExcludedItemIds] = useState<Set<string>>(() => {
    return new Set(status.meeting.agendaApproval?.excludedItemIds || []);
  });

  const [editedTitles, setEditedTitles] = useState<Record<string, string>>({});
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const initialDiscrepancies = useMemo(() => {
    const raw = status.meeting.agendaApproval?.discrepancies || [];
    const seen = new Set<string>();
    return raw.filter((disc) => {
      if (seen.has(disc.id)) return false;
      seen.add(disc.id);
      return true;
    });
  }, [status.meeting.agendaApproval?.discrepancies]);

  const [discrepancyActions, setDiscrepancyActions] = useState<
    Record<string, "pending" | "accepted" | "dismissed">
  >(() => {
    const initial: Record<string, "pending" | "accepted" | "dismissed"> = {};
    for (const disc of initialDiscrepancies) {
      initial[disc.id] = disc.status || "pending";
    }
    return initial;
  });

  const [newItems, setNewItems] = useState<
    Array<{
      id: string;
      title: string;
      sectionLabel: string;
      discussionStatus: "discussed" | "ad_hoc";
    }>
  >([]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSection, setNewSection] = useState("");
  const [newStatus, setNewStatus] = useState<"discussed" | "ad_hoc">("discussed");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState<string | null>(null);
  const [activeReviewTab, setActiveReviewTab] = useState<AgendaReviewTab>("agenda");

  const isApproved = Boolean(status.meeting.agendaApproval?.approvedAt);

  const hasApprovalChanges = useMemo(() => {
    const savedItemStatuses = status.meeting.agendaApproval?.itemStatuses ?? {};
    const savedExcludedIds = new Set(status.meeting.agendaApproval?.excludedItemIds ?? []);

    for (const item of status.items) {
      const saved =
        savedItemStatuses[item.id] ?? item.discussionStatus ?? "discussed";
      const current = itemStatuses[item.id] ?? saved;
      if (current !== saved) return true;
    }

    if (excludedItemIds.size !== savedExcludedIds.size) return true;
    for (const id of excludedItemIds) {
      if (!savedExcludedIds.has(id)) return true;
    }
    for (const id of savedExcludedIds) {
      if (!excludedItemIds.has(id)) return true;
    }

    for (const [id, title] of Object.entries(editedTitles)) {
      const item = status.items.find((entry) => entry.id === id);
      if (item && title.trim() !== item.title) return true;
    }

    if (newItems.length > 0) return true;

    for (const disc of initialDiscrepancies) {
      const saved = disc.status || "pending";
      const current = discrepancyActions[disc.id] || "pending";
      if (current !== saved) return true;
    }

    return false;
  }, [
    status.items,
    status.meeting.agendaApproval?.itemStatuses,
    status.meeting.agendaApproval?.excludedItemIds,
    itemStatuses,
    excludedItemIds,
    editedTitles,
    newItems,
    initialDiscrepancies,
    discrepancyActions,
  ]);

  const activeItems = status.items.filter((item) => !excludedItemIds.has(item.id));
  const discussedCount =
    activeItems.filter((item) => (itemStatuses[item.id] || "discussed") === "discussed").length +
    newItems.filter((i) => i.discussionStatus === "discussed").length;

  const approvalButtonDisabled =
    submitting || discussedCount === 0 || (isApproved && !hasApprovalChanges);
  const approvalButtonDisabledReason = isApproved && !hasApprovalChanges
    ? "No agenda changes to save"
    : discussedCount === 0
      ? "At least one discussed item is required"
      : undefined;
  const approvalConfirmMode: AgendaApprovalConfirmMode = isApproved ? "update" : "approve";

  const deferredCount = activeItems.filter(
    (item) => itemStatuses[item.id] === "not_discussed",
  ).length;

  const adHocCount =
    activeItems.filter((item) => itemStatuses[item.id] === "ad_hoc").length +
    newItems.filter((i) => i.discussionStatus === "ad_hoc").length;

  const excludedCount = excludedItemIds.size;

  const agendaTitlesForDedup = useMemo(
    () => [
      ...status.items.map((item) => editedTitles[item.id] ?? item.title),
      ...newItems.map((item) => item.title),
    ],
    [status.items, editedTitles, newItems],
  );

  const visibleDiscrepancies = useMemo(
    () => filterRedundantAddToAgendaDiscrepancies(initialDiscrepancies, agendaTitlesForDedup),
    [initialDiscrepancies, agendaTitlesForDedup],
  );

  const pendingDiscrepancies = visibleDiscrepancies.filter(
    (d) => (discrepancyActions[d.id] || "pending") === "pending",
  );

  function handleToggleStatus(itemId: string, nextStatus: "discussed" | "not_discussed" | "ad_hoc") {
    setItemStatuses((prev) => ({ ...prev, [itemId]: nextStatus }));
  }

  function handleToggleExclude(itemId: string) {
    setExcludedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  function handleAcceptDiscrepancy(disc: {
    id: string;
    suggestedTitle: string;
    suggestedSection?: string | null;
  }) {
    setDiscrepancyActions((prev) => ({ ...prev, [disc.id]: "accepted" }));
    const newId = `disc-${disc.id}`;
    setItemStatuses((prev) => ({ ...prev, [newId]: "ad_hoc" }));
    setNewItems((prev) => [
      ...prev,
      {
        id: newId,
        title: disc.suggestedTitle,
        sectionLabel: disc.suggestedSection || "Property Management Report: Ad-hoc items",
        discussionStatus: "ad_hoc",
      },
    ]);
  }

  function handleDismissDiscrepancy(discId: string) {
    setDiscrepancyActions((prev) => ({ ...prev, [discId]: "dismissed" }));
  }

  function handleMarkNotDiscussedFromInquiry(disc: {
    id: string;
    suggestedTitle: string;
  }) {
    const matchingItem = findAgendaItemForDiscrepancy(status.items, disc.suggestedTitle);
    if (matchingItem) {
      setItemStatuses((prev) => ({ ...prev, [matchingItem.id]: "not_discussed" }));
    }
    setDiscrepancyActions((prev) => ({ ...prev, [disc.id]: "dismissed" }));
  }

  function handleKeepAgendaItemFromInquiry(discId: string) {
    setDiscrepancyActions((prev) => ({ ...prev, [discId]: "dismissed" }));
  }

  function handleAddNewItem() {
    if (!newTitle.trim()) return;
    const newId = `custom-${Date.now()}`;
    setItemStatuses((prev) => ({ ...prev, [newId]: newStatus }));
    setNewItems((prev) => [
      ...prev,
      {
        id: newId,
        title: newTitle.trim(),
        sectionLabel: newSection.trim() || "Property Management Report: Ad-hoc items",
        discussionStatus: newStatus,
      },
    ]);
    setNewTitle("");
    setNewSection("");
    setShowAddForm(false);
  }

  function handleRemoveNewItem(id: string) {
    setNewItems((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleApproveAndProceed() {
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const itemUpdates = Object.entries(editedTitles).map(([id, title]) => ({
        id,
        title,
      }));

      const payload = {
        itemStatuses,
        excludedItemIds: Array.from(excludedItemIds),
        itemUpdates,
        newItems: newItems.map((item) => ({
          title: item.title,
          sectionLabel: item.sectionLabel,
          discussionStatus: item.discussionStatus,
        })),
        discrepancyActions: Object.entries(discrepancyActions)
          .filter(([, action]) => action !== "pending")
          .map(([id, action]) => ({
            id,
            action: action === "accepted" ? "accept" : "dismiss",
            title: initialDiscrepancies.find((d) => d.id === id)?.suggestedTitle,
          })),
      };

      const res = await fetch(`/api/v2/meetings/${meetingId}/agenda/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setSubmitSuccess(
        isApproved
          ? "Agenda approval updated! Resuming pipeline for investigated items..."
          : "Agenda approved! Resuming pipeline for investigated items...",
      );
      setConfirmOpen(false);
      onApproved?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to approve agenda");
    } finally {
      setSubmitting(false);
    }
  }

  // Group status.items by sectionLabel for optional section headings
  const itemsBySection = useMemo(() => {
    const map = new Map<string, typeof status.items>();
    for (const item of status.items) {
      const sec = item.sectionLabel || "General Business";
      if (!map.has(sec)) {
        map.set(sec, []);
      }
      map.get(sec)!.push(item);
    }
    return map;
  }, [status.items]);

  const adHocPlacement = useMemo(
    () =>
      planAdHocPlacement(
        status.items.map((item) => item.itemNumber),
        newItems.length,
        inferPropertyManagementReportNumber(status.items),
      ),
    [status.items, newItems.length],
  );

  const agendaOutline = useMemo(
    () => buildAgendaOutline(mergeAdHocItemsIntoReview(status.items, newItems)),
    [status.items, newItems],
  );

  function renderOutlineNodes(
    nodes: AgendaOutlineNode[],
    depth = 0,
  ): ReactNode {
    return nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isHeading = hasChildren || node.item.itemType === "agenda_section";
      const showStatusControls = !isHeading;

      return (
        <div key={node.item.id}>
          <AgendaReviewListItem
            item={node.item}
            displayNumber={node.displayNumber}
            listMarker={node.listMarker}
            subItems={node.subItems}
            discussionTiming={node.discussionTiming ?? null}
            showStatusControls={showStatusControls}
            isHeading={isHeading}
            itemStatuses={itemStatuses}
            excludedItemIds={excludedItemIds}
            editedTitles={editedTitles}
            editingItemId={editingItemId}
            onToggleStatus={handleToggleStatus}
            onToggleExclude={handleToggleExclude}
            onEditTitle={(itemId, title) =>
              setEditedTitles((prev) => ({ ...prev, [itemId]: title }))
            }
            onSetEditingItemId={setEditingItemId}
            onSelectChunkId={setSelectedChunkId}
            onSelectTimeRange={setSelectedTimeRange}
            goldStandardFindings={goldStandardFindingsByItemId?.get(node.item.id)}
            onOpenGoldStandardPanel={onOpenGoldStandardPanel}
          />
          {hasChildren ? (
            <ol
              className={`list-none border-l border-slate-200 pl-5 sm:pl-6 ${
                depth === 0 ? "border-t border-slate-100 bg-slate-50/40" : "bg-white/70"
              }`}
            >
              {renderOutlineNodes(node.children, depth + 1)}
            </ol>
          ) : null}
        </div>
      );
    });
  }

  return (
    <SectionCard
      eyebrow="Human-in-the-Loop Agenda Review"
      title={isApproved ? "Approved Meeting Agenda" : "Review & Approve Candidate Agenda"}
      description="The AI synthesized this candidate agenda by cross-referencing the Board Package and the recording transcript. Confirm which topics were discussed vs. adjourned or skipped, resolve any detected transcript discrepancies, and approve to proceed with targeted evidence gathering and investigation."
      headerAside={headerAside}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setActiveReviewTab("agenda")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tabTone(activeReviewTab === "agenda")}`}
          >
            Agenda
          </button>
          <button
            type="button"
            onClick={() => setActiveReviewTab("discrepancies")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tabTone(activeReviewTab === "discrepancies")}`}
          >
            AI Discrepancies
            {pendingDiscrepancies.length > 0 ? (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-200/90 px-2 py-0.5 text-xs font-bold text-amber-900">
                {pendingDiscrepancies.length}
              </span>
            ) : null}
          </button>
        </div>

        {activeReviewTab === "discrepancies" ? (
          <div className="space-y-4">
            {pendingDiscrepancies.length > 0 ? (
              <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-5 shadow-sm space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
                      !
                    </span>
                    <h3 className="font-semibold text-slate-900 text-sm">
                      AI Discrepancy Inquiries ({pendingDiscrepancies.length} pending)
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    Resolve transcript mismatches before approving the agenda. Some inquiries ask you to add a missing topic; others ask you to confirm whether an existing agenda item should stay on the list.
                  </p>
                </div>

                <div className="space-y-3">
                  {pendingDiscrepancies.map((disc) => {
                    const inquiryKind = getDiscrepancyKind(disc);
                    return (
                      <div
                        key={disc.id}
                        className="rounded-xl border border-amber-200 bg-white p-4 text-xs shadow-sm"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                                {disc.timestamp}
                              </span>
                              {disc.speaker ? (
                                <span className="font-semibold text-slate-700">{disc.speaker}</span>
                              ) : null}
                              <span className="font-semibold text-amber-900">{disc.suggestedTitle}</span>
                              <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                                {inquiryKind === "status_inquiry" ? "Status check" : "Missing topic"}
                              </span>
                            </div>
                            <p className="font-medium text-slate-800">{disc.clarificationQuestion}</p>
                            <p className="mt-1 border-l-2 border-slate-200 pl-2 italic text-slate-500">
                              &ldquo;{disc.snippet}&rdquo;
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2 pt-1 sm:pt-0">
                            {inquiryKind === "status_inquiry" ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleMarkNotDiscussedFromInquiry(disc)}
                                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
                                >
                                  Yes, Mark Not Discussed
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleKeepAgendaItemFromInquiry(disc.id)}
                                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                                >
                                  No, Keep on Agenda
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleAcceptDiscrepancy(disc)}
                                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                                >
                                  + Add to Agenda
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDismissDiscrepancy(disc.id)}
                                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                                >
                                  Dismiss
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-sm text-slate-600">
                No pending AI discrepancy inquiries. Switch to the Agenda tab to review extracted items.
              </div>
            )}
          </div>
        ) : null}

        {activeReviewTab === "agenda" ? (
          <>
            {newItems.length > 0 && !adHocPlacement ? (
              <div className="rounded-2xl border border-teal-200 bg-teal-50/50 p-4 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-teal-800">
                  New Ad-Hoc / Custom Agenda Items ({newItems.length})
                </h4>
                <div className="space-y-2">
                  {newItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-white px-4 py-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          Ad-Hoc
                        </span>
                        <span className="font-semibold text-slate-800">{item.title}</span>
                        <span className="text-slate-500">({item.sectionLabel})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveNewItem(item.id)}
                        className="text-xs font-medium text-rose-600 hover:text-rose-800"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Candidate Meeting Agenda
                </h4>
                <p className="mt-1 text-[11px] text-slate-500">
                  Official agenda order is preserved (1, 2, 3, 4.A.1, 4.D.a). Transcript-only items nest under 4.E.
                </p>
              </div>

              <ol className="list-none">
                {renderOutlineNodes(agendaOutline)}
              </ol>
            </div>

            <div>
              {showAddForm ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Add Custom Agenda Item
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Item Title
                      </label>
                      <input
                        type="text"
                        value={newTitle}
                        onChange={(event) => setNewTitle(event.target.value)}
                        placeholder="e.g. Roof Membrane Inspection Update"
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Section Name (Optional)
                      </label>
                      <input
                        type="text"
                        value={newSection}
                        onChange={(event) => setNewSection(event.target.value)}
                        placeholder="e.g. Property Management Report - Projects"
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-600">Type:</span>
                      <button
                        type="button"
                        onClick={() => setNewStatus("discussed")}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                          newStatus === "discussed"
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        Discussed
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewStatus("ad_hoc")}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                          newStatus === "ad_hoc"
                            ? "bg-amber-600 text-white"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        Ad-Hoc
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddForm(false)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleAddNewItem}
                        disabled={!newTitle.trim()}
                        className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-40"
                      >
                        Add to Agenda
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
                >
                  <span>+</span>
                  <span>Add Custom Agenda Item</span>
                </button>
              )}
            </div>
          </>
        ) : null}

        {/* Feedback messages */}
        {submitError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            {submitError}
          </div>
        ) : null}
        {submitSuccess ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            {submitSuccess}
          </div>
        ) : null}

        {/* Sticky Action Bar */}
        <div className="sticky bottom-4 z-10 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 border border-emerald-200">
              {discussedCount} Confirmed Discussed
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 border border-slate-200">
              {deferredCount} Deferred (Zero Tokens)
            </span>
            {adHocCount > 0 ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800 border border-amber-200">
                {adHocCount} Ad-Hoc
              </span>
            ) : null}
            {excludedCount > 0 ? (
              <span className="rounded-full bg-rose-50 px-2.5 py-1 font-semibold text-rose-800 border border-rose-200">
                {excludedCount} Excluded
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {onSwitchToValidatedReview && !headerAside ? (
              <button
                type="button"
                onClick={onSwitchToValidatedReview}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                View Validated Review
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={approvalButtonDisabled}
              title={approvalButtonDisabledReason}
              className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Approving & Resuming Pipeline...</span>
                </>
              ) : (
                <span>{isApproved ? "Update Agenda Approval →" : "Approve Agenda & Proceed →"}</span>
              )}
            </button>
          </div>
        </div>
      </div>

      <ChunkPreviewModal
        open={Boolean(selectedChunkId)}
        meetingId={meetingId}
        chunkId={selectedChunkId}
        onClose={() => setSelectedChunkId(null)}
      />

      <TranscriptRangeModal
        open={Boolean(selectedTimeRange)}
        meetingId={meetingId}
        timeRange={selectedTimeRange}
        onClose={() => setSelectedTimeRange(null)}
      />

      <AgendaApprovalConfirmDialog
        open={confirmOpen}
        mode={approvalConfirmMode}
        busy={submitting}
        onConfirm={() => void handleApproveAndProceed()}
        onCancel={() => {
          if (!submitting) setConfirmOpen(false);
        }}
      />
    </SectionCard>
  );
}

function AgendaReviewPanel({
  meetingId,
  status,
  goldStandardValidation,
  onOpenGoldStandardPanel,
  onReEvaluateSubmitted,
}: {
  meetingId: string;
  status: MeetingV2Status;
  goldStandardValidation?: GoldStandardValidationResult | null;
  onOpenGoldStandardPanel?: (
    tab: GoldStandardValidationTab,
    agendaItemId?: string,
  ) => void;
  onReEvaluateSubmitted?: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dirtyItems, setDirtyItems] = useState<Record<string, boolean>>({});
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [detailPanelItem, setDetailPanelItem] = useState<AgendaItemDetail | null>(null);
  const [detailPanelInitialTab, setDetailPanelInitialTab] = useState<
    "flags" | "questions" | "evidence"
  >("flags");
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState<string | null>(null);

  const goldStandardFindingsByItemId = useMemo(() => {
    if (!goldStandardValidation) return new Map<string, ItemGoldStandardFindings>();
    return buildGoldStandardFindingsByItemId(
      status.items,
      goldStandardValidation.generatedOnly,
      goldStandardValidation.goldOnly,
      goldStandardValidation,
    );
  }, [goldStandardValidation, status.items]);

  const reviewItems = useMemo(
    () => filterItemsForValidatedReview(status.items, status.meeting.agendaApproval),
    [status.items, status.meeting.agendaApproval],
  );

  const validatedOutline = useMemo(
    () => buildAgendaOutline(reviewItems),
    [reviewItems],
  );

  useEffect(() => {
    setAnswers((current) => {
      const nextAnswers = { ...current };
      for (const item of reviewItems) {
        if (!dirtyItems[item.id]) {
          nextAnswers[item.id] = item.userAnswers?.text ?? "";
        }
      }
      return nextAnswers;
    });
  }, [dirtyItems, reviewItems]);

  async function handleSubmit(itemId: string) {
    setBusyItemId(itemId);
    try {
      await fetch(`/api/v2/meetings/${meetingId}/items/${itemId}/re-evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAnswers: { text: answers[itemId] ?? "" } }),
      });
      onReEvaluateSubmitted?.();
      setDirtyItems((current) => ({
        ...current,
        [itemId]: false,
      }));
    } finally {
      setBusyItemId(null);
    }
  }

  function handleAnswerChange(itemId: string, value: string) {
    setDirtyItems((current) => ({
      ...current,
      [itemId]: true,
    }));
    setAnswers((current) => ({
      ...current,
      [itemId]: value,
    }));
  }

  function handleOpenDetailPanel(
    item: AgendaReviewItem,
    initialTab: "flags" | "questions" | "evidence",
  ) {
    setDetailPanelInitialTab(initialTab);
    setDetailPanelItem({
      id: item.id,
      title: item.title,
      itemNumber: item.itemNumber,
      openQuestions: item.openQuestions,
      validation: item.validation,
      evidence: item.evidence,
    });
  }

  function renderValidatedOutlineNodes(
    nodes: AgendaOutlineNode[],
    depth = 0,
  ): ReactNode {
    return nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isHeading = hasChildren || node.item.itemType === "agenda_section";

      return (
        <div key={node.item.id}>
          <ValidatedAgendaReviewListItem
            item={node.item}
            displayNumber={node.displayNumber}
            listMarker={node.listMarker}
            subItems={node.subItems}
            discussionTiming={node.discussionTiming ?? null}
            isHeading={isHeading}
            isOpen={openItemId === node.item.id}
            answers={answers}
            dirtyItems={dirtyItems}
            busyItemId={busyItemId}
            onToggleOpen={() =>
              setOpenItemId((current) => (current === node.item.id ? null : node.item.id))
            }
            onAnswerChange={handleAnswerChange}
            onSubmit={(itemId) => void handleSubmit(itemId)}
            onOpenDetailPanel={handleOpenDetailPanel}
            onSelectChunkId={setSelectedChunkId}
            onSelectTimeRange={setSelectedTimeRange}
            goldStandardFindings={goldStandardFindingsByItemId.get(node.item.id)}
            onOpenGoldStandardPanel={onOpenGoldStandardPanel}
          />
          {hasChildren ? (
            <ol
              className={`list-none border-l border-slate-200 pl-5 sm:pl-6 ${
                depth === 0 ? "border-t border-slate-100 bg-slate-50/40" : "bg-white/70"
              }`}
            >
              {renderValidatedOutlineNodes(node.children, depth + 1)}
            </ol>
          ) : null}
        </div>
      );
    });
  }

  const isPendingApproval = Boolean(
    status.items.length > 0 &&
      (!status.meeting.agendaApproval?.approvedAt ||
        status.meeting.computedPipelineState === "extracted"),
  );

  const [showApprovalWorkspace, setShowApprovalWorkspace] = useState(isPendingApproval);

  useEffect(() => {
    if (isPendingApproval) {
      setShowApprovalWorkspace(true);
    }
  }, [isPendingApproval]);

  const canReviewItems = status.meeting.computedPipelineState === "validated";
  const isPostAgendaPhase =
    canReviewItems && Boolean(status.meeting.agendaApproval?.approvedAt);

  const reviewViewToggle = isPostAgendaPhase ? (
    <AgendaReviewViewToggle
      mode={showApprovalWorkspace ? "approval" : "validated"}
      onModeChange={(mode) => setShowApprovalWorkspace(mode === "approval")}
    />
  ) : null;

  if (showApprovalWorkspace || (!canReviewItems && status.items.length > 0)) {
    return (
      <HitlAgendaApprovalWorkspace
        meetingId={meetingId}
        status={status}
        onApproved={() => {
          onReEvaluateSubmitted?.();
        }}
        onSwitchToValidatedReview={
          canReviewItems && !isPostAgendaPhase ? () => setShowApprovalWorkspace(false) : undefined
        }
        headerAside={reviewViewToggle}
        goldStandardFindingsByItemId={goldStandardFindingsByItemId}
        onOpenGoldStandardPanel={onOpenGoldStandardPanel}
      />
    );
  }

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

  const openQuestionTotal = reviewItems.reduce((sum, item) => sum + item.openQuestions.length, 0);
  const flagTotal = reviewItems.reduce(
    (sum, item) =>
      sum +
      item.validation.filter(
        (validation) => validation.severity === "error" || validation.severity === "warning",
      ).length,
    0,
  );

  return (
    <SectionCard
      eyebrow="Agenda Review"
      title="Review agenda items and resolve open questions"
      description="Work through items in official agenda order. Expand an item to answer clarifications, inspect flags and evidence, or re-run investigation for that topic only."
      headerAside={reviewViewToggle}
    >
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">
            {reviewItems.length} items in agenda order
          </span>
          {openQuestionTotal > 0 ? (
            <span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 font-semibold text-amber-950">
              {openQuestionTotal} open {openQuestionTotal === 1 ? "question" : "questions"}
            </span>
          ) : null}
          {flagTotal > 0 ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-semibold text-amber-950">
              {flagTotal} {flagTotal === 1 ? "flag" : "flags"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Meeting Agenda Review
          </h4>
          <p className="mt-1 text-[11px] text-slate-500">
            Official agenda order is preserved (1, 2, 3, 4.A.1, 4.D.a). Click an item to expand clarifications and evidence.
          </p>
        </div>

        {reviewItems.length > 0 ? (
          <ol className="list-none">{renderValidatedOutlineNodes(validatedOutline)}</ol>
        ) : (
          <div className="px-6 py-10 text-sm text-slate-600">
            No reviewed agenda items yet. Deferred and excluded items are hidden from this view.
          </div>
        )}
      </div>

      <AgendaItemDetailSidePanel
        item={detailPanelItem}
        initialTab={detailPanelInitialTab}
        onClose={() => setDetailPanelItem(null)}
      />

      <ChunkPreviewModal
        open={Boolean(selectedChunkId)}
        meetingId={meetingId}
        chunkId={selectedChunkId}
        onClose={() => setSelectedChunkId(null)}
      />

      <TranscriptRangeModal
        open={Boolean(selectedTimeRange)}
        meetingId={meetingId}
        timeRange={selectedTimeRange}
        onClose={() => setSelectedTimeRange(null)}
      />
    </SectionCard>
  );
}

function PipelinePanel({
  status,
  workflowProgress,
}: {
  status: MeetingV2Status;
  workflowProgress: MeetingV2WorkflowProgress | null;
}) {
  const workflowSteps = workflowProgress?.steps ?? status.meeting.stages.map((stage) => ({
    key: stage.key,
    label: stage.label,
    status: stage.status,
    note: stage.note,
    kind: "pipeline" as const,
  }));

  return (
    <div className="space-y-6">
      <SectionCard
        eyebrow="Pipeline"
        title="Stage diagnostics"
        description="Automated pipeline stages plus the manual review steps needed before the meeting is fully complete."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {workflowSteps.map((stage) => (
            <div
              key={stage.key}
              className={`rounded-2xl border px-4 py-4 ${stageTone(stage.status)}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{stage.label}</div>
                <div className="flex items-center gap-2">
                  {stage.kind === "user" ? (
                    <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] opacity-80">
                      Manual
                    </span>
                  ) : null}
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                    {startCase(stage.status)}
                  </div>
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
                <div
                  className="h-full rounded-full bg-current opacity-70"
                  style={{ width: stage.status === "complete" ? "100%" : stage.status === "in_progress" ? "50%" : "0%" }}
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
  draftError,
  validationScore,
  pdfMarginsRevision,
  onValidationBadgeClick,
  onGenerateDraft,
  onDraftJsonSaved,
}: {
  meetingId: string;
  draft: MeetingV2Status["latestDraft"] | null;
  draftBusy: boolean;
  draftError: string | null;
  validationScore?: number | null;
  pdfMarginsRevision: number;
  onValidationBadgeClick?: () => void;
  onGenerateDraft: () => void;
  onDraftJsonSaved?: (summaryJson: string) => void;
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
          {draftError ? (
            <p className="mt-3 text-sm font-medium text-red-700">{draftError}</p>
          ) : null}
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
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600">
                Edit the draft or preview the PDF layout.
              </span>
              {onValidationBadgeClick ? (
                <GoldStandardValidationBadge
                  validationScore={validationScore ?? null}
                  onClick={onValidationBadgeClick}
                />
              ) : null}
            </div>
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
          <DraftPreviewBody
            meetingId={meetingId}
            draft={draft}
            mode={editorMode}
            heightClassName="h-[65dvh] min-h-[32rem]"
            pdfMarginsRevision={pdfMarginsRevision}
            onDraftJsonSaved={onDraftJsonSaved}
          />
        </>
      )}
    </SectionCard>
  );
}

function DraftAttendancePanel({
  doc,
  onEdit,
}: {
  doc: MinutesDocumentV2;
  onEdit: () => void;
}) {
  const sections = [
    { label: "Present", people: doc.attendance?.present ?? [] },
    { label: "By invitation", people: doc.attendance?.byInvitation ?? [] },
    { label: "Guests", people: doc.attendance?.guests ?? [] },
    { label: "Regrets", people: doc.attendance?.regrets ?? [] },
  ] as const;
  const hasAnyAttendees = sections.some((section) => section.people.length > 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Attendance</h3>
          <p className="mt-1 text-xs text-slate-500">
            Auto-detected from the board package and transcript. Edit names, titles,
            and roles before finalizing.
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Edit attendees
        </button>
      </div>

      {hasAnyAttendees ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {sections.map((section) =>
            section.people.length > 0 ? (
              <div key={section.label}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {section.label}
                </div>
                <ul className="mt-2 space-y-1.5">
                  {section.people.map((person: AttendeeV2, index) => (
                    <li key={`${section.label}-${index}`} className="text-sm text-slate-800">
                      <span className="font-medium">{person.name}</span>
                      {formatAttendeeLine(person).includes(" - ") ? (
                        <span className="text-slate-600">
                          {" — "}
                          {formatAttendeeLine(person).slice(person.name.length + 3)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          No attendees detected yet. Open Edit attendees to add or adjust the roster.
        </p>
      )}
    </div>
  );
}

function DraftPreviewBody({
  meetingId,
  draft,
  mode,
  heightClassName,
  pdfMarginsRevision,
  onDraftJsonSaved,
}: {
  meetingId: string;
  draft: MeetingV2Status["latestDraft"] | null;
  mode: "edit" | "preview";
  heightClassName: string;
  pdfMarginsRevision: number;
  onDraftJsonSaved?: (summaryJson: string) => void;
}) {
  const [doc, setDoc] = useState<MinutesDocumentV2 | null>(null);
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const [attendeesDialogOpen, setAttendeesDialogOpen] = useState(false);
  const [attendeesSaving, setAttendeesSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const editableAttendance = useMemo(
    () => (doc ? extractEditableAttendanceFromDoc(doc) : null),
    [doc],
  );

  async function handleSaveAttendees(attendance: AttendanceSavePayload) {
    if (!doc || !draft) return;

    setAttendeesSaving(true);
    setSaveError(null);

    const updatedDoc = applyAttendanceToMinutesDoc(doc, attendance);
    setDoc(updatedDoc);

    try {
      const summaryJson = serializeDraftSummaryJson(draft.json, updatedDoc);
      const contentMarkdown = v2ToMarkdown(updatedDoc);
      const response = await fetch(`/api/v2/meetings/${meetingId}/draft/save`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, summaryJson, contentMarkdown }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Could not save attendees.");
      }
      onDraftJsonSaved?.(summaryJson);
      setSaveRevision((revision) => revision + 1);
      setAttendeesDialogOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save attendees.");
    } finally {
      setAttendeesSaving(false);
    }
  }

  useEffect(() => {
    if (!draft?.json) {
      setDoc(null);
      return;
    }
    setDoc(parseDraftMinutesDoc(draft.json));
  }, [draft?.id, draft?.json]);

  function handleDocChange(updated: MinutesDocumentV2) {
    setDoc(updated);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);

    saveTimeout.current = setTimeout(async () => {
      if (!draft) return;
      const summaryJson = serializeDraftSummaryJson(draft.json, updated);
      const contentMarkdown = v2ToMarkdown(updated);

      try {
        const response = await fetch(`/api/v2/meetings/${meetingId}/draft/save`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId: draft.id, summaryJson, contentMarkdown }),
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "Could not save draft.");
        }
        onDraftJsonSaved?.(summaryJson);
        setSaveRevision((revision) => revision + 1);
        setSaveError(null);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Could not save draft.");
      }
    }, 1000);
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
      
      {saveError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          {saveError}
        </p>
      ) : null}

      {doc ? (
        <DraftAttendancePanel
          doc={doc}
          onEdit={() => setAttendeesDialogOpen(true)}
        />
      ) : null}

      {mode === "edit" && doc ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <MinutesStructuredEditor
            doc={doc}
            onDocChange={handleDocChange}
            onOpenAttendeesDialog={() => setAttendeesDialogOpen(true)}
          />
        </div>
      ) : null}

      {mode === "preview" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <iframe
            key={`${draft.id}-${saveRevision}-${pdfMarginsRevision}-${doc?.metadata.meetingDate ?? ""}`}
            title={`${draft.title} PDF preview`}
            src={`/api/v2/meetings/${meetingId}/draft/file`}
            className={`${heightClassName} w-full bg-white`}
          />
        </div>
      ) : null}

      {doc && editableAttendance ? (
        <AttendeesEditorDialog
          open={attendeesDialogOpen}
          attendance={editableAttendance}
          busy={attendeesSaving}
          onClose={() => {
            if (!attendeesSaving) setAttendeesDialogOpen(false);
          }}
          onSave={handleSaveAttendees}
        />
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

function StatusLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
      <p className="text-sm font-semibold text-rose-900">Could not load workspace</p>
      <p className="mt-1 text-sm text-rose-800">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-900 transition hover:bg-rose-100"
      >
        Retry
      </button>
    </div>
  );
}
