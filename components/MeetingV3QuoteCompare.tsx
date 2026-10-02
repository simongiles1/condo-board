"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ReadableTranscriptView } from "@/components/ReadableTranscriptView";
import type { MergedVttCue } from "@/lib/parsers/vtt";
import type { TranscriptSectionOverlay } from "@/lib/transcript/section-overlay";

import { AiUsageDialog, AiUsageIconButton } from "@/components/AiUsageDialog";
import { MeetingDocumentsDialog, MeetingDocumentsIconButton } from "@/components/MeetingDocumentsDialog";
import { DeepSeekActionConfirmDialog } from "@/components/DeepSeekActionConfirmDialog";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import type { AiUsageStageRow } from "@/lib/gemini/usage";
import { agendaItemIndentDepth, displayAgendaSegment, isAgendaItemLeaf } from "@/lib/meeting-v2/agenda-outline";
import {
  countAgendaPages,
  formatAttachmentPageRangeLabel,
  formatSourcePages,
  isAgendaPageForCorrection,
  sourcePageContiguousRanges,
} from "@/lib/meeting-v3/agenda-pages";
import { factContextNotes, factResolutionProgressFraction, readFactResolutionProgress, summarizeItemFactReviews, type MeetingsV3FactField, type MeetingsV3ItemFacts, type MeetingsV3PackageRole } from "@/lib/meeting-v3/facts";
import type { MeetingsV3ItemConclusion } from "@/lib/meeting-v3/meeting-conclusions";
import type { MeetingsV3ItemFactGroups } from "@/lib/meeting-v3/fact-groups";
import { formatSpanClock, type MeetingsV3ItemTranscript, agendaItemsForWizardStep } from "@/lib/meeting-v3/transcript-spans";
import { cancelPdfCanvasRender, renderPdfPageToCanvas } from "@/lib/pdf/pdfjs-browser";
import type { MeetingsV3PackageStatus } from "@/lib/meeting-v3/package-status";
import {
  meetingsV3WizardProgress,
  parseMeetingsV3WizardStepId,
  type MeetingsV3WizardStep,
} from "@/lib/meeting-v3/wizard";

type ExtractedPage = {
  pageNumber: number;
  pageHeading: string | null;
  extractedText: string;
};

type PageRewrite = {
  pageNumber: number;
  correctedText: string;
};

type AgendaItem = {
  id: string;
  itemNumber: string;
  title: string;
  sourcePages: number[];
  summary: string | null;
  amount: string | null;
  vendors: string[];
  recommendation: string | null;
  facts: MeetingsV3ItemFacts | null;
  transcript: MeetingsV3ItemTranscript | null;
  factGroups: MeetingsV3ItemFactGroups | null;
  conclusion: MeetingsV3ItemConclusion | null;
};

type PageNavProps = {
  pages: ExtractedPage[];
  pageIndex: number;
  pageNumber: number | null;
  correctedCount: number;
  agendaPageCount: number;
  onPageChange: (pageNumber: number) => void;
  onExpand?: () => void;
};

function pageMenuLabel(page: ExtractedPage): string {
  const heading = page.pageHeading?.replace(/\s+/g, " ").trim();
  return heading ? `${page.pageNumber} — ${heading}` : String(page.pageNumber);
}

const FACT_FIELD_LABEL: Record<MeetingsV3FactField, string> = {
  amount: "Amount",
  vendor: "Vendor",
  recommendation: "Recommendation",
  date: "Date",
};

const FACT_ROLE_LABEL: Record<MeetingsV3PackageRole, string> = {
  proposal: "Proposal",
  recommendation: "Recommendation",
  reported_prior_approval: "Package reports a prior approval",
  historical_event: "Past event",
};

function pagesWithoutTextNotice(pageNumbers: number[] | undefined): string | null {
  if (!pageNumbers || pageNumbers.length === 0) return null;
  if (pageNumbers.length === 1) {
    return `Page ${pageNumbers[0]} has no extracted text, so it was left unlinked.`;
  }
  return `Pages ${pageNumbers.join(", ")} have no extracted text, so they were left unlinked.`;
}

function unassignedAttachmentNotice(
  unassignedPages: number[] | undefined,
  pagesWithoutText: number[] | undefined,
): string | null {
  const unassigned = [...(unassignedPages ?? [])].sort((left, right) => left - right);
  if (unassigned.length === 0) return null;
  const withoutTextSet = new Set(pagesWithoutText ?? []);
  const rangeText = sourcePageContiguousRanges(unassigned)
    .map(({ start, end }) => (start === end ? String(start) : `${start}–${end}`))
    .join(", ");
  const linkPart =
    unassigned.length === 1
      ? `Page ${unassigned[0]} is not linked to an agenda topic.`
      : `Pages ${rangeText} are not linked to an agenda topic.`;
  const blankUnassigned = unassigned.filter((page) => withoutTextSet.has(page));
  if (blankUnassigned.length === 0) return linkPart;
  const blankPart = pagesWithoutTextNotice(blankUnassigned);
  if (blankUnassigned.length === unassigned.length) return blankPart;
  return `${linkPart} ${blankPart}`;
}

function AttachmentPageRangeBadges({
  pages,
  onOpenPage,
}: {
  pages: number[];
  onOpenPage: (pageNumber: number) => void;
}) {
  const ranges = sourcePageContiguousRanges(pages);
  if (ranges.length === 0) return null;
  return (
    <>
      {ranges.map(({ start, end }) => (
        <button
          key={`${start}-${end}`}
          type="button"
          onClick={() => onOpenPage(start)}
          className="whitespace-nowrap rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {formatAttachmentPageRangeLabel(start, end)}
        </button>
      ))}
    </>
  );
}

