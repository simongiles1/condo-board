"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { MarkdownPreview } from "@/components/MarkdownPreview";
import { formatSourcePages } from "@/lib/meeting-v3/agenda-pages";
import type { MeetingsV3PackageStatus } from "@/lib/meeting-v3/package-status";
import {
  meetingsV3WizardProgress,
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
  itemNumber: string;
  title: string;
  sourcePages: number[];
  summary: string | null;
  amount: string | null;
  vendors: string[];
  recommendation: string | null;
};

type PageNavProps = {
  pages: ExtractedPage[];
  pageIndex: number;
  pageNumber: number | null;
  correctedCount: number;
  onPageChange: (pageNumber: number) => void;
  onExpand?: () => void;
};

function PageNavBar({ pages, pageIndex, pageNumber, correctedCount, onPageChange, onExpand }: PageNavProps) {
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
      <label className="text-sm text-slate-700">
        Page
        <select
          className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1.5"
          value={pageNumber ?? ""}
          onChange={(event) => onPageChange(Number(event.target.value))}
        >
          {pages.map((page) => (
            <option key={page.pageNumber} value={page.pageNumber}>
              {page.pageNumber}
              {page.pageHeading ? ` — ${page.pageHeading}` : ""}
            </option>
          ))}
        </select>
      </label>
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
        {correctedCount} corrected {correctedCount === 1 ? "page" : "pages"}
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

type CompareColumnsProps = {
  meetingId: string;
  pageNumber: number | null;
  selectedPage: ExtractedPage | null;
  busy: boolean;
  correctedText: string | null;
  panelMinHeightClass: string;
};

function CompareColumns({
  meetingId,
  pageNumber,
  selectedPage,
  busy,
  correctedText,
  panelMinHeightClass,
}: CompareColumnsProps) {
  const doclingText = selectedPage?.extractedText?.trim() || "No extracted text on this page.";
  const corrected = correctedText?.trim()
    || (busy ? "Correcting this page." : "This page has not been corrected yet.");

  return (
    <div className={`grid min-h-0 flex-1 gap-3 lg:grid-cols-3 ${panelMinHeightClass}`}>
      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="shrink-0 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
          Board package
        </h2>
        {pageNumber != null ? (
          <iframe
            key={pageNumber}
            title={`Board package page ${pageNumber}`}
            src={`/api/meetings/${meetingId}/board-package#page=${pageNumber}`}
            className="min-h-0 w-full flex-1"
          />
        ) : null}
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="shrink-0 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
          Docling extract
        </h2>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <MarkdownPreview>{doclingText}</MarkdownPreview>
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="shrink-0 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
          Corrected extract
        </h2>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <MarkdownPreview>{corrected}</MarkdownPreview>
        </div>
      </section>
    </div>
  );
}

type WizardBarProps = {
  steps: Array<MeetingsV3WizardStep & { state: "complete" | "current" | "upcoming" }>;
  shownId: MeetingsV3WizardStep["id"];
  completedCount: number;
  busy: boolean;
  onShow: (id: MeetingsV3WizardStep["id"]) => void;
};

function WizardBar({ steps, shownId, completedCount, busy, onShow }: WizardBarProps) {
  const width = steps.length === 0 ? 0 : Math.round((completedCount / steps.length) * 100);
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
        <div className="h-full rounded-full bg-teal-700" style={{ width: `${width}%` }} />
      </div>
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
                  <span className="block text-xs text-slate-500">
                    {step.state === "complete" ? "Done" : step.state === "current" ? "Current" : "Later"}
                  </span>
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
 * Walks a V3 meeting through extract and correct, the agenda, then attachment pages.
 * Finished stages stay open. The next stage is another entry on the same bar.
 */
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
  const [pickedStep, setPickedStep] = useState<MeetingsV3WizardStep["id"] | null>(null);

  const busy = running || buildingAgenda || linking || status.stage === "extracting" || status.stage === "correcting";

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

  const compareProps: CompareColumnsProps = {
    meetingId: status.id,
    pageNumber,
    selectedPage,
    busy,
    correctedText,
    panelMinHeightClass: "min-h-[28rem]",
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
        if (payload.stage === "ready") setPickedStep("extract");
      }
    } catch (extractError) {
      const message = extractError instanceof Error ? extractError.message : "Package extraction failed.";
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
        unassignedAttachmentPages: [],
      }));
      setPickedStep(null);
    } catch (agendaError) {
      const message = agendaError instanceof Error ? agendaError.message : "Agenda extraction failed.";
      setError(message);
    } finally {
      setBuildingAgenda(false);
    }
  }

  async function linkAttachments() {
    setLinking(true);
    setError(null);
    setStatus((current) => ({ ...current, currentStep: "Linking attachment pages to agenda topics" }));
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/attachments`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { items?: AgendaItem[]; unassignedPages?: number[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Attachment linking failed.");
      }
      setAgendaItems(payload?.items ?? []);
      setStatus((current) => ({
        ...current,
        attachmentsLinked: true,
        unassignedAttachmentPages: payload?.unassignedPages ?? [],
        agendaItemCount: payload?.items?.length ?? current.agendaItemCount,
        currentStep: "Attachment pages linked to agenda topics",
      }));
    } catch (linkError) {
      const message = linkError instanceof Error ? linkError.message : "Attachment linking failed.";
      setError(message);
    } finally {
      setLinking(false);
    }
  }

  const wizard = meetingsV3WizardProgress({
    pageCount: Math.max(status.pageCount, pages.length),
    correctedPageCount: Math.max(status.correctedPageCount, rewrites.length),
    agendaItemCount: Math.max(status.agendaItemCount, agendaItems.length),
    attachmentsLinked: status.attachmentsLinked,
  });
  const shownStep = wizard.steps.find((step) => step.id === pickedStep && step.state !== "upcoming")
    ?? wizard.steps.find((step) => step.id === wizard.activeId)
    ?? wizard.steps[0];
  const pageAgenda = agendaItems.filter((item) => item.sourcePages.includes(pageNumber ?? -1));
  const extractRunning = running || status.stage === "extracting" || status.stage === "correcting";
  const extractLabel = extractRunning
    ? (status.stage === "correcting" ? "Correcting every page…" : "Extracting the package…")
    : shownStep?.state === "complete"
      ? "Run again"
      : "Extract and correct";
  const split = status.agendaContentEndsAtPage;
  const attachmentRows = agendaItems.flatMap((item) => {
    const attachmentPages = split == null
      ? []
      : item.sourcePages.filter((page) => page > split).sort((left, right) => left - right);
    return attachmentPages.length > 0 ? [{ item, attachmentPages }] : [];
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <Link href="/operations/meetings?v=3" className="text-xs font-semibold uppercase tracking-wide text-teal-700 hover:text-teal-900">
          Meetings V3
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">{status.title}</h1>
        <p className="text-sm text-slate-600">
          {status.meetingDate}
          {busy && status.currentStep ? ` · ${status.currentStep}` : ""}
        </p>
      </div>

      {shownStep ? (
        <WizardBar
          steps={wizard.steps}
          shownId={shownStep.id}
          completedCount={wizard.completedCount}
          busy={busy}
          onShow={setPickedStep}
        />
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      {shownStep?.id === "extract" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-600">{shownStep.detail}</p>
            <div className="flex flex-wrap gap-2">
              {shownStep.state === "complete" && !extractRunning ? (
                <button
                  type="button"
                  onClick={() => setPickedStep("agenda")}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Continue to agenda
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void extractPackage()}
                disabled={busy}
                className={shownStep.state === "complete" && !extractRunning
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
                ? "Docling is reading the board package. Every stored page is then corrected."
                : "This step reads the package, then corrects every page."}
            </div>
          ) : (
            <>
              <PageNavBar
                pages={pages}
                pageIndex={pageIndex}
                pageNumber={pageNumber}
                correctedCount={rewrites.length}
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
                  onClick={() => setPickedStep("attachments")}
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
              <ul className="max-h-80 divide-y divide-slate-100 overflow-auto">
                {agendaItems.map((item) => {
                  const sourcePages = [...item.sourcePages].sort((left, right) => left - right);
                  const firstPage = sourcePages[0];
                  const pageLabel = formatSourcePages(sourcePages);
                  return (
                    <li key={`${item.itemNumber}-${item.title}`}>
                      <button
                        type="button"
                        disabled={firstPage == null}
                        onClick={() => {
                          if (firstPage == null) return;
                          setPageNumber(firstPage);
                          setPickedStep("extract");
                        }}
                        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-default"
                      >
                        <span className="font-semibold tabular-nums text-slate-900">{item.itemNumber}</span>
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
            <button
              type="button"
              onClick={() => void linkAttachments()}
              disabled={busy}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {linking ? "Linking attachments…" : status.attachmentsLinked ? "Run again" : "Link attachments"}
            </button>
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
            <section className="rounded-xl border border-slate-200 bg-white">
              <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
                Attachment pages
              </h2>
              <ul className="max-h-80 divide-y divide-slate-100 overflow-auto">
                {attachmentRows.map(({ item, attachmentPages }) => (
                  <li key={`${item.itemNumber}-${item.title}`} className="px-3 py-2 text-sm">
                    <p>
                      <span className="font-semibold tabular-nums text-slate-900">{item.itemNumber}</span>
                      <span className="ml-3 font-medium text-slate-800">{item.title}</span>
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {attachmentPages.map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => {
                            setPageNumber(page);
                            setPickedStep("extract");
                          }}
                          className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Page {page}
                        </button>
                      ))}
                    </p>
                  </li>
                ))}
              </ul>
              {status.unassignedAttachmentPages.length > 0 ? (
                <div className="border-t border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <p className="font-medium text-slate-900">Not linked</p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {status.unassignedAttachmentPages.map((page) => (
                      <button
                        key={page}
                        type="button"
                        onClick={() => {
                          setPageNumber(page);
                          setPickedStep("extract");
                        }}
                        className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                      >
                        Page {page}
                      </button>
                    ))}
                  </p>
                </div>
              ) : null}
            </section>
          )}
        </>
      ) : null}

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
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
              <PageNavBar
                pages={pages}
                pageIndex={pageIndex}
                pageNumber={pageNumber}
                correctedCount={rewrites.length}
                onPageChange={setPageNumber}
              />
              <CompareColumns {...compareProps} panelMinHeightClass="min-h-0 flex-1" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
