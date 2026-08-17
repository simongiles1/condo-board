"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  estimateDoclingBackfillRate,
  estimateDoclingBackfillRateForRun,
  formatDoclingBackfillDuration,
  formatDoclingBackfillEta,
  formatDoclingBackfillRate,
  getDoclingBackfillTimingSnapshot,
} from "@/lib/email/docling-backfill-timing";
import { IbmDoclingSpendPanel } from "@/components/IbmDoclingSpendPanel";
import type { IbmDoclingSpendSummary } from "@/components/IbmDoclingSpendPanel";
import { DEFAULT_DOCLING_PROVIDER } from "@/lib/email/docling-provider";
import { formatCostUsd } from "@/lib/gemini/usage";

type ExtractionMode = "full" | "docling_only" | "vision_only";
type DoclingProvider = "sidecar" | "ibm";

type DoclingBackfillRun = {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  mode?: ExtractionMode;
  phase?: "docling" | "vision" | null;
  docLimit: number | null;
  totalDocs: number;
  totalPages: number;
  totalDoclingPages?: number;
  totalVisionPages?: number;
  corpusUncachedPages: number;
  corpusPendingDocs: number;
  corpusPendingVisionPages?: number;
  corpusPendingVisionDocs?: number;
  completedDocs: number;
  completedPages: number;
  completedDoclingPages?: number;
  completedVisionPages?: number;
  failedDocs: number;
  doclingProvider?: DoclingProvider;
  doclingCostUsd?: number;
  visionCostUsd?: number;
  plannedHashes?: string[];
  currentDocIndex: number;
  currentContentHash: string | null;
  currentLabel: string | null;
  currentPagesInDoc: number | null;
  stintStartedAt: string | null;
  completedPagesAtStintStart: number;
  activeElapsedMs: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  workerAlive?: boolean;
  visionErrors?: Array<{
    contentHash: string;
    pageNo: number;
    status: "failed" | "pending" | "processing";
    attempts: number;
    message: string;
  }>;
  errorGroups?: Array<{
    source: "vision";
    kind: string;
    label: string;
    pages: number;
    docs: number;
  }>;
};

function providerLabel(provider: DoclingProvider | undefined): string {
  return provider === "ibm" ? "IBM watsonx" : "Sidecar";
}

function modeLabel(mode: ExtractionMode | undefined): string {
  switch (mode) {
    case "vision_only":
      return "Vision only";
    case "docling_only":
      return "Docling only";
    case "full":
    default:
      return "Full (Docling + vision)";
  }
}