function PageMenu({
  pages,
  pageNumber,
  onPageChange,
}: {
  pages: ExtractedPage[];
  pageNumber: number | null;
  onPageChange: (pageNumber: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = pages.find((page) => page.pageNumber === pageNumber) ?? null;
  const label = selected ? pageMenuLabel(selected) : "Select a page";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((current) => !current)}
        className="flex w-[min(24rem,70vw)] max-w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-left text-sm text-slate-800"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span aria-hidden className="shrink-0 text-slate-500">▾</span>
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-72 w-[min(36rem,calc(100vw-2rem))] overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {pages.map((page) => {
            const optionLabel = pageMenuLabel(page);
            const isSelected = page.pageNumber === pageNumber;
            return (
              <li key={page.pageNumber}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onPageChange(page.pageNumber);
                    setOpen(false);
                  }}
                  className={`block w-full whitespace-normal break-words px-3 py-1.5 text-left text-sm ${
                    isSelected ? "bg-slate-100 font-medium text-slate-900" : "text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  {optionLabel}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function PageNavBar({
  pages,
  pageIndex,
  pageNumber,
  correctedCount,
  agendaPageCount,
  onPageChange,
  onExpand,
}: PageNavProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
        disabled={pageIndex <= 0}
        onClick={() => {
          const previous = pages[pageIndex - 1];
          if (previous) onPageChange(previous.pageNumber);
        }}
      >
        Previous page
      </button>
      <div className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
        Page
        <PageMenu pages={pages} pageNumber={pageNumber} onPageChange={onPageChange} />
      </div>
      <button
        type="button"
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
        disabled={pageIndex < 0 || pageIndex >= pages.length - 1}
        onClick={() => {
          const next = pages[pageIndex + 1];
          if (next) onPageChange(next.pageNumber);
        }}
      >
        Next page
      </button>
      <span className="text-sm text-slate-500">
        {agendaPageCount > 0 && agendaPageCount < pages.length
          ? `${correctedCount} of ${agendaPageCount} agenda pages corrected`
          : `${correctedCount} corrected ${correctedCount === 1 ? "page" : "pages"}`}
      </span>
      {onExpand ? (
        <button
          type="button"
          onClick={onExpand}
          className="ml-auto rounded-md border border-teal-700 px-3 py-1.5 text-sm font-semibold text-teal-800 hover:bg-teal-50"
        >
          Expand comparison
        </button>
      ) : null}
    </div>
  );
}

type ExtractCompareTab = "corrected" | "docling";

type CompareColumnsProps = {
  meetingId: string;
  pageNumber: number | null;
  selectedPage: ExtractedPage | null;
  busy: boolean;
  correctedText: string | null;
  agendaContentEndsAtPage: number | null;
};

function ExtractCompareTabBar({
  active,
  onChange,
}: {
  active: ExtractCompareTab;
  onChange: (tab: ExtractCompareTab) => void;
}) {
  const tabs: Array<{ id: ExtractCompareTab; label: string }> = [
    { id: "corrected", label: "Corrected extract" },
    { id: "docling", label: "Docling extract" },
  ];
  return (
    <div className="flex border-b border-slate-200" role="tablist" aria-label="Extract comparison">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-3 py-2 text-sm font-semibold ${
            active === tab.id
              ? "border-b-2 border-teal-700 text-teal-900"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One board-package page drawn to the width of its column.
 * The browser PDF viewer was fitting the whole file into the pane, so the page was a thumbnail strip.
 */
function FitWidthPackagePage({
  meetingId,
  pageNumber,
}: {
  meetingId: string;
  pageNumber: number;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPdfData(null);
    setErrorMessage(null);
    void fetch(`/api/meetings/${meetingId}/board-package`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Could not load the board package.");
        }
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (!cancelled) setPdfData(buffer);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Could not load the board package.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => {
      const next = frame.clientWidth;
      setFrameWidth((current) => (current === next ? current : next));
    });
    observer.observe(frame);
    setFrameWidth(frame.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdfData || !canvas || frameWidth < 40) return;
    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = "100%";
    canvas.style.height = "auto";

    void (async () => {
      const probe = await renderPdfPageToCanvas(pdfData, pageNumber, canvas, 1);
      if (cancelled || !probe?.pageWidthPt || probe.pageWidthPt <= 0) return;
      await renderPdfPageToCanvas(
        pdfData,
        pageNumber,
        canvas,
        (frameWidth / probe.pageWidthPt) * dpr,
      );
      if (cancelled) return;
      canvas.style.width = "100%";
      canvas.style.height = "auto";
    })().catch(() => {
      if (!cancelled) setErrorMessage("Could not render this page.");
    });

    return () => {
      cancelled = true;
      cancelPdfCanvasRender(canvas);
    };
  }, [frameWidth, pageNumber, pdfData]);

  return (
    <div ref={frameRef} className="min-w-0 bg-slate-100 p-3">
      {errorMessage ? <p className="text-sm text-red-800">{errorMessage}</p> : null}
      {!errorMessage && !pdfData ? <p className="text-sm text-slate-600">Loading page…</p> : null}
      <canvas
        ref={canvasRef}
        aria-label={`Board package page ${pageNumber}`}
        className={`block h-auto w-full bg-white shadow-sm ${pdfData && !errorMessage ? "" : "hidden"}`}
      />
    </div>
  );
}

function CompareColumns({
  meetingId,
  pageNumber,
  selectedPage,
  busy,
  correctedText,
  agendaContentEndsAtPage,
}: CompareColumnsProps) {
  const [extractTab, setExtractTab] = useState<ExtractCompareTab>("corrected");
  const doclingText = selectedPage?.extractedText?.trim() || "No extracted text on this page.";
  const agendaPage =
    pageNumber != null && isAgendaPageForCorrection(pageNumber, agendaContentEndsAtPage);
  const corrected = correctedText?.trim()
    || (busy
      ? agendaPage
        ? "Correcting this agenda page."
        : "Agenda pages are being corrected."
      : agendaPage
        ? "This agenda page has not been corrected yet."
        : "Attachment pages use the Docling extract. Correction runs on agenda pages only.");

  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
          Board package
        </h2>
        {pageNumber != null ? (
          <FitWidthPackagePage meetingId={meetingId} pageNumber={pageNumber} />
        ) : null}
      </section>

      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <ExtractCompareTabBar active={extractTab} onChange={setExtractTab} />
        <div className="px-4 py-3" role="tabpanel">
          <MarkdownPreview>{extractTab === "corrected" ? corrected : doclingText}</MarkdownPreview>
        </div>
      </section>
    </div>
  );
}

type WizardBarProps = {
  steps: Array<MeetingsV3WizardStep & { state: "complete" | "current" | "upcoming" }>;
  shownId: MeetingsV3WizardStep["id"];
  busy: boolean;
  onShow: (id: MeetingsV3WizardStep["id"]) => void;
};

function WizardBar({ steps, shownId, busy, onShow }: WizardBarProps) {
  return (
    <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2">
      <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0">
        {steps.map((step, index) => {
          const open = step.state !== "upcoming";
          const shown = step.id === shownId;
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center">
              {index > 0 ? (
                <span
                  className={`mx-2 hidden h-px w-6 shrink-0 sm:block ${steps[index - 1]?.state === "complete" ? "bg-teal-700" : "bg-slate-200"}`}
                  aria-hidden="true"
                />
              ) : null}
              <button
                type="button"
                disabled={!open || busy}
                aria-current={shown ? "step" : undefined}
                onClick={() => onShow(step.id)}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left disabled:cursor-not-allowed ${shown ? "bg-teal-50" : "hover:bg-slate-50"}`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    step.state === "complete"
                      ? "bg-teal-700 text-white"
                      : step.state === "current"
                        ? "border-2 border-teal-700 text-teal-800"
                        : "border border-slate-300 text-slate-400"
                  }`}
                >
                  {step.state === "complete" ? "✓" : index + 1}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${step.state === "upcoming" ? "text-slate-400" : "text-slate-900"}`}>
                    {step.title}
                  </span>
                  {step.state === "current" ? (
                    <span className="block text-xs text-slate-500">Current</span>
                  ) : step.state === "upcoming" ? (
                    <span className="block text-xs text-slate-500">Later</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Walks a V3 meeting through extract and correct, the agenda, attachment pages, quoted facts, the transcript, then source groups.
 * Finished stages stay open. The next stage is another entry on the same bar.
 */
function FactResolutionProgressBar({ step }: { step: string | null }) {
  const progress = readFactResolutionProgress(step);
  const pct = progress ? Math.round(factResolutionProgressFraction(progress) * 100) : null;
  return (
    <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm text-slate-700">
        <span className="min-w-0 truncate font-medium text-slate-900">
          {progress ? progress.label : "Starting fact resolution"}
        </span>
        <span className="shrink-0 tabular-nums">
          {progress ? `${progress.itemIndex} of ${progress.itemCount}` : "Waiting for the first topic"}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? 0}
        aria-label={progress ? progress.label : "Starting fact resolution"}
      >
        <div
          className={`h-full rounded-full bg-teal-700 ${pct == null ? "w-1/3 animate-pulse" : ""}`}
          style={pct == null ? undefined : { width: `${Math.max(pct, 3)}%` }}
        />
      </div>
      {progress && progress.batchCount > 1 ? (
        <p className="mt-2 text-xs text-slate-500">
          Page batch {progress.batchIndex} of {progress.batchCount} for this topic
        </p>
      ) : null}
    </div>
  );
}

type QuotedFactsPanel = "review" | "context" | "agenda";

type QuotedFactsTabStripProps = {
  active: QuotedFactsPanel;
  reviewCount: number;
  contextCount: number;
  onChange: (panel: QuotedFactsPanel) => void;
};

/**
 * Switches between review notes, context notes, and the per-agenda quoted-facts list on Resolve facts.
 */
function QuotedFactsTabStrip({ active, reviewCount, contextCount, onChange }: QuotedFactsTabStripProps) {
  const tabs: { id: QuotedFactsPanel; label: string }[] = [
    { id: "review", label: reviewCount > 0 ? `Needs review (${reviewCount})` : "Needs review" },
    { id: "context", label: contextCount > 0 ? `Context (${contextCount})` : "Context" },
    { id: "agenda", label: "By agenda" },
  ];

  return (
    <div
      className="grid w-full grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
      aria-label="Quoted facts views"
    >
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(tab.id);
            }}
            className={`rounded-lg px-2 py-2 text-center text-xs font-semibold leading-tight transition sm:text-sm ${
              selected
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function MeetingV3QuoteCompare({ initial }: { initial: MeetingsV3PackageStatus }) {
  const [status, setStatus] = useState(initial);
  const [running, setRunning] = useState(
    initial.stage === "extracting" || initial.stage === "correcting",
  );
  const [error, setError] = useState<string | null>(initial.error);
  const [pages, setPages] = useState<ExtractedPage[]>([]);
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [rewrites, setRewrites] = useState<PageRewrite[]>([]);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [buildingAgenda, setBuildingAgenda] = useState(false);
  const [linking, setLinking] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [pingingDeepSeek, setPingingDeepSeek] = useState(false);
  const [deepSeekPing, setDeepSeekPing] = useState<string | null>(null);
  const [segmenting, setSegmenting] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [deepSeekConfirm, setDeepSeekConfirm] = useState<"attachments" | "facts" | "transcript" | "sources" | null>(null);
  const deepSeekRun = useRef(false);
  const [pickedStep, setPickedStep] = useState<MeetingsV3WizardStep["id"] | null>(() =>
    parseMeetingsV3WizardStepId(
      typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("step"),
    ),
  );
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [aiUsageOpen, setAiUsageOpen] = useState(false);
  const [documentsDialogOpen, setDocumentsDialogOpen] = useState(false);
  const [aiUsageStages, setAiUsageStages] = useState<AiUsageStageRow[] | null>(null);
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [transcriptCues, setTranscriptCues] = useState<MergedVttCue[] | null>(null);
  const [transcriptLoadError, setTranscriptLoadError] = useState<string | null>(null);
  const [selectedAgendaItemId, setSelectedAgendaItemId] = useState<string | null>(null);
  const [quotedFactsPanel, setQuotedFactsPanel] = useState<QuotedFactsPanel>("agenda");
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  const busy = running || buildingAgenda || linking || resolving || pingingDeepSeek || segmenting || grouping || reconciling || status.stage === "extracting" || status.stage === "correcting";

  function refreshAiUsage() {
    setAiUsageLoading(true);
    void fetch(`/api/v3/meetings/${status.id}/ai-usage`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { stages?: AiUsageStageRow[] };
        setAiUsageStages(payload.stages ?? []);
      })
      .catch(() => undefined)
      .finally(() => setAiUsageLoading(false));
  }

  useEffect(() => {
    if (!aiUsageOpen) return;
    refreshAiUsage();
  }, [aiUsageOpen, status.id]);

  useEffect(() => {
    if (!status.transcriptSegmented) return;
    let cancelled = false;
    setTranscriptLoadError(null);
    void fetch(`/api/meetings/${status.id}/transcript`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          cues?: MergedVttCue[];
          error?: string;
        } | null;
        if (!response.ok) throw new Error(payload?.error || "Could not load transcript.");
        if (!cancelled) setTranscriptCues(payload?.cues ?? []);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setTranscriptCues([]);
        setTranscriptLoadError(
          loadError instanceof Error ? loadError.message : "Could not load transcript.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [status.id, status.transcriptSegmented, status.transcriptSpanCount]);

  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  useEffect(() => {
    if (!busy) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetch(`/api/v3/meetings/${status.id}/package`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok || cancelled) return;
          const next = (await response.json()) as MeetingsV3PackageStatus;
          if (cancelled) return;
          setStatus(next);
          setError(next.error);
          if (next.stage !== "extracting" && next.stage !== "correcting") {
            setRunning(false);
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busy, status.id]);

  useEffect(() => {
    if (status.pageCount === 0) return;
    let cancelled = false;
    void fetch(`/api/v2/meetings/${status.id}/board-package-extract`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { pages?: ExtractedPage[] };
        if (cancelled) return;
        const nextPages = [...(payload.pages ?? [])].sort((left, right) => left.pageNumber - right.pageNumber);
        setPages(nextPages);
        setPageNumber((current) => current ?? nextPages[0]?.pageNumber ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status.id, status.pageCount, status.stage]);

  useEffect(() => {
    if (status.pageCount === 0) return;
    let cancelled = false;
    void fetch(`/api/v3/meetings/${status.id}/page-rewrite`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { pages?: PageRewrite[] };
        if (cancelled) return;
        setRewrites(payload.pages ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status.id, status.pageCount, status.correctedPageCount, status.stage]);

  useEffect(() => {
    if (status.pageCount === 0) return;
    let cancelled = false;
    void fetch(`/api/v3/meetings/${status.id}/agenda`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { items?: AgendaItem[] };
        if (cancelled) return;
        setAgendaItems(payload.items ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status.id, status.pageCount, status.agendaItemCount, status.stage]);

  const pageIndex = pages.findIndex((page) => page.pageNumber === pageNumber);
  const selectedPage = pageIndex >= 0 ? pages[pageIndex] : null;
  const correctedText = rewrites.find((page) => page.pageNumber === pageNumber)?.correctedText ?? null;

  const agendaPageCount = countAgendaPages(
    Math.max(status.pageCount, pages.length),
    status.agendaContentEndsAtPage,
  );

  const wizard = useMemo(
    () =>
      meetingsV3WizardProgress({
        pageCount: Math.max(status.pageCount, pages.length),
        correctedPageCount: Math.max(status.correctedPageCount, rewrites.length),
        agendaItemCount: Math.max(status.agendaItemCount, agendaItems.length),
        attachmentsLinked: status.attachmentsLinked,
        factsResolved: status.factsResolved,
        transcriptSegmented: status.transcriptSegmented,
        factsGrouped: status.factsGrouped,
        conclusionsRecorded: status.conclusionsRecorded,
        reviewIssueCount: agendaItems.reduce(
          (count, item) => count + (item.facts?.reviewIssues.length ?? 0),
          0,
        ),
        unclearConclusionCount: agendaItems.filter((item) => item.conclusion?.status === "unclear").length,
        openReferenceCount: agendaItems.filter((item) => item.conclusion?.openReference).length,
        agendaContentEndsAtPage: status.agendaContentEndsAtPage,
      }),
    [
      status.pageCount,
      pages.length,
      status.correctedPageCount,
      rewrites.length,
      status.agendaItemCount,
      agendaItems.length,
      status.attachmentsLinked,
      status.factsResolved,
      status.transcriptSegmented,
      status.factsGrouped,
      status.conclusionsRecorded,
      agendaItems,
      status.agendaContentEndsAtPage,
    ],
  );

  const accessibleWizardStepIds = useMemo(
    () => wizard.steps.filter((step) => step.state !== "upcoming").map((step) => step.id),
    [wizard.steps],
  );

  const showWizardStep = useCallback(
    (stepId: MeetingsV3WizardStep["id"]) => {
      setPickedStep(stepId);
      const params = new URLSearchParams(searchParams.toString());
      if (params.get("step") === stepId) return;
      params.set("step", stepId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const urlStep = parseMeetingsV3WizardStepId(searchParams.get("step"));
    if (urlStep && accessibleWizardStepIds.includes(urlStep)) {
      setPickedStep((current) => (current === urlStep ? current : urlStep));
      return;
    }
    const fallback = wizard.activeId;
    setPickedStep((current) => (current === fallback ? current : fallback));
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("step") !== fallback) {
      params.set("step", fallback);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [accessibleWizardStepIds, pathname, router, searchParams, wizard.activeId]);

  const compareProps: CompareColumnsProps = {
    meetingId: status.id,
    pageNumber,
    selectedPage,
    busy,
    correctedText,
    agendaContentEndsAtPage: status.agendaContentEndsAtPage,
  };

  async function extractPackage() {
    setRunning(true);
    setError(null);
    setStatus((current) => ({ ...current, stage: "extracting", error: null, currentStep: "Extracting the board package" }));
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/package`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | (MeetingsV3PackageStatus & { error?: string })
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Package extraction failed.");
      }
      if (payload && "stage" in payload) {
        setStatus(payload);
        setAgendaItems([]);
        if (payload.stage === "ready") showWizardStep("extract");
      }
    } catch (extractError) {
      const message = extractError instanceof Error ? extractError.message : "Package extraction failed.";
      setError(message);
      setStatus((current) => ({ ...current, stage: "failed", error: message }));
    } finally {
      setRunning(false);
    }
  }

  async function retryCorrectionOnly() {
    setRunning(true);
    setError(null);
    setStatus((current) => ({
      ...current,
      stage: "correcting",
      error: null,
      currentStep: "Correcting agenda pages",
    }));
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/page-rewrite`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | (MeetingsV3PackageStatus & { error?: string })
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Page correction failed.");
      }
      if (payload && "stage" in payload) {
        setStatus(payload);
        setAgendaItems([]);
        if (payload.stage === "ready") showWizardStep("extract");
      }
    } catch (correctionError) {
      const message = correctionError instanceof Error ? correctionError.message : "Page correction failed.";
      setError(message);
      setStatus((current) => ({ ...current, stage: "failed", error: message }));
    } finally {
      setRunning(false);
    }
  }

  async function buildAgenda() {
    setBuildingAgenda(true);
    setError(null);
    setStatus((current) => ({ ...current, currentStep: "Building the agenda from corrected pages" }));
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/agenda`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { items?: AgendaItem[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Agenda extraction failed.");
      }
      setAgendaItems(payload?.items ?? []);
      setStatus((current) => ({
        ...current,
        currentStep: "Agenda built from corrected pages",
        agendaItemCount: payload?.items?.length ?? 0,
        attachmentsLinked: false,
        factsResolved: false,
        factCount: 0,
        unresolvedFactItemCount: 0,
        transcriptSegmented: false,
        transcriptSpanCount: 0,
        transcriptOverlapItemCount: 0,
        factsGrouped: false,
        factGroupCount: 0,
        ungroupedFactCount: 0,
        conclusionsRecorded: false,
        unassignedAttachmentPages: [],
        attachmentPagesWithoutText: [],
      }));
      showWizardStep("attachments");
    } catch (agendaError) {
      const message = agendaError instanceof Error ? agendaError.message : "Agenda extraction failed.";
      setError(message);
    } finally {
      setBuildingAgenda(false);
    }
  }

  async function linkAttachments() {
    if (deepSeekRun.current) return;
    deepSeekRun.current = true;
    setLinking(true);
    setError(null);
    setStatus((current) => ({ ...current, currentStep: "Linking attachment pages to agenda topics" }));
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/attachments`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { items?: AgendaItem[]; unassignedPages?: number[]; pagesWithoutText?: number[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Attachment linking failed.");
      }
      setAgendaItems(payload?.items ?? []);
      setStatus((current) => ({
        ...current,
        attachmentsLinked: true,
        factsResolved: false,
        factCount: 0,
        unresolvedFactItemCount: 0,
        transcriptSegmented: false,
        transcriptSpanCount: 0,
        transcriptOverlapItemCount: 0,
        factsGrouped: false,
        factGroupCount: 0,
        ungroupedFactCount: 0,
        conclusionsRecorded: false,
        unassignedAttachmentPages: payload?.unassignedPages ?? [],
        attachmentPagesWithoutText: payload?.pagesWithoutText ?? [],
        agendaItemCount: payload?.items?.length ?? current.agendaItemCount,
        currentStep: "Attachment pages linked to agenda topics",
      }));
    } catch (linkError) {
      const message = linkError instanceof Error ? linkError.message : "Attachment linking failed.";
      setError(message);
    } finally {
      deepSeekRun.current = false;
      setLinking(false);
      setDeepSeekConfirm(null);
    }
  }

  async function testDeepSeek() {
    setPingingDeepSeek(true);
    setDeepSeekPing(null);
    try {
      const response = await fetch("/api/v3/deepseek-ping", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { summary?: string; error?: string } | null;
      setDeepSeekPing(payload?.summary || payload?.error || "DeepSeek test failed.");
    } catch (pingError) {
      setDeepSeekPing(pingError instanceof Error ? pingError.message : "DeepSeek test failed.");
    } finally {
      setPingingDeepSeek(false);
    }
  }

  async function resolveFacts() {
    if (deepSeekRun.current) return;
    setDeepSeekConfirm(null);
    deepSeekRun.current = true;
    setResolving(true);
    setError(null);
    setStatus((current) => ({ ...current, currentStep: "Resolving quoted facts from package pages" }));
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/facts`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | {
            items?: AgendaItem[];
            factCount?: number;
            unresolvedItemCount?: number;
            error?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Fact resolution failed.");
      }
      setAgendaItems(payload?.items ?? []);
      setStatus((current) => ({
        ...current,
        factsResolved: true,
        factCount: payload?.factCount ?? 0,
        unresolvedFactItemCount: payload?.unresolvedItemCount ?? 0,
        factsGrouped: false,
        factGroupCount: 0,
        ungroupedFactCount: 0,
        conclusionsRecorded: false,
        currentStep:
          (payload?.unresolvedItemCount ?? 0) > 0
            ? "Quoted facts stored; some items have more than one value"
            : "Quoted facts stored from package pages",
      }));
    } catch (factError) {
      const message = factError instanceof Error ? factError.message : "Fact resolution failed.";
      setError(message);
    } finally {
      deepSeekRun.current = false;
      setResolving(false);
      setDeepSeekConfirm(null);
    }
  }

  async function segmentTranscript() {
    if (deepSeekRun.current) return;
    deepSeekRun.current = true;
    setSegmenting(true);
    setError(null);
    setStatus((current) => ({ ...current, currentStep: "Segmenting the transcript" }));
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/transcript`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | {
            items?: AgendaItem[];
            spanCount?: number;
            overlapItemCount?: number;
            error?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Transcript segmentation failed.");
      }
      setAgendaItems(payload?.items ?? []);
      setStatus((current) => ({
        ...current,
        transcriptSegmented: true,
        transcriptSpanCount: payload?.spanCount ?? 0,
        transcriptOverlapItemCount: payload?.overlapItemCount ?? 0,
        conclusionsRecorded: false,
        agendaItemCount: payload?.items?.length ?? current.agendaItemCount,
        currentStep:
          (payload?.overlapItemCount ?? 0) > 0
            ? "Transcript spans stored; some topics share a stretch"
            : "Transcript spans stored from the cues",
      }));
    } catch (spanError) {
      const message = spanError instanceof Error ? spanError.message : "Transcript segmentation failed.";
      setError(message);
    } finally {
      deepSeekRun.current = false;
      setSegmenting(false);
      setDeepSeekConfirm(null);
    }
  }

  async function groupSources() {
    if (deepSeekRun.current) return;
    deepSeekRun.current = true;
    setGrouping(true);
    setError(null);
    setStatus((current) => ({ ...current, currentStep: "Grouping quoted facts by source" }));
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/fact-groups`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | {
            items?: AgendaItem[];
            groupCount?: number;
            ungroupedCount?: number;
            error?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Fact grouping failed.");
      }
      setAgendaItems(payload?.items ?? []);
      setStatus((current) => ({
        ...current,
        factsGrouped: true,
        factGroupCount: payload?.groupCount ?? 0,
        ungroupedFactCount: payload?.ungroupedCount ?? 0,
        agendaItemCount: payload?.items?.length ?? current.agendaItemCount,
        currentStep:
          (payload?.ungroupedCount ?? 0) > 0
            ? "Sources linked; some figures do not name a project"
            : "Quoted facts linked by project",
      }));
    } catch (groupError) {
      const message = groupError instanceof Error ? groupError.message : "Fact grouping failed.";
      setError(message);
    } finally {
      deepSeekRun.current = false;
      setGrouping(false);
      setDeepSeekConfirm(null);
    }
  }

  async function reconcileMeeting() {
    if (deepSeekRun.current) return;
    deepSeekRun.current = true;
    setReconciling(true);
    setError(null);
    setStatus((current) => ({ ...current, currentStep: "Reading the transcript stretches" }));
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/conclusions`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | {
            items?: AgendaItem[];
            itemCount?: number;
            unclearCount?: number;
            error?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Meeting reconciliation failed.");
      }
      setAgendaItems(payload?.items ?? []);
      setStatus((current) => ({
        ...current,
        conclusionsRecorded: true,
        agendaItemCount: payload?.items?.length ?? current.agendaItemCount,
        currentStep:
          (payload?.unclearCount ?? 0) > 0
            ? "Meeting reconciled; some topics have no decision in the transcript"
            : "Meeting conclusions stored from the transcript",
      }));
    } catch (reconcileError) {
      const message = reconcileError instanceof Error ? reconcileError.message : "Meeting reconciliation failed.";
      setError(message);
    } finally {
      deepSeekRun.current = false;
      setReconciling(false);
    }
  }

  const shownStep = wizard.steps.find((step) => step.id === pickedStep && step.state !== "upcoming")
    ?? wizard.steps.find((step) => step.id === wizard.activeId)
    ?? wizard.steps[0];
  const shownAgendaItems = useMemo(
    () => agendaItemsForWizardStep(agendaItems, shownStep?.id),
    [agendaItems, shownStep?.id],
  );
  const pageAgenda = agendaItems.filter((item) => item.sourcePages.includes(pageNumber ?? -1));
  const extractRunning = running || status.stage === "extracting" || status.stage === "correcting";
  const hasExtractedPages = status.pageCount > 0 || pages.length > 0;
  const extractStepDone = agendaPageCount > 0 && Math.max(status.correctedPageCount, rewrites.length) >= agendaPageCount;
  const canRetryCorrectionOnly =
    hasExtractedPages && !extractStepDone && !extractRunning && status.stage !== "extracting";
  const extractLabel = extractRunning
    ? (status.stage === "correcting" ? "Correcting agenda pages…" : "Extracting the package…")
    : shownStep?.state === "complete"
      ? "Run again"
      : canRetryCorrectionOnly
        ? "Re-extract package"
        : "Extract and correct";
  const retryCorrectionLabel = extractRunning && status.stage === "correcting"
    ? "Correcting agenda pages…"
    : "Retry correction only";
  const split = status.agendaContentEndsAtPage;
  const transcriptOverlays = useMemo<TranscriptSectionOverlay[]>(
    () =>
      agendaItems.flatMap((item) =>
        (item.transcript?.spans ?? []).map((span) => ({
          id: `${item.id}:${span.startMs}`,
          code: item.itemNumber,
          title: item.title,
          startSeconds: span.startMs / 1000,
          endSeconds: span.endMs / 1000,
        })),
      ),
    [agendaItems],
  );

  function focusAgendaItem(agendaItemId: string) {
    setSelectedAgendaItemId(agendaItemId);
    const item = agendaItems.find((row) => row.id === agendaItemId);
    const span = item?.transcript?.spans[0];
    if (!span || !item || !transcriptScrollRef.current) return;
    const target = transcriptScrollRef.current.querySelector(
      `[data-transcript-span="${CSS.escape(`${item.id}:${span.startMs}`)}"]`,
    );
    target?.scrollIntoView({ block: "nearest" });
  }

  const attachmentRows = shownAgendaItems.map((item) => {
    const attachmentPages = split == null
      ? []
      : item.sourcePages.filter((page) => page > split).sort((left, right) => left - right);
    return { item, attachmentPages };
  });

  const attachmentsTableOpen =
    shownStep?.id === "attachments" &&
    status.attachmentsLinked &&
    !(agendaItems.length === 0 && status.agendaItemCount > 0) &&
    !(attachmentRows.length === 0 && status.unassignedAttachmentPages.length === 0);

  const factsTableOpen =
    shownStep?.id === "facts" &&
    status.factsResolved &&
    !(agendaItems.length === 0 && status.agendaItemCount > 0);

  const unassignedAttachmentBanner = unassignedAttachmentNotice(
    status.unassignedAttachmentPages,
    status.attachmentPagesWithoutText,
  );

  function openAttachmentPage(pageNumber: number) {
    setPageNumber(pageNumber);
    showWizardStep("extract");
  }

  const factReviewMessages = agendaItems.flatMap((item) => summarizeItemFactReviews(item));
  const factContextMessages = agendaItems.flatMap((item) =>
    item.facts
      ? factContextNotes(item.facts).map((note) => `${item.itemNumber} ${item.title}: ${note}`)
      : [],
  );
  const hasMeetingDocuments = status.hasTranscript || status.hasBoardPackage;
  const documentsAgendaOverlay = useMemo(
    () =>
      agendaItems.map((item) => ({
        id: item.id,
        title: item.title,
        itemNumber: item.itemNumber,
      })),
    [agendaItems],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href="/operations/meetings?v=3"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
          >
            <span aria-hidden="true">←</span>
            Back to meetings
          </Link>
          <h1 className="min-w-0 truncate text-lg font-semibold text-slate-900 sm:text-xl">{status.title}</h1>
          <span className="hidden shrink-0 text-sm text-slate-400 sm:inline" aria-hidden="true">
            ·
          </span>
          <span className="shrink-0 text-sm text-slate-600">
            {status.meetingDate}
            {busy && status.currentStep ? ` · ${status.currentStep}` : ""}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasMeetingDocuments ? (
            <MeetingDocumentsIconButton
              onClick={() => setDocumentsDialogOpen(true)}
              title="Transcript and board package"
            />
          ) : null}
          <AiUsageIconButton onClick={() => setAiUsageOpen(true)} title="View V3 AI usage and cost" />
        </div>
      </div>

      {shownStep ? (
        <WizardBar
          steps={wizard.steps}
          shownId={shownStep.id}
          busy={busy}
          onShow={showWizardStep}
        />
      ) : null}
      {wizard.finished && !wizard.minutesComplete ? (
        <p className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Processing is complete. A working draft can list open points. These minutes stay incomplete until each open decision or figure is supported.
        </p>
      ) : null}

      {error ? (
        <p className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <div
        className={`flex min-h-0 flex-1 flex-col gap-4 ${
          (shownStep?.id === "transcript" && status.transcriptSegmented) ||
          attachmentsTableOpen ||
          factsTableOpen
            ? "overflow-hidden"
            : "overflow-y-auto"
        }`}
      >
      {shownStep?.id === "extract" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-600">{shownStep.detail}</p>
            <div className="flex flex-wrap gap-2">
              {shownStep.state === "complete" && !extractRunning ? (
                <button
                  type="button"
                  onClick={() => showWizardStep("agenda")}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Continue to agenda
                </button>
              ) : null}
              {canRetryCorrectionOnly ? (
                <button
                  type="button"
                  onClick={() => void retryCorrectionOnly()}
                  disabled={busy}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {retryCorrectionLabel}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void extractPackage()}
                disabled={busy}
                className={canRetryCorrectionOnly || (shownStep.state === "complete" && !extractRunning)
                  ? "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  : "rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"}
              >
                {extractLabel}
              </button>
            </div>
          </div>
          {status.pageCount === 0 && pages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              {extractRunning
                ? "Docling is reading the board package. Agenda pages are then corrected from the PDF."
                : "This step reads the package, then corrects agenda pages only."}
            </div>
          ) : (
            <>
              <PageNavBar
                pages={pages}
                pageIndex={pageIndex}
                pageNumber={pageNumber}
                correctedCount={rewrites.length}
                agendaPageCount={agendaPageCount}
                onPageChange={setPageNumber}
                onExpand={() => setExpanded(true)}
              />
              <CompareColumns {...compareProps} />
            </>
          )}
        </>
      ) : null}

      {shownStep?.id === "agenda" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-600">{shownStep.detail}</p>
            <div className="flex flex-wrap gap-2">
              {agendaItems.length > 0 && !buildingAgenda ? (
                <button
                  type="button"
                  onClick={() => showWizardStep("attachments")}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Continue to attachments
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void buildAgenda()}
                disabled={busy}
                className={agendaItems.length > 0 && !buildingAgenda
                  ? "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  : "rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"}
              >
                {buildingAgenda ? "Building agenda…" : agendaItems.length > 0 ? "Run again" : "Build agenda"}
              </button>
            </div>
          </div>
          {agendaItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              {buildingAgenda
                ? "Reading the corrected pages into agenda topics."
                : "Build the agenda when the corrected pages look right."}
            </div>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white">
              <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
                Agenda from corrected pages
              </h2>
              <ul className="divide-y divide-slate-100">
                {shownAgendaItems.map((item) => {
                  const sourcePages = [...item.sourcePages].sort((left, right) => left - right);
                  const firstPage = sourcePages[0];
                  const pageLabel = formatSourcePages(sourcePages);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={firstPage == null}
                        onClick={() => {
                          if (firstPage == null) return;
                          setPageNumber(firstPage);
                          showWizardStep("extract");
                        }}
                        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 py-2 pr-3 text-left text-sm hover:bg-slate-50 disabled:cursor-default"
                        style={{ paddingLeft: `${12 + agendaItemIndentDepth(item.itemNumber) * 20}px` }}
                      >
                        <span
                          className="w-8 shrink-0 font-semibold tabular-nums text-slate-900"
                          title={item.itemNumber}
                        >
                          {displayAgendaSegment(item.itemNumber)}
                        </span>
                        <span className="font-medium text-slate-800">{item.title}</span>
                        {pageLabel ? (
                          <span className="text-xs text-slate-500">{pageLabel}</span>
                        ) : null}
                        {item.amount ? <span className="text-xs font-medium text-slate-700">{item.amount}</span> : null}
                        {item.vendors.length > 0 ? (
                          <span className="text-xs text-slate-600">{item.vendors.join(", ")}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {pageAgenda.length > 0 && pageNumber != null ? (
                <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
                  Open a topic to compare that page.
                </p>
              ) : null}
            </section>
          )}
        </>
      ) : null}

      {shownStep?.id === "attachments" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-600">{shownStep.detail}</p>
            <div className="flex flex-wrap gap-2">
              {status.attachmentsLinked && !linking ? (
                <button
                  type="button"
                  onClick={() => showWizardStep("facts")}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Continue to facts
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setDeepSeekConfirm("attachments")}
                disabled={busy}
                className={status.attachmentsLinked && !linking
                  ? "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  : "rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"}
              >
                {linking ? "Linking attachments…" : status.attachmentsLinked ? "Run again" : "Link attachments"}
              </button>
            </div>
          </div>
          {!status.attachmentsLinked ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              {linking
                ? "Reading corrected pages after the agenda and matching them to topics."
                : "Link attachment pages once the agenda looks right."}
            </div>
          ) : agendaItems.length === 0 && status.agendaItemCount > 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              Loading linked pages.
            </div>
          ) : attachmentRows.length === 0 && status.unassignedAttachmentPages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              No pages sit after the agenda split.
            </div>
          ) : (
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
              <h2 className="shrink-0 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
                Attachment pages
              </h2>
              {unassignedAttachmentBanner ? (
                <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {unassignedAttachmentBanner}
                </p>
              ) : null}
              <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
                {attachmentRows.map(({ item, attachmentPages }) => (
                  <li
                    key={item.id}
                    className="py-2 pr-3 text-sm"
                    style={{ paddingLeft: `${12 + agendaItemIndentDepth(item.itemNumber) * 20}px` }}
                  >
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1">
                        <span
                          className="inline-block w-8 shrink-0 font-semibold tabular-nums text-slate-900"
                          title={item.itemNumber}
                        >
                          {displayAgendaSegment(item.itemNumber)}
                        </span>
                        <span className="font-medium text-slate-800">{item.title}</span>
                      </p>
                      {attachmentPages.length > 0 ? (
                        <div className="flex shrink-0 flex-wrap justify-end gap-1 self-start">
                          <AttachmentPageRangeBadges
                            pages={attachmentPages}
                            onOpenPage={openAttachmentPage}
                          />
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : null}

      {shownStep?.id === "facts" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-600">{shownStep.detail}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void testDeepSeek()}
                disabled={busy}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                {pingingDeepSeek ? "Testing DeepSeek…" : "Test DeepSeek"}
              </button>
              <button
                type="button"
                onClick={() => setDeepSeekConfirm("facts")}
                disabled={busy}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {resolving ? "Resolving facts…" : status.factsResolved ? "Run again" : "Resolve facts"}
              </button>
            </div>
          </div>
          {deepSeekPing ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{deepSeekPing}</p>
          ) : null}
          {resolving ? <FactResolutionProgressBar step={status.currentStep} /> : null}
          {!status.factsResolved ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              {resolving
                ? "Reading each topic's pages and keeping only figures that appear in a quote."
                : "Resolve facts once the attachment pages look right."}
            </div>
          ) : agendaItems.length === 0 && status.agendaItemCount > 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              Loading quoted facts.
            </div>
          ) : (
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
              <h2 className="shrink-0 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
                Quoted facts
              </h2>
              <div className="shrink-0 border-b border-slate-200 px-3 py-2">
                <QuotedFactsTabStrip
                  active={quotedFactsPanel}
                  reviewCount={factReviewMessages.length}
                  contextCount={factContextMessages.length}
                  onChange={setQuotedFactsPanel}
                />
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto"
                role="tabpanel"
                aria-label={
                  quotedFactsPanel === "review"
                    ? "Needs review"
                    : quotedFactsPanel === "context"
                      ? "Context"
                      : "By agenda"
                }
              >
              {quotedFactsPanel === "review" ? (
                factReviewMessages.length > 0 ? (
                  <ul className="divide-y divide-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {factReviewMessages.map((message, index) => (
                      <li key={`review-${index}`} className="py-1.5">{message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-slate-600">Nothing flagged for review.</p>
                )
              ) : quotedFactsPanel === "context" ? (
                factContextMessages.length > 0 ? (
                  <ul className="divide-y divide-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {factContextMessages.map((message, index) => (
                      <li key={`context-${index}`} className="py-1.5">{message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-slate-600">No context notes.</p>
                )
              ) : (
              <ul className="divide-y divide-slate-100">
                {shownAgendaItems.map((item) => (
                  <li
                    key={item.id}
                    className="py-2 pr-3 text-sm"
                    style={{ paddingLeft: `${12 + agendaItemIndentDepth(item.itemNumber) * 20}px` }}
                  >
                    <p>
                      <span
                        className="inline-block w-8 font-semibold tabular-nums text-slate-900"
                        title={item.itemNumber}
                      >
                        {displayAgendaSegment(item.itemNumber)}
                      </span>
                      <span className="font-medium text-slate-800">{item.title}</span>
                    </p>
                    {item.facts && item.facts.candidates.length > 0 ? (
                      <ul className="mt-1 space-y-2">
                        {item.facts.candidates.map((fact, factIndex) => {
                          const unresolved = item.facts?.unresolvedFields.includes(fact.field);
                          return (
                            <li key={`${item.id}-fact-${factIndex}`}>
                              <p>
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  {FACT_FIELD_LABEL[fact.field]}
                                </span>
                                <span className="ml-2 font-medium text-slate-800">{fact.value}</span>
                                {unresolved ? (
                                  <span className="ml-2 text-xs font-medium text-amber-800">Conflict</span>
                                ) : null}
                                {fact.organizationMatch === "confirmed" ? (
                                  <span className="ml-2 text-xs font-medium text-teal-800">Organization matched</span>
                                ) : null}
                                {fact.basis === "per_visit" ? (
                                  <span className="ml-2 text-xs font-medium text-slate-600">Per visit</span>
                                ) : null}
                                {fact.basis === "fixed" ? (
                                  <span className="ml-2 text-xs font-medium text-slate-600">Fixed fee</span>
                                ) : null}
                                {fact.role ? (
                                  <span className="ml-2 text-xs font-medium text-slate-600">{FACT_ROLE_LABEL[fact.role]}</span>
                                ) : null}
                                {fact.service ? (
                                  <span className="ml-2 text-xs text-slate-600">for {fact.service}</span>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPageNumber(fact.page);
                                    showWizardStep("extract");
                                  }}
                                  className="ml-2 rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Page {fact.page}
                                </button>
                              </p>
                              <p className="mt-0.5 text-xs text-slate-600">{fact.quote}</p>
                            </li>
                          );
                        })}
                      </ul>
                    ) : isAgendaItemLeaf(
                        item.itemNumber,
                        shownAgendaItems.map((row) => row.itemNumber),
                      ) ? (
                      <p className="mt-1 text-xs text-slate-500">No quoted fact on the linked pages.</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              )}
              </div>
            </section>
          )}
        </>
      ) : null}

      {shownStep?.id === "transcript" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-600">{shownStep.detail}</p>
            <div className="flex flex-wrap gap-2">
              {status.transcriptSegmented && !segmenting ? (
                <button
                  type="button"
                  onClick={() => showWizardStep("sources")}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Continue to sources
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setDeepSeekConfirm("transcript")}
                disabled={busy || !status.hasTranscript}
                className={status.transcriptSegmented && !segmenting
                  ? "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  : "rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"}
              >
                {segmenting ? "Segmenting transcript…" : status.transcriptSegmented ? "Run again" : "Segment transcript"}
              </button>
            </div>
          </div>
          {!status.hasTranscript ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              This meeting has no transcript yet.
            </div>
          ) : !status.transcriptSegmented ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              {segmenting
                ? "Walking the transcript, then checking span edges and gaps."
                : "Segment the transcript once the quoted facts look right."}
            </div>
          ) : agendaItems.length === 0 && status.agendaItemCount > 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              Loading transcript spans.
            </div>
          ) : (
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
              {status.transcriptOverlapItemCount > 0 ? (
                <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {status.transcriptOverlapItemCount === 1
                    ? "1 topic shares a stretch with another topic. Neither was dropped."
                    : `${status.transcriptOverlapItemCount} topics share a stretch with another topic. Neither was dropped.`}
                </p>
              ) : null}
              {transcriptLoadError ? (
                <p className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {transcriptLoadError}
                </p>
              ) : null}
              <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_18rem]">
                <div ref={transcriptScrollRef} className="min-h-0 overflow-y-auto">
                  {transcriptCues == null ? (
                    <p className="px-4 py-6 text-sm text-slate-600">Loading transcript…</p>
                  ) : transcriptCues.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-slate-600">No transcript cues found.</p>
                  ) : (
                    <ReadableTranscriptView
                      cues={transcriptCues}
                      sectionOverlays={transcriptOverlays}
                      showSectionOverlay={transcriptOverlays.length > 0}
                      onSectionClick={(section) => {
                        const agendaId = agendaItems.find((row) => section.id.startsWith(`${row.id}:`))?.id;
                        if (agendaId) focusAgendaItem(agendaId);
                      }}
                    />
                  )}
                </div>
                <aside className="min-h-0 overflow-y-auto border-t border-slate-200 bg-slate-50 md:border-l md:border-t-0">
                  <p className="sticky top-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Agenda
                  </p>
                  <ul className="p-2">
                    {agendaItems.map((item) => {
                      const selected = selectedAgendaItemId === item.id;
                      const spans = item.transcript?.spans ?? [];
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => focusAgendaItem(item.id)}
                            className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                              selected ? "bg-white shadow-sm ring-1 ring-teal-600" : "hover:bg-white"
                            }`}
                            style={{ paddingLeft: `${8 + agendaItemIndentDepth(item.itemNumber) * 14}px` }}
                          >
                            <span className="font-mono text-[11px] text-slate-500" title={item.itemNumber}>
                              {displayAgendaSegment(item.itemNumber)}
                            </span>{" "}
                            <span className={selected ? "font-semibold text-slate-900" : "text-slate-800"}>
                              {item.title}
                            </span>
                            {spans.length > 0 ? (
                              <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-slate-500">
                                {spans
                                  .map((span) => `${formatSpanClock(span.startMs)}–${formatSpanClock(span.endMs)}`)
                                  .join(", ")}
                              </span>
                            ) : isAgendaItemLeaf(
                                item.itemNumber,
                                agendaItems.map((row) => row.itemNumber),
                              ) ? (
                              <span className="mt-0.5 block text-[11px] text-slate-400">No span</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </aside>
              </div>
            </section>
          )}
        </>
      ) : null}

      {shownStep?.id === "sources" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-600">{shownStep.detail}</p>
            <button
              type="button"
              onClick={() => void groupSources()}
              disabled={busy}
              className={status.factsGrouped && !grouping
                ? "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                : "rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"}
            >
              {grouping ? "Grouping sources…" : status.factsGrouped ? "Run again" : "Group sources"}
            </button>
          </div>
          {!status.factsGrouped ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              {grouping
                ? "Linking figures that name the same project."
                : "Group sources once the quoted facts look right."}
            </div>
          ) : agendaItems.length === 0 && status.agendaItemCount > 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              Loading source groups.
            </div>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white">
              <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
                Sources
              </h2>
              {status.ungroupedFactCount > 0 ? (
                <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {status.ungroupedFactCount === 1
                    ? "1 figure does not name a project, so it stays unlinked."
                    : `${status.ungroupedFactCount} figures do not name a project, so they stay unlinked.`}
                </p>
              ) : null}
              <ul className="divide-y divide-slate-100">
                {agendaItems.map((item) => (
                  <li
                    key={item.id}
                    className="py-2 pr-3 text-sm"
                    style={{ paddingLeft: `${12 + agendaItemIndentDepth(item.itemNumber) * 20}px` }}
                  >
                    <p>
                      <span
                        className="inline-block w-8 font-semibold tabular-nums text-slate-900"
                        title={item.itemNumber}
                      >
                        {displayAgendaSegment(item.itemNumber)}
                      </span>
                      <span className="font-medium text-slate-800">{item.title}</span>
                    </p>
                    {item.factGroups && item.factGroups.statements.length > 0 ? (
                      <ul className="mt-2 space-y-3">
                        {item.factGroups.statements.map((statement) => (
                          <li key={`${statement.subject}-${statement.revision ?? ""}-${statement.pages.join("-")}`}>
                            <p className="font-medium text-slate-800">
                              {statement.subject}
                              {statement.revision ? <span className="ml-2 text-xs font-normal text-slate-600">{statement.revision}</span> : null}
                              {statement.uncertain ? (
                                <span className="ml-2 text-xs font-medium text-amber-800">Fee row needs a look</span>
                              ) : null}
                            </p>
                            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                              {statement.members.map((member) => (
                                <span key={`${member.field}-${member.value}-${member.page}-${member.quote}`}>
                                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    {FACT_FIELD_LABEL[member.field]}
                                  </span>
                                  <span className="ml-2 font-medium text-slate-800">{member.value}</span>
                                  {member.service ? <span className="ml-2 text-xs text-slate-600">for {member.service}</span> : null}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPageNumber(member.page);
                                      showWizardStep("extract");
                                    }}
                                    className="ml-2 rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                  >
                                    Page {member.page}
                                  </button>
                                </span>
                              ))}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {item.factGroups && item.factGroups.groups.length > 0 ? (
                      <ul className="mt-2 space-y-3">
                        {item.factGroups.groups.map((group) => (
                          <li key={`${group.page}-${group.quote}`}>
                            <p className="flex flex-wrap gap-x-3 gap-y-1">
                              {group.members.map((member) => (
                                <span key={`${member.field}-${member.value}`}>
                                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    {FACT_FIELD_LABEL[member.field]}
                                  </span>
                                  <span className="ml-2 font-medium text-slate-800">{member.value}</span>
                                  {group.unresolvedFields.includes(member.field) ? (
                                    <span className="ml-2 text-xs font-medium text-amber-800">Unresolved</span>
                                  ) : null}
                                </span>
                              ))}
                              <button
                                type="button"
                                onClick={() => {
                                  setPageNumber(group.page);
                                  showWizardStep("extract");
                                }}
                                className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                Page {group.page}
                              </button>
                            </p>
                            <p className="mt-0.5 text-xs text-slate-600">{group.quote}</p>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {item.factGroups && item.factGroups.ungrouped.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {item.factGroups.ungrouped.map((fact, factIndex) => (
                          <li key={`${item.id}-ungrouped-${factIndex}`} className="text-xs text-slate-600">
                            <span className="font-semibold uppercase tracking-wide text-slate-500">
                              {FACT_FIELD_LABEL[fact.field]}
                            </span>
                            <span className="ml-2 text-slate-800">{fact.value}</span>
                            <span className="ml-2 text-slate-500">Does not name a project</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {(!item.factGroups || (item.factGroups.groups.length === 0 && item.factGroups.statements.length === 0 && item.factGroups.ungrouped.length === 0))
                      && isAgendaItemLeaf(item.itemNumber, agendaItems.map((row) => row.itemNumber)) ? (
                      <p className="mt-1 text-xs text-slate-500">No quoted fact on the linked pages.</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : null}

      {shownStep?.id === "conclusions" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-600">{shownStep.detail}</p>
            <button
              type="button"
              onClick={() => void reconcileMeeting()}
              disabled={busy}
              className={status.conclusionsRecorded && !reconciling
                ? "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                : "rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"}
            >
              {reconciling ? "Reconciling meeting…" : status.conclusionsRecorded ? "Run again" : "Reconcile meeting"}
            </button>
          </div>
          {!status.conclusionsRecorded ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
              {reconciling
                ? "Reading the full transcript stretch for each topic."
                : "Reconcile the meeting once the source links look right."}
            </div>
          ) : (
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
              <h2 className="shrink-0 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
                Meeting conclusions
              </h2>
              <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
                {shownAgendaItems.map((item) => (
                  <li
                    key={item.id}
                    className="py-2 pr-3 text-sm"
                    style={{ paddingLeft: `${12 + agendaItemIndentDepth(item.itemNumber) * 20}px` }}
                  >
                    <p>
                      <span className="inline-block w-8 font-semibold tabular-nums text-slate-900" title={item.itemNumber}>
                        {displayAgendaSegment(item.itemNumber)}
                      </span>
                      <span className="font-medium text-slate-800">{item.title}</span>
                      {item.conclusion ? (
                        <span className="ml-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                          {item.conclusion.status}
                          {item.conclusion.status === "discussed" || item.conclusion.status === "unclear"
                            ? " — not a settled decision"
                            : ""}
                        </span>
                      ) : null}
                    </p>
                    {item.conclusion?.quote ? (
                      <p className="mt-1 text-xs text-slate-700">{item.conclusion.quote}</p>
                    ) : item.conclusion?.status === "unclear" ? (
                      <p className="mt-1 text-xs text-slate-500">No transcript stretch for this topic.</p>
                    ) : null}
                    {item.conclusion?.packageQuote ? (
                      <p className="mt-1 text-xs text-slate-600">Package reference: {item.conclusion.packageQuote}</p>
                    ) : null}
                    {item.conclusion?.openReference ? (
                      <p className="mt-1 text-xs text-amber-800">The discussion points at a package fact this topic does not have.</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : null}
      </div>

      {expanded && status.pageCount > 0 ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-slate-900/70 p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="v3-compare-expanded-title"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-2xl">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
              <div>
                <p id="v3-compare-expanded-title" className="text-sm font-semibold text-slate-900">
                  Page comparison — {status.title}
                </p>
                <p className="text-xs text-slate-500">Escape or Close to return</p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-4">
              <PageNavBar
                pages={pages}
                pageIndex={pageIndex}
                pageNumber={pageNumber}
                correctedCount={rewrites.length}
                agendaPageCount={agendaPageCount}
                onPageChange={setPageNumber}
              />
              <CompareColumns {...compareProps} />
            </div>
          </div>
        </div>
      ) : null}

      <DeepSeekActionConfirmDialog
        open={deepSeekConfirm != null}
        title={
          deepSeekConfirm === "sources"
            ? "Group sources?"
            : deepSeekConfirm === "transcript"
              ? "Segment transcript?"
              : deepSeekConfirm === "facts"
                ? "Resolve facts?"
                : "Link attachments?"
        }
        description={
          deepSeekConfirm === "sources"
            ? "This links figures that name the same project. It does not call DeepSeek."
            : deepSeekConfirm === "transcript"
              ? "This reads the transcript with DeepSeek and keeps a stretch only when its quote is inside that time range. Talk that is not on the agenda is stored as additional business (4.E)."
              : deepSeekConfirm === "facts"
                ? "This reads each topic's pages with DeepSeek and keeps a figure only when its quote is on that page."
                : "Pages the agenda does not already name are matched to topics with DeepSeek."
        }
        confirmLabel={
          deepSeekConfirm === "sources"
            ? "Group sources"
            : deepSeekConfirm === "transcript"
              ? "Segment transcript"
              : deepSeekConfirm === "facts"
                ? "Resolve facts"
                : "Link attachments"
        }
        busyLabel={
          deepSeekConfirm === "sources"
            ? "Grouping sources…"
            : deepSeekConfirm === "transcript"
              ? "Segmenting transcript…"
              : deepSeekConfirm === "facts"
                ? "Resolving facts…"
                : "Linking attachments…"
        }
        busy={linking || segmenting || grouping}
        onCancel={() => setDeepSeekConfirm(null)}
        onConfirm={() => {
          if (deepSeekConfirm === "sources") void groupSources();
          else if (deepSeekConfirm === "transcript") void segmentTranscript();
          else if (deepSeekConfirm === "facts") void resolveFacts();
          else void linkAttachments();
        }}
      />
      <AiUsageDialog
        open={aiUsageOpen}
        stages={aiUsageStages}
        loading={aiUsageLoading}
        onClose={() => setAiUsageOpen(false)}
      />
      <MeetingDocumentsDialog
        open={documentsDialogOpen}
        meetingId={status.id}
        transcriptFileName={status.transcriptFileName ?? undefined}
        hasTranscript={status.hasTranscript}
        hasBoardPackage={status.hasBoardPackage}
        agendaItems={documentsAgendaOverlay}
        onClose={() => setDocumentsDialogOpen(false)}
      />
    </div>
  );
}