function statusLabel(status: DoclingBackfillRun["status"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function runStatusLabel(run: DoclingBackfillRun): string {
  if (
    run.status === "completed" &&
    (run.failedDocs > 0 ||
      failedVisionPages(run) > 0 ||
      incompleteDoclingPages(run) > 0)
  ) {
    return "Completed with errors";
  }
  return statusLabel(run.status);
}

function statusClass(status: DoclingBackfillRun["status"]): string {
  switch (status) {
    case "running":
      return "bg-amber-50 text-amber-900 ring-amber-200";
    case "completed":
      return "bg-emerald-50 text-emerald-900 ring-emerald-200";
    case "failed":
      return "bg-red-50 text-red-900 ring-red-200";
    case "cancelled":
      return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}

function runStatusClass(run: DoclingBackfillRun): string {
  if (
    run.status === "completed" &&
    (run.failedDocs > 0 ||
      failedVisionPages(run) > 0 ||
      incompleteDoclingPages(run) > 0)
  ) {
    return "bg-amber-50 text-amber-900 ring-amber-200";
  }
  return statusClass(run.status);
}

function incompleteDoclingPages(run: DoclingBackfillRun): number {
  return Math.max(
    0,
    (run.totalDoclingPages ?? 0) - (run.completedDoclingPages ?? 0),
  );
}

function failedVisionPages(run: DoclingBackfillRun): number {
  const fromGroups = (run.errorGroups ?? []).reduce(
    (n, group) => n + group.pages,
    0,
  );
  if (fromGroups > 0) return fromGroups;
  return (run.visionErrors ?? []).filter((item) => item.status === "failed")
    .length;
}

function remainingWorkPages(run: DoclingBackfillRun): number {
  return incompleteDoclingPages(run) + failedVisionPages(run);
}

function hasRemainingWork(run: DoclingBackfillRun): boolean {
  return (
    remainingWorkPages(run) > 0 ||
    (run.errorGroups ?? []).length > 0 ||
    Boolean(run.lastError)
  );
}

function runCardClass(run: DoclingBackfillRun): string {
  if (run.status === "running") {
    return "border-amber-200 bg-amber-50/70 text-amber-950";
  }
  if (run.status === "failed") {
    return "border-red-200 bg-red-50/80 text-red-950";
  }
  if (run.status === "cancelled") {
    return "border-slate-200 bg-slate-50 text-slate-800";
  }
  if (
    run.failedDocs > 0 ||
    failedVisionPages(run) > 0 ||
    incompleteDoclingPages(run) > 0
  ) {
    return "border-amber-200 bg-amber-50/70 text-amber-950";
  }
  return "border-emerald-200 bg-emerald-50/70 text-emerald-950";
}

function RunCounts({
  run,
  mutedClassName = "text-current/60",
}: {
  run: DoclingBackfillRun;
  mutedClassName?: string;
}) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      <div>
        <dt className={`text-[11px] font-medium uppercase tracking-wide ${mutedClassName}`}>
          Docs
        </dt>
        <dd className="tabular-nums text-sm font-semibold">
          {run.completedDocs.toLocaleString()}/
          {run.totalDocs.toLocaleString()}
        </dd>
      </div>
      <div>
        <dt className={`text-[11px] font-medium uppercase tracking-wide ${mutedClassName}`}>
          Docling
        </dt>
        <dd className="tabular-nums text-sm font-semibold">
          {(run.completedDoclingPages ?? 0).toLocaleString()}/
          {(run.totalDoclingPages ?? 0).toLocaleString()}
        </dd>
      </div>
      <div>
        <dt className={`text-[11px] font-medium uppercase tracking-wide ${mutedClassName}`}>
          Vision
        </dt>
        <dd className="tabular-nums text-sm font-semibold">
          {(run.completedVisionPages ?? 0).toLocaleString()}/
          {(run.totalVisionPages ?? 0).toLocaleString()}
        </dd>
      </div>
    </dl>
  );
}

function GeminiAdvice({ run }: { run: DoclingBackfillRun }) {
  const groups = run.errorGroups ?? [];
  const studioLink = (
    <a
      href="https://aistudio.google.com/usage"
      target="_blank"
      rel="noreferrer"
      className="font-medium underline decoration-red-300 underline-offset-2"
    >
      AI Studio
    </a>
  );
  return (
    <>
      {groups.some(
        (group) =>
          group.kind === "gemini_spend_cap" || group.kind === "gemini_quota",
      ) ? (
        <p>
          Gemini hit the monthly spending cap. Raise it in {studioLink}, then
          retry remaining pages.
        </p>
      ) : null}
      {groups.some((group) => group.kind === "gemini_credits") ? (
        <p>
          Gemini prepaid credits are depleted (separate from the monthly cap).
          Add credits or enable billing in {studioLink}, then retry remaining
          pages.
        </p>
      ) : null}
      {groups.some((group) => group.kind === "gemini_rate_limit") ? (
        <p>
          Gemini rate-limited this burst. Remaining pages stay pending — retry
          without changing the spend cap.
        </p>
      ) : null}
    </>
  );
}

function BackfillRemainingWork({
  run,
  defaultOpen,
}: {
  run: DoclingBackfillRun;
  defaultOpen: boolean;
}) {
  const groups = run.errorGroups ?? [];
  const doclingLeft = incompleteDoclingPages(run);
  const visionFailed = failedVisionPages(run);
  const leftover = remainingWorkPages(run);
  const [open, setOpen] = useState(defaultOpen);

  if (!hasRemainingWork(run)) return null;

  const summary = [
    doclingLeft > 0 ? `${doclingLeft.toLocaleString()} Docling` : null,
    visionFailed > 0 ? `${visionFailed.toLocaleString()} vision` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50/80 text-xs text-red-950">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <span className="font-semibold text-red-900">Remaining work</span>
          {leftover > 0 ? (
            <span className="ml-1.5 font-normal text-red-800/80">
              {leftover.toLocaleString()} page{leftover === 1 ? "" : "s"}
              {summary ? ` · ${summary}` : ""}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 font-medium text-red-800">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-red-200 px-3 py-2 text-red-900/90">
          <ul className="space-y-1">
            {doclingLeft > 0 ? (
              <li className="flex items-baseline justify-between gap-3">
                <span>Docling not cached — retry will resend</span>
                <span className="shrink-0 tabular-nums font-medium">
                  {doclingLeft.toLocaleString()} pages
                </span>
              </li>
            ) : null}
            {visionFailed > 0 ? (
              <li className="flex items-baseline justify-between gap-3">
                <span>Vision not done</span>
                <span className="shrink-0 tabular-nums font-medium">
                  {visionFailed.toLocaleString()} pages
                </span>
              </li>
            ) : null}
          </ul>
          {groups.length > 0 ? (
            <ul className="space-y-0.5 border-t border-red-200/80 pt-2">
              {groups.map((group) => (
                <li
                  key={group.kind}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3"
                >
                  <span className="min-w-0 truncate">{group.label}</span>
                  <span className="tabular-nums">
                    {group.pages.toLocaleString()} pp
                  </span>
                  <span className="tabular-nums text-red-800/70">
                    {group.docs.toLocaleString()} doc
                    {group.docs === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {run.lastError ? (
            <p className="break-words">{run.lastError}</p>
          ) : null}
          <div className="space-y-1 text-red-800/90">
            <GeminiAdvice run={run} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

type TargetSummary = {
  textRouteDocs: number;
  textRoutePages: number;
  cachedDoclingPages: number;
  uncachedDoclingPages: number;
  pendingDoclingDocs: number;
  doneDoclingDocs: number;
  totalVisionDocs: number;
  totalVisionPages: number;
  doneVisionPages: number;
  pendingVisionDocs: number;
  pendingVisionPages: number;
  queuedVisionPages: number;
  failedVisionPages: number;
  sidecarOk: boolean;
  sidecarUrl: string;
  sidecarDetail: string | null;
  ibmOk: boolean;
  ibmConfigured: boolean;
  ibmUrl: string | null;
  ibmDetail: string | null;
};

function BackendWarning({
  targetSummary,
  needsDocling,
  doclingProvider,
}: {
  targetSummary: TargetSummary;
  needsDocling: boolean;
  doclingProvider: DoclingProvider;
}) {
  if (!needsDocling) return null;

  if (doclingProvider === "ibm") {
    if (targetSummary.ibmOk) return null;
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        IBM Docling{" "}
        {targetSummary.ibmConfigured
          ? `not reachable${targetSummary.ibmUrl ? ` at ${targetSummary.ibmUrl}` : ""}`
          : "not configured — set DOCLING_IBM_URL and DOCLING_IBM_API_KEY (_2 _3 _4 for extra trials)"}
        {targetSummary.ibmDetail ? ` (${targetSummary.ibmDetail})` : ""}
      </p>
    );
  }

  if (targetSummary.sidecarOk) return null;
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      Sidecar not reachable at {targetSummary.sidecarUrl} — run{" "}
      <code>npm run docling:sidecar</code>
      {targetSummary.sidecarDetail ? ` (${targetSummary.sidecarDetail})` : ""}
    </p>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatWhenRange(startedAt: string, finishedAt: string | null): string {
  const start = formatWhen(startedAt);
  if (!finishedAt) return start;
  const startDate = new Date(startedAt);
  const endDate = new Date(finishedAt);
  if (
    !Number.isNaN(startDate.getTime()) &&
    !Number.isNaN(endDate.getTime()) &&
    startDate.toDateString() === endDate.toDateString()
  ) {
    return `${start} → ${formatTime(finishedAt)}`;
  }
  return `${start} → ${formatWhen(finishedAt)}`;
}

type ModalTab = "run" | "history";

function normalizeRun(run: DoclingBackfillRun): DoclingBackfillRun {
  return {
    ...run,
    mode: run.mode ?? "docling_only",
    phase: run.phase ?? null,
    totalDoclingPages: run.totalDoclingPages ?? 0,
    totalVisionPages: run.totalVisionPages ?? 0,
    completedDoclingPages: run.completedDoclingPages ?? 0,
    completedVisionPages: run.completedVisionPages ?? 0,
    completedPages: Math.max(
      run.completedPages ?? 0,
      (run.completedDoclingPages ?? 0) + (run.completedVisionPages ?? 0),
    ),
    corpusPendingVisionPages: run.corpusPendingVisionPages ?? 0,
    corpusPendingVisionDocs: run.corpusPendingVisionDocs ?? 0,
    doclingProvider: run.doclingProvider ?? "sidecar",
    doclingCostUsd: run.doclingCostUsd ?? 0,
    visionCostUsd: run.visionCostUsd ?? 0,
    plannedHashes: run.plannedHashes,
    errorGroups: run.errorGroups ?? [],
    visionErrors: run.visionErrors ?? [],
    stintStartedAt: run.stintStartedAt ?? null,
    completedPagesAtStintStart: run.completedPagesAtStintStart ?? 0,
    activeElapsedMs: run.activeElapsedMs ?? 0,
  };
}

function describeLiveConnectionIssue(options: {
  workerAlive?: boolean;
  pollFailed: boolean;
}): string | null {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You are offline. This page still loads from your computer, but IBM watsonx and Gemini need internet. In-flight requests will fail — reconnect, then resume if the run stopped.";
  }
  if (options.pollFailed) {
    return "Lost connection to this app. The run may still be going on the server — reconnect and refresh.";
  }
  if (options.workerAlive === false) {
    return "The extraction worker is not running on the server (process restarted or crashed). Resume to continue.";
  }
  return null;
}

function corpusPagesForRun(run: DoclingBackfillRun): number {
  const mode = run.mode ?? "docling_only";
  const docling = run.corpusUncachedPages ?? 0;
  const vision = run.corpusPendingVisionPages ?? 0;
  if (mode === "vision_only") return vision;
  if (mode === "docling_only") return docling;
  return docling + vision;
}

export function DoclingBackfillButton() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ModalTab>("run");
  const [ibmKeysOpen, setIbmKeysOpen] = useState(false);
  const [mode, setMode] = useState<ExtractionMode>("full");
  const [doclingProvider, setDoclingProvider] =
    useState<DoclingProvider>(DEFAULT_DOCLING_PROVIDER);
  const [docLimitMode, setDocLimitMode] = useState<
    "10" | "50" | "all" | "custom"
  >("10");
  const [customLimit, setCustomLimit] = useState("10");
  const [runs, setRuns] = useState<DoclingBackfillRun[]>([]);
  const [activeRun, setActiveRun] = useState<DoclingBackfillRun | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetSummary, setTargetSummary] = useState<TargetSummary | null>(
    null,
  );
  const [ibmSpend, setIbmSpend] = useState<IbmDoclingSpendSummary | null>(null);
  const [connectionIssue, setConnectionIssue] = useState<string | null>(null);
  const [progressStallAt, setProgressStallAt] = useState<number | null>(null);

  const activeRunIdRef = useRef<string | null>(null);
  const activeRunRef = useRef<DoclingBackfillRun | null>(null);
  const [timingTick, setTimingTick] = useState(0);

  const busy = activeRun?.status === "running" || starting;
  const needsDocling = mode === "full" || mode === "docling_only";
  activeRunRef.current = activeRun;

  function applyRunSnapshot(run: DoclingBackfillRun) {
    const normalized = normalizeRun(run);
    setActiveRun(normalized);
    if (normalized.status === "running") {
      activeRunIdRef.current = normalized.id;
    } else if (activeRunIdRef.current === normalized.id) {
      activeRunIdRef.current = null;
    }
    setRuns((prev) => {
      const next = prev.filter((r) => r.id !== normalized.id);
      return [normalized, ...next];
    });
  }

  async function loadRuns() {
    setLoadingHistory(true);
    try {
      const response = await fetch("/api/analysis/docling-backfill/runs?limit=30");
      const data = (await response.json()) as {
        runs?: DoclingBackfillRun[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not load run history.");
      }
      const list = (data.runs ?? []).map(normalizeRun);
      setRuns(list);

      const running = list.find((r) => r.status === "running");
      if (running) {
        setActiveRun(running);
        activeRunIdRef.current = running.id;
      } else {
        const trackedId = activeRunIdRef.current;
        if (trackedId) {
          const tracked = list.find((r) => r.id === trackedId);
          if (tracked) {
            setActiveRun(tracked);
            activeRunIdRef.current = null;
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load runs.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadTargetSummary() {
    try {
      const response = await fetch("/api/analysis/docling-backfill/targets");
      const data = (await response.json()) as {
        textRouteDocs?: number;
        textRoutePages?: number;
        cachedDoclingPages?: number;
        uncachedDoclingPages?: number;
        pendingDoclingDocs?: number;
        doneDoclingDocs?: number;
        totalVisionDocs?: number;
        totalVisionPages?: number;
        doneVisionPages?: number;
        pendingVisionDocs?: number;
        pendingVisionPages?: number;
        queuedVisionPages?: number;
        failedVisionPages?: number;
        sidecar?: { ok?: boolean; url?: string; detail?: string | null };
        ibm?: {
          ok?: boolean;
          configured?: boolean;
          url?: string | null;
          detail?: string | null;
        };
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not load extraction targets.");
      }
      setTargetSummary({
        textRouteDocs: data.textRouteDocs ?? 0,
        textRoutePages: data.textRoutePages ?? 0,
        cachedDoclingPages: data.cachedDoclingPages ?? 0,
        uncachedDoclingPages: data.uncachedDoclingPages ?? 0,
        pendingDoclingDocs: data.pendingDoclingDocs ?? 0,
        doneDoclingDocs: data.doneDoclingDocs ?? 0,
        totalVisionDocs: data.totalVisionDocs ?? 0,
        totalVisionPages: data.totalVisionPages ?? 0,
        doneVisionPages: data.doneVisionPages ?? 0,
        pendingVisionDocs: data.pendingVisionDocs ?? 0,
        pendingVisionPages: data.pendingVisionPages ?? 0,
        queuedVisionPages: data.queuedVisionPages ?? 0,
        failedVisionPages: data.failedVisionPages ?? 0,
        sidecarOk: Boolean(data.sidecar?.ok),
        sidecarUrl: data.sidecar?.url ?? "http://127.0.0.1:5001",
        sidecarDetail: data.sidecar?.detail ?? null,
        ibmOk: Boolean(data.ibm?.ok),
        ibmConfigured: Boolean(data.ibm?.configured),
        ibmUrl: data.ibm?.url ?? null,
        ibmDetail: data.ibm?.detail ?? null,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load extraction targets.",
      );
    }
  }

  async function loadIbmSpend() {
    try {
      const response = await fetch("/api/analysis/docling-backfill/ibm-spend");
      const data = (await response.json()) as IbmDoclingSpendSummary & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not load IBM spend.");
      }
      setIbmSpend(data);
    } catch {
      // Spend panel is optional; run history still works.
    }
  }

  useEffect(() => {
    void loadRuns();
    void loadIbmSpend();
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadRuns();
    void loadTargetSummary();
    void loadIbmSpend();
    if (activeRunRef.current?.status === "running") setTab("run");
  }, [open]);

  useEffect(() => {
    const runId =
      activeRun?.status === "running" ? activeRun.id : activeRunIdRef.current;
    if (!runId) return;

    let cancelled = false;
    let spendTick = 0;
    let inFlight = false;

    async function pollActiveRun() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(
          `/api/analysis/docling-backfill/runs/${runId}?poll=1`,
        );
        const data = (await response.json()) as {
          run?: DoclingBackfillRun;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !data.run) {
          setConnectionIssue(
            describeLiveConnectionIssue({ pollFailed: true }),
          );
          return;
        }
        const prev = activeRunRef.current;
        const same = prev?.id === data.run.id;
        applyRunSnapshot({
          ...data.run,
          plannedHashes:
            data.run.plannedHashes && data.run.plannedHashes.length > 0
              ? data.run.plannedHashes
              : same
                ? prev?.plannedHashes
                : data.run.plannedHashes,
          visionErrors:
            data.run.visionErrors && data.run.visionErrors.length > 0
              ? data.run.visionErrors
              : same
                ? prev?.visionErrors
                : data.run.visionErrors,
          errorGroups: Array.isArray(data.run.errorGroups)
            ? data.run.errorGroups
            : same
              ? prev?.errorGroups
              : data.run.errorGroups,
        });
        setConnectionIssue(
          describeLiveConnectionIssue({
            workerAlive: data.run.workerAlive,
            pollFailed: false,
          }),
        );
        if (open) {
          spendTick += 1;
          if (spendTick === 1 || spendTick % 2 === 0) {
            void loadIbmSpend();
          }
        }
      } catch {
        if (cancelled) return;
        setConnectionIssue(
          describeLiveConnectionIssue({ pollFailed: true }),
        );
      } finally {
        inFlight = false;
      }
    }

    void pollActiveRun();
    const timer = window.setInterval(() => {
      void pollActiveRun();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRun?.id, activeRun?.status, open]);

  useEffect(() => {
    if (
      activeRun?.status === "completed" ||
      activeRun?.status === "failed" ||
      activeRun?.status === "cancelled"
    ) {
      void loadIbmSpend();
      void loadTargetSummary();
    }
  }, [activeRun?.id, activeRun?.status, activeRun?.completedDoclingPages]);

  useEffect(() => {
    if (activeRun?.status !== "running") return;
    const timer = window.setInterval(() => {
      setTimingTick((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeRun?.id, activeRun?.status]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    function onOffline() {
      setConnectionIssue(
        describeLiveConnectionIssue({ pollFailed: false }),
      );
    }
    function onOnline() {
      setConnectionIssue((current) =>
        current?.startsWith("You are offline") ? null : current,
      );
    }
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (navigator.onLine === false) onOffline();
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    if (activeRun?.status !== "running") {
      setProgressStallAt(null);
      return;
    }
    setProgressStallAt(Date.now());
  }, [
    activeRun?.id,
    activeRun?.status,
    activeRun?.currentDocIndex,
    activeRun?.completedDocs,
    activeRun?.completedDoclingPages,
    activeRun?.completedVisionPages,
  ]);

  const live = activeRun?.status === "running" ? activeRun : null;
  const finishedSummary =
    activeRun &&
    (activeRun.status === "completed" ||
      activeRun.status === "failed" ||
      activeRun.status === "cancelled")
      ? activeRun
      : null;

  const timingSnapshot = useMemo(() => {
    void timingTick;
    if (!activeRun) return null;
    const snap = getDoclingBackfillTimingSnapshot(activeRun);
    const corpusUncachedPages = corpusPagesForRun(activeRun);
    const rate = snap.isRunning
      ? {
          ...estimateDoclingBackfillRate({
            stintMs: snap.stintMs,
            stintPages: snap.stintPages,
            totalPages: activeRun.totalPages,
            completedPages: activeRun.completedPages,
            corpusUncachedPages,
          }),
          activeMs: snap.activeMs,
        }
      : estimateDoclingBackfillRateForRun({
          ...activeRun,
          corpusUncachedPages,
        });
    return { ...snap, rate };
  }, [activeRun, timingTick]);

  const stallMs =
    live && progressStallAt ? Math.max(0, Date.now() - progressStallAt) : 0;
  const stalledWaiting =
    Boolean(live) && live?.workerAlive !== false && stallMs >= 90_000;

  function runStats(run: DoclingBackfillRun) {
    return estimateDoclingBackfillRateForRun({
      ...run,
      corpusUncachedPages: corpusPagesForRun(run),
    });
  }

  function resolveDocLimit(): { all: boolean; docLimit?: number } {
    if (docLimitMode === "all") return { all: true };
    if (docLimitMode === "10") return { all: false, docLimit: 10 };
    if (docLimitMode === "50") return { all: false, docLimit: 50 };
    const n = Number(customLimit);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error("Custom document limit must be a positive integer.");
    }
    return { all: false, docLimit: Math.floor(n) };
  }

  function canResumeRun(run: DoclingBackfillRun): boolean {
    if (run.completedDocs >= run.totalDocs) return false;
    if (run.status === "running") return run.workerAlive === false;
    return true;
  }

  function canRetryRemaining(run: DoclingBackfillRun): boolean {
    if (run.status === "running") return false;
    return failedVisionPages(run) > 0 || incompleteDoclingPages(run) > 0;
  }

  async function startBackfill() {
    if (busy) return;
    setError(null);
    setStarting(true);
    try {
      const limit = resolveDocLimit();
      const response = await fetch("/api/analysis/docling-backfill/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...limit, mode, doclingProvider }),
      });
      const data = (await response.json()) as {
        run?: DoclingBackfillRun;
        error?: string;
      };
      if (!response.ok || !data.run) {
        throw new Error(data.error || "Could not start extraction backfill.");
      }
      applyRunSnapshot(data.run);
      setTab("run");
      await loadTargetSummary();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not start extraction backfill.",
      );
    } finally {
      setStarting(false);
    }
  }

  async function cancelRun() {
    const runId = activeRun?.id ?? activeRunIdRef.current;
    if (!runId) return;
    try {
      const response = await fetch(
        `/api/analysis/docling-backfill/runs/${runId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "cancelled",
            lastError: "Cancelled by user.",
          }),
        },
      );
      const data = (await response.json()) as {
        run?: DoclingBackfillRun;
        error?: string;
      };
      if (!response.ok || !data.run) {
        throw new Error(data.error || "Could not stop run.");
      }
      applyRunSnapshot(data.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop run.");
    }
  }

  async function resumeRun(run: DoclingBackfillRun) {
    if (busy) return;
    setError(null);
    setStarting(true);
    try {
      const response = await fetch(
        `/api/analysis/docling-backfill/runs/${run.id}/resume`,
        { method: "POST" },
      );
      const data = (await response.json()) as {
        run?: DoclingBackfillRun;
        error?: string;
      };
      if (!response.ok || !data.run) {
        throw new Error(data.error || "Could not resume run.");
      }
      applyRunSnapshot(data.run);
      setTab("run");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resume run.");
    } finally {
      setStarting(false);
    }
  }

  async function retryRemaining(run: DoclingBackfillRun) {
    if (busy) return;
    setError(null);
    setStarting(true);
    try {
      const retryMode = run.mode ?? mode;
      const retryProvider = run.doclingProvider ?? doclingProvider;
      const response = await fetch("/api/analysis/docling-backfill/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          all: true,
          mode: retryMode,
          doclingProvider: retryProvider,
        }),
      });
      const data = (await response.json()) as {
        run?: DoclingBackfillRun;
        error?: string;
      };
      if (!response.ok || !data.run) {
        throw new Error(data.error || "Could not retry remaining pages.");
      }
      applyRunSnapshot(data.run);
      setTab("run");
      await loadTargetSummary();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not retry remaining pages.",
      );
    } finally {
      setStarting(false);
    }
  }

  function closeModal() {
    setOpen(false);
  }

  const doclingBackendReady =
    !needsDocling ||
    (doclingProvider === "ibm"
      ? Boolean(targetSummary?.ibmOk)
      : Boolean(targetSummary?.sidecarOk));

  const canStart =
    !busy &&
    (targetSummary == null || doclingBackendReady) &&
    (targetSummary == null ||
      (mode === "docling_only"
        ? targetSummary.uncachedDoclingPages > 0
        : mode === "vision_only"
          ? targetSummary.pendingVisionPages > 0
          : targetSummary.uncachedDoclingPages > 0 ||
            targetSummary.pendingVisionPages > 0));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
      >
        Extraction backfill
        {activeRun?.status === "running" ? (
          <span className="ml-2 inline-flex rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
            Live
          </span>
        ) : ibmSpend && ibmSpend.billedPages > 0 ? (
          <span className="ml-2 text-xs font-normal text-slate-500">
            {formatCostUsd(ibmSpend.billedUsd)} IBM
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) closeModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Extraction backfill"
            className="flex min-h-0 max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-3 pt-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Extraction backfill
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Docling for text pages · Gemini for vision
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div
              className="flex shrink-0 gap-1 border-b border-slate-200 px-6"
              role="tablist"
              aria-label="Extraction backfill sections"
            >
              <button
                type="button"
                role="tab"
                id="backfill-tab-run"
                aria-controls="backfill-panel-run"
                aria-selected={tab === "run"}
                className={`border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  tab === "run"
                    ? "border-teal-700 text-teal-800"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
                onClick={() => setTab("run")}
              >
                Run
                {live ? (
                  <span className="ml-1.5 inline-flex rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                    Live
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                role="tab"
                id="backfill-tab-history"
                aria-controls="backfill-panel-history"
                aria-selected={tab === "history"}
                className={`border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  tab === "history"
                    ? "border-teal-700 text-teal-800"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
                onClick={() => setTab("history")}
              >
                History
                {runs.length > 0 ? (
                  <span className="ml-1.5 text-xs font-medium text-slate-500">
                    {runs.length}
                  </span>
                ) : null}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {error ? (
                <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              ) : null}
              {tab === "run" ? (
                <div
                  id="backfill-panel-run"
                  role="tabpanel"
                  aria-labelledby="backfill-tab-run"
                  className="space-y-4"
                >
                  {live ? null : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm">
                          <span className="mb-1.5 block font-medium text-slate-700">
                            Mode
                          </span>
                          <select
                            value={mode}
                            disabled={busy}
                            onChange={(event) =>
                              setMode(event.target.value as ExtractionMode)
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
                          >
                            <option value="full">
                              Full extraction (Docling + vision)
                            </option>
                            <option value="docling_only">
                              Docling only (text pages)
                            </option>
                            <option value="vision_only">
                              Vision only (non-text pages)
                            </option>
                          </select>
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1.5 block font-medium text-slate-700">
                            Documents this run
                          </span>
                          <select
                            value={docLimitMode}
                            disabled={busy}
                            onChange={(event) =>
                              setDocLimitMode(
                                event.target.value as typeof docLimitMode,
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
                          >
                            <option value="10">
                              10 documents (avg sample)
                            </option>
                            <option value="50">
                              50 documents (avg sample)
                            </option>
                            <option value="custom">Custom limit…</option>
                            <option value="all">Entire pending corpus</option>
                          </select>
                        </label>
                        {needsDocling ? (
                          <label className="block text-sm sm:col-span-2">
                            <span className="mb-1.5 block font-medium text-slate-700">
                              Docling backend
                            </span>
                            <select
                              value={doclingProvider}
                              disabled={busy}
                              onChange={(event) =>
                                setDoclingProvider(
                                  event.target.value as DoclingProvider,
                                )
                              }
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
                            >
                              <option value="ibm">
                                IBM watsonx Docling API ($0.004/page)
                              </option>
                              <option value="sidecar">
                                Local sidecar (CPU, npm run docling:sidecar)
                              </option>
                            </select>
                          </label>
                        ) : null}
                      </div>
                      {docLimitMode === "custom" ? (
                        <label className="block text-sm">
                          <span className="mb-1.5 block font-medium text-slate-700">
                            Custom document count
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={10000}
                            value={customLimit}
                            disabled={busy}
                            onChange={(event) =>
                              setCustomLimit(event.target.value)
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
                          />
                        </label>
                      ) : null}
                    </>
                  )}

                  {targetSummary ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          Text (Docling)
                        </p>
                        <dl className="mt-1 space-y-0.5 text-sm">
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Total</dt>
                            <dd className="tabular-nums font-medium text-slate-900">
                              {targetSummary.textRoutePages.toLocaleString()}{" "}
                              pages
                              <span className="ml-1 font-normal text-slate-500">
                                · {targetSummary.textRouteDocs.toLocaleString()}{" "}
                                docs
                              </span>
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Done</dt>
                            <dd className="tabular-nums font-medium text-slate-900">
                              {targetSummary.cachedDoclingPages.toLocaleString()}
                              <span className="ml-1 font-normal text-slate-500">
                                · {targetSummary.doneDoclingDocs.toLocaleString()}{" "}
                                docs
                              </span>
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Pending</dt>
                            <dd className="tabular-nums font-semibold text-slate-900">
                              {targetSummary.uncachedDoclingPages.toLocaleString()}
                              <span className="ml-1 font-normal text-slate-500">
                                · {targetSummary.pendingDoclingDocs.toLocaleString()}{" "}
                                docs
                              </span>
                            </dd>
                          </div>
                        </dl>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          Vision (Gemini)
                        </p>
                        <dl className="mt-1 space-y-0.5 text-sm">
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Total</dt>
                            <dd className="tabular-nums font-medium text-slate-900">
                              {targetSummary.totalVisionPages.toLocaleString()}{" "}
                              pages
                              <span className="ml-1 font-normal text-slate-500">
                                · {targetSummary.totalVisionDocs.toLocaleString()}{" "}
                                docs
                              </span>
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Done</dt>
                            <dd className="tabular-nums font-medium text-slate-900">
                              {targetSummary.doneVisionPages.toLocaleString()}
                            </dd>
                          </div>
                          <div>
                            <div className="flex justify-between gap-3">
                              <dt className="text-slate-500">Remaining</dt>
                              <dd className="tabular-nums font-semibold text-slate-900">
                                {targetSummary.pendingVisionPages.toLocaleString()}
                                {targetSummary.failedVisionPages === 0 ? (
                                  <span className="ml-1 font-normal text-slate-500">
                                    · {targetSummary.pendingVisionDocs.toLocaleString()}{" "}
                                    docs
                                  </span>
                                ) : null}
                              </dd>
                            </div>
                            {targetSummary.failedVisionPages > 0 ? (
                              <p className="text-right text-xs text-slate-500">
                                {targetSummary.queuedVisionPages.toLocaleString()}{" "}
                                pending ·{" "}
                                {targetSummary.failedVisionPages.toLocaleString()}{" "}
                                failed
                              </p>
                            ) : null}
                          </div>
                        </dl>
                      </div>
                    </div>
                  ) : null}

                  {targetSummary ? (
                    <BackendWarning
                      targetSummary={targetSummary}
                      needsDocling={needsDocling}
                      doclingProvider={doclingProvider}
                    />
                  ) : null}

                  {live ? (
                    <div
                      className={`rounded-xl border px-4 py-3 text-sm ${runCardClass(live)}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">
                          Running {modeLabel(live.mode)}
                          <span className="ml-2 rounded-md bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                            Server
                          </span>
                          {live.mode !== "vision_only" ? (
                            <span className="ml-2 rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                              {providerLabel(live.doclingProvider)}
                            </span>
                          ) : null}
                          {live.phase ? (
                            <span className="ml-2 rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                              {live.phase}
                            </span>
                          ) : null}
                        </p>
                        <p className="font-semibold tabular-nums">
                          {live.doclingProvider === "ibm"
                            ? `${formatCostUsd(live.doclingCostUsd ?? 0)} IBM · `
                            : ""}
                          {formatCostUsd(live.visionCostUsd ?? 0)} vision
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-amber-800/90">
                        Safe to hide — the server keeps going.
                      </p>
                      {connectionIssue ? (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-950">
                          <p className="font-semibold text-red-900">
                            Disconnected
                          </p>
                          <p className="mt-0.5">{connectionIssue}</p>
                          {live.workerAlive === false ? (
                            <button
                              type="button"
                              disabled={starting}
                              onClick={() => void resumeRun(live)}
                              className="mt-2 rounded-md bg-red-800 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-900 disabled:opacity-60"
                            >
                              Restart worker
                            </button>
                          ) : null}
                        </div>
                      ) : stalledWaiting ? (
                        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-100/80 px-3 py-2 text-xs text-amber-950">
                          No document finished for{" "}
                          {formatDoclingBackfillDuration(stallMs)} — waiting on
                          IBM watsonx or Gemini.
                        </p>
                      ) : null}
                      <p className="mt-2 text-sm">
                        Doc {live.currentDocIndex || "—"} / {live.totalDocs}
                        {live.currentLabel ? ` · ${live.currentLabel}` : ""}
                        {live.currentPagesInDoc != null
                          ? ` · ${live.currentPagesInDoc} pages`
                          : ""}
                      </p>
                      <div className="mt-3">
                        <RunCounts run={live} />
                      </div>
                      {timingSnapshot ? (
                        <dl className="mt-3 grid gap-2 border-t border-current/10 pt-3 text-xs sm:grid-cols-2">
                          <div>
                            <dt className="font-medium">Active time</dt>
                            <dd className="tabular-nums">
                              {formatDoclingBackfillDuration(
                                timingSnapshot.activeMs,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium">This stint</dt>
                            <dd className="tabular-nums">
                              {timingSnapshot.isRunning
                                ? `${formatDoclingBackfillDuration(timingSnapshot.stintMs)} · ${timingSnapshot.stintPages.toLocaleString()} page${timingSnapshot.stintPages === 1 ? "" : "s"}`
                                : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium">Rate</dt>
                            <dd className="tabular-nums">
                              {formatDoclingBackfillRate(
                                timingSnapshot.rate.pagesPerMinute,
                              )}
                              {timingSnapshot.rate.secondsPerPage > 0
                                ? ` (${timingSnapshot.rate.secondsPerPage.toFixed(1)}s/page)`
                                : ""}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium">ETA this run</dt>
                            <dd className="tabular-nums">
                              {timingSnapshot.stintPages > 0
                                ? formatDoclingBackfillEta(
                                    timingSnapshot.rate.runEtaMs,
                                  )
                                : "after first page"}
                            </dd>
                          </div>
                          {timingSnapshot.stintPages > 0 ? (
                            <div className="sm:col-span-2">
                              <dt className="font-medium">Corpus ETA</dt>
                              <dd className="tabular-nums">
                                {formatDoclingBackfillEta(
                                  timingSnapshot.rate.corpusEtaMs,
                                )}{" "}
                                at this stint rate
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      ) : null}
                      <div className="mt-3">
                        <BackfillRemainingWork run={live} defaultOpen />
                      </div>
                    </div>
                  ) : null}

                  {finishedSummary && timingSnapshot ? (
                    <div
                      className={`rounded-xl border px-4 py-3 text-sm ${runCardClass(finishedSummary)}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">
                          {runStatusLabel(finishedSummary)}
                          <span className="ml-2 font-normal text-current/70">
                            {modeLabel(finishedSummary.mode)}
                            {finishedSummary.mode !== "vision_only"
                              ? ` · ${providerLabel(finishedSummary.doclingProvider)}`
                              : ""}
                          </span>
                        </p>
                        <p className="font-semibold tabular-nums">
                          {finishedSummary.doclingProvider === "ibm"
                            ? `${formatCostUsd(finishedSummary.doclingCostUsd ?? 0)} IBM · `
                            : ""}
                          {formatCostUsd(finishedSummary.visionCostUsd ?? 0)}{" "}
                          vision
                        </p>
                      </div>
                      <div className="mt-3">
                        <RunCounts run={finishedSummary} />
                      </div>
                      <dl className="mt-3 grid gap-2 border-t border-current/10 pt-3 text-xs sm:grid-cols-2">
                        <div>
                          <dt className="font-medium">Active time</dt>
                          <dd className="tabular-nums">
                            {formatDoclingBackfillDuration(
                              timingSnapshot.rate.activeMs,
                            )}
                          </dd>
                        </div>
                        {timingSnapshot.rate.pagesPerMinute > 0 ? (
                          <div>
                            <dt className="font-medium">Avg rate</dt>
                            <dd className="tabular-nums">
                              {formatDoclingBackfillRate(
                                timingSnapshot.rate.pagesPerMinute,
                              )}
                              {timingSnapshot.rate.secondsPerPage > 0
                                ? ` (${timingSnapshot.rate.secondsPerPage.toFixed(1)}s/page)`
                                : ""}
                            </dd>
                          </div>
                        ) : null}
                        {timingSnapshot.rate.pagesPerMinute > 0 ? (
                          <div className="sm:col-span-2">
                            <dt className="font-medium">Corpus ETA</dt>
                            <dd className="tabular-nums">
                              {formatDoclingBackfillEta(
                                timingSnapshot.rate.corpusEtaMs,
                              )}{" "}
                              at this sample rate
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      <div className="mt-3 space-y-2">
                        <BackfillRemainingWork
                          run={finishedSummary}
                          defaultOpen
                        />
                        {canRetryRemaining(finishedSummary) && !busy ? (
                          <button
                            type="button"
                            disabled={starting}
                            onClick={() => void retryRemaining(finishedSummary)}
                            className="w-full rounded-md bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
                          >
                            Retry remaining pages
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {!live &&
                  !finishedSummary &&
                  activeRun &&
                  timingSnapshot &&
                  canResumeRun(activeRun) ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                      <p className="font-semibold text-slate-900">Run paused</p>
                      <div className="mt-3">
                        <RunCounts
                          run={activeRun}
                          mutedClassName="text-slate-500"
                        />
                      </div>
                      {canResumeRun(activeRun) && !busy ? (
                        <button
                          type="button"
                          disabled={starting}
                          onClick={() => void resumeRun(activeRun)}
                          className="mt-3 w-full rounded-md bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
                        >
                          Resume from {activeRun.completedDocs}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {ibmSpend ? (
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
                        aria-expanded={ibmKeysOpen}
                        onClick={() => setIbmKeysOpen((value) => !value)}
                      >
                        <span>
                          <span className="font-medium text-slate-900">
                            IBM watsonx
                          </span>
                          <span className="ml-1.5 text-slate-500">
                            {formatCostUsd(ibmSpend.billedUsd)} billed ·{" "}
                            {ibmSpend.coverage.trialPagesRemaining.toLocaleString()}{" "}
                            trial pages left
                            {ibmSpend.activeSlot != null
                              ? ` · key ${ibmSpend.activeSlot} live`
                              : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-medium text-slate-600">
                          {ibmKeysOpen ? "Hide keys" : "Show keys"}
                        </span>
                      </button>
                      {ibmKeysOpen ? (
                        <div className="border-t border-slate-200 bg-slate-50 px-3 py-3">
                          <IbmDoclingSpendPanel
                            summary={ibmSpend}
                            embedded
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div
                  id="backfill-panel-history"
                  role="tabpanel"
                  aria-labelledby="backfill-tab-history"
                >
                  {loadingHistory ? (
                    <p className="mb-2 text-xs text-slate-500">Loading…</p>
                  ) : null}
                  {runs.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
                      No extraction backfill runs yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {runs.map((run) => {
                        const stats = runStats(run);
                        const corpusRemaining = Math.max(
                          0,
                          corpusPagesForRun(run) - run.completedPages,
                        );
                        return (
                          <li key={run.id} className="space-y-2 px-3 py-3 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${runStatusClass(run)}`}
                              >
                                {runStatusLabel(run)}
                              </span>
                              <span className="font-medium text-slate-900">
                                {modeLabel(run.mode)}
                              </span>
                              {run.mode !== "vision_only" ? (
                                <span className="text-slate-500">
                                  {providerLabel(run.doclingProvider)}
                                </span>
                              ) : null}
                              <span className="text-slate-500">
                                {run.docLimit == null
                                  ? "All pending"
                                  : `${run.docLimit} docs`}
                              </span>
                              <span className="ml-auto text-xs text-slate-500">
                                {formatWhenRange(run.startedAt, run.finishedAt)}
                              </span>
                            </div>
                            <RunCounts
                              run={run}
                              mutedClassName="text-slate-500"
                            />
                            {run.completedPages > 0 &&
                            stats.secondsPerPage > 0 ? (
                              <p className="text-xs tabular-nums text-slate-600">
                                Avg{" "}
                                <span className="font-medium text-slate-800">
                                  {formatDoclingBackfillRate(
                                    stats.pagesPerMinute,
                                  )}
                                </span>
                                {` (${stats.secondsPerPage.toFixed(1)}s/page)`}
                                {" · "}
                                {formatCostUsd(run.visionCostUsd ?? 0)} vision
                                {run.doclingProvider === "ibm"
                                  ? ` · ${formatCostUsd(run.doclingCostUsd ?? 0)} IBM`
                                  : ""}
                                {" · corpus ETA "}
                                <span className="font-medium text-slate-800">
                                  {formatDoclingBackfillEta(stats.corpusEtaMs)}
                                </span>
                                {` (${corpusRemaining.toLocaleString()} pages)`}
                              </p>
                            ) : null}
                            <BackfillRemainingWork run={run} defaultOpen={false} />
                            {canResumeRun(run) && !busy ? (
                              <button
                                type="button"
                                onClick={() => void resumeRun(run)}
                                className="w-full rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                              >
                                Resume from {run.completedDocs}
                              </button>
                            ) : canRetryRemaining(run) && !busy ? (
                              <button
                                type="button"
                                onClick={() => void retryRemaining(run)}
                                className="w-full rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                              >
                                Retry remaining
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-100 px-6 py-4">
              {busy ? (
                <>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Hide
                  </button>
                  <button
                    type="button"
                    onClick={() => void cancelRun()}
                    className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                  >
                    Stop run
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              )}
              <button
                type="button"
                disabled={!canStart}
                onClick={() => void startBackfill()}
                className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {starting
                  ? "Scanning & starting…"
                  : busy
                    ? "Running…"
                    : "Start extraction backfill"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
