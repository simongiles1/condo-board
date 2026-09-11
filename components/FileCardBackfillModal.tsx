"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { DeepSeekPricingTimeline } from "@/components/DeepSeekPricingTimeline";
import { EntityListPagination } from "@/components/EntityListPagination";
import { getDeepSeekPricingStatus } from "@/lib/deepseek/pricing";
import { emailMessageDetailHref } from "@/lib/email/thread-filter-params";
import { formatDateTime } from "@/lib/format/datetime";
import { FileCardPendingParseTooltip } from "@/components/FileCardPendingParseTooltip";
import type {
  FileCardCorpusSummary,
  FileCardCostContext,
  FileCardDisplayItem,
  FileCardRunRecord,
  FileCardRunScope,
  TargetEmailSearchItem,
} from "@/lib/rag/file-card-runs";

const QUALIFY_CARDS_PAGE_SIZE = 10;

function TargetEmailResultBadges({ item }: { item: TargetEmailSearchItem }) {
  const unparsedCount = Math.max(0, item.attachmentCount - item.parsedAttachmentCount);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span
        className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 ring-1 ring-slate-200"
        title="One synced Gmail message — not the whole thread"
      >
        Message
      </span>
      {item.attachmentCount === 0 ? (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 ring-1 ring-amber-200"
          title="File cards only run on parsed attachments; this message has none"
        >
          No attachments
        </span>
      ) : (
        <>
          <span
            className="inline-flex items-center gap-0.5 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-900 ring-1 ring-teal-200"
            title="Attachments on this message"
          >
            📎 {item.attachmentCount} attachment{item.attachmentCount === 1 ? "" : "s"}
          </span>
          {item.parsedAttachmentCount > 0 ? (
            <span
              className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900 ring-1 ring-emerald-200"
              title="Attachments with completed text extraction"
            >
              {item.parsedAttachmentCount} parsed
            </span>
          ) : null}
          {unparsedCount > 0 ? (
            <span
              className="inline-flex items-center rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200"
              title="Attachments not yet extracted — excluded from file-card runs until parsed"
            >
              {unparsedCount} not parsed
            </span>
          ) : null}
          {item.cardableAttachmentCount > 0 ? (
            <span
              className="inline-flex items-center rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-900 ring-1 ring-violet-200"
              title="Unique parsed files that would be summarized when you target this message (one card per file)"
            >
              {item.cardableAttachmentCount} file-card{item.cardableAttachmentCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

export function FileCardBackfillButton() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"run" | "qualify" | "history">("run");
  const [activeRun, setActiveRun] = useState<FileCardRunRecord | null>(null);
  const [recentRuns, setRecentRuns] = useState<FileCardRunRecord[]>([]);

  // Config state
  const [scope, setScope] = useState<FileCardRunScope>("test");
  const [testLimit, setTestLimit] = useState(5);
  const [forceOverwrite, setForceOverwrite] = useState(false);

  // Email targeting search
  const [emailQuery, setEmailQuery] = useState("");
  const [emailSearchResults, setEmailSearchResults] = useState<TargetEmailSearchItem[]>([]);
  const [selectedEmailIds, setSelectedEmailIds] = useState<string[]>([]);
  const [pastedEmailIds, setPastedEmailIds] = useState("");

  // Cost context
  const [costContext, setCostContext] = useState<FileCardCostContext | null>(null);
  const [corpusCostContext, setCorpusCostContext] = useState<FileCardCostContext | null>(
    null,
  );
  const [corpusTargetCount, setCorpusTargetCount] = useState<number>(0);
  const [corpusSummary, setCorpusSummary] = useState<FileCardCorpusSummary | null>(
    null,
  );
  const [targetCount, setTargetCount] = useState<number>(0);
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState<string | null>(null);

  // Qualify state
  const [cards, setCards] = useState<FileCardDisplayItem[]>([]);
  const [cardsTotal, setCardsTotal] = useState(0);
  const [cardsPage, setCardsPage] = useState(1);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsRunFilter, setCardsRunFilter] = useState<string>("");
  const [expandedHashes, setExpandedHashes] = useState<Set<string>>(new Set());

  // Action states
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pricingStatus = getDeepSeekPricingStatus(Date.now());

  // Load runs list
  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis/file-cards/runs?limit=20");
      if (!res.ok) return;
      const data = await res.json();
      const runs: FileCardRunRecord[] = data.runs ?? [];
      setRecentRuns(runs);
      const running = runs.find((r) => r.status === "running");
      if (running) {
        setActiveRun(running);
      }
    } catch {
      // ignore
    }
  }, []);

  // Load cards for qualify
  const loadCards = useCallback(async (runId?: string, page = 1) => {
    setCardsLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(QUALIFY_CARDS_PAGE_SIZE),
        offset: String((page - 1) * QUALIFY_CARDS_PAGE_SIZE),
      });
      if (runId) params.set("runId", runId);
      const res = await fetch(`/api/analysis/file-cards/cards?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setCards(data.cards ?? []);
      setCardsTotal(typeof data.total === "number" ? data.total : 0);
    } catch {
      // ignore
    } finally {
      setCardsLoading(false);
    }
  }, []);

  // Debounced search for email targeting
  useEffect(() => {
    if (scope !== "target_emails" || !emailQuery.trim()) {
      setEmailSearchResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/analysis/file-cards/search?q=${encodeURIComponent(emailQuery.trim())}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        setEmailSearchResults(data.results ?? []);
      } catch {
        // ignore
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [emailQuery, scope]);

  // Combined email IDs from selection and paste
  const resolvedTargetEmailIds = [
    ...new Set([
      ...selectedEmailIds,
      ...pastedEmailIds
        .split(/[\s,;]+/g)
        .map((s) => s.trim())
        .filter(Boolean),
    ]),
  ];

  // Refresh cost context whenever configuration changes
  const fetchCostContext = useCallback(async (options?: { ignoreRunning?: boolean }) => {
    if (!options?.ignoreRunning && activeRun?.status === "running") return;
    setCostLoading(true);
    setCostError(null);
    try {
      const payload = {
        scope,
        docLimit: scope === "test" ? testLimit : null,
        emailIds: scope === "target_emails" ? resolvedTargetEmailIds : undefined,
        forceOverwrite,
      };
      const res = await fetch("/api/analysis/file-cards/cost-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Could not calculate cost context");
      }
      const data = await res.json();
      setCostContext(data.costContext ?? null);
      setCorpusCostContext(data.corpusCostContext ?? null);
      setCorpusTargetCount(data.corpusTargetCount ?? 0);
      setCorpusSummary(data.corpusSummary ?? null);
      setTargetCount(data.targetCount ?? 0);
    } catch (err) {
      setCostError(err instanceof Error ? err.message : String(err));
    } finally {
      setCostLoading(false);
    }
  }, [scope, testLimit, resolvedTargetEmailIds.join(","), forceOverwrite, activeRun?.status]);

  const pollActiveRun = useCallback(
    async (runId: string) => {
      try {
        const res = await fetch(`/api/analysis/file-cards/runs/${runId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.run) {
          setActiveRun((prev) => {
            if (prev?.status === "running" && data.run.status !== "running") {
              queueMicrotask(() => {
                void fetchCostContext({ ignoreRunning: true });
              });
            }
            return data.run;
          });
        }
      } catch {
        // ignore transient poll error
      }
    },
    [fetchCostContext],
  );

  useEffect(() => {
    if (open) {
      void loadRuns();
      void fetchCostContext();
      if (tab === "qualify") {
        void loadCards(cardsRunFilter || undefined, cardsPage);
      }
    }
  }, [open, tab, fetchCostContext, loadRuns, loadCards, cardsRunFilter, cardsPage]);

  useEffect(() => {
    if (!open || tab !== "qualify" || cardsLoading) return;
    const maxPage = Math.max(1, Math.ceil(cardsTotal / QUALIFY_CARDS_PAGE_SIZE));
    if (cardsPage > maxPage) setCardsPage(maxPage);
  }, [open, tab, cardsLoading, cardsPage, cardsTotal]);

  // Poll timer when run is active
  useEffect(() => {
    if (!open || !activeRun || activeRun.status !== "running") return;
    const interval = window.setInterval(() => {
      void pollActiveRun(activeRun.id);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [open, activeRun?.id, activeRun?.status, pollActiveRun]);

  async function handleStartRun() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        scope,
        docLimit: scope === "test" ? testLimit : null,
        emailIds: scope === "target_emails" ? resolvedTargetEmailIds : undefined,
        forceOverwrite,
      };
      const res = await fetch("/api/analysis/file-cards/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start file card run");
      }
      const data = await res.json();
      if (data.run) {
        setActiveRun(data.run);
        void loadRuns();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelRun() {
    if (!activeRun) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/analysis/file-cards/runs/${activeRun.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveRun(data.run ?? null);
        void loadRuns();
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  async function handleRateCard(contentHash: string, rating: "up" | "down" | null) {
    // Optimistic local update
    setCards((prev) =>
      prev.map((c) =>
        c.contentHash === contentHash ? { ...c, rating } : c,
      ),
    );
    try {
      await fetch("/api/analysis/file-cards/cards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentHash, rating }),
      });
    } catch {
      // ignore
    }
  }

  function toggleExpand(hash: string) {
    setExpandedHashes((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-900 shadow-xs hover:bg-teal-100"
      >
        File cards
        {activeRun?.status === "running" ? (
          <span className="ml-2 inline-flex rounded-md bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
            Live
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Attachment File Cards (DeepSeek)
                </h2>
                <p className="text-xs text-slate-500">
                  Generates document type classification and content summaries without rerunning extraction.
                </p>
                {corpusSummary ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-900 ring-1 ring-emerald-200"
                      title="Ready file cards stored for archive search and rerank"
                    >
                      {corpusSummary.readyCardCount.toLocaleString()} file card
                      {corpusSummary.readyCardCount === 1 ? "" : "s"} complete
                    </span>
                    {corpusSummary.parsedEligibleCount > 0 ? (
                      <span className="text-slate-500">
                        of {corpusSummary.parsedEligibleCount.toLocaleString()} parsed attachment
                        {corpusSummary.parsedEligibleCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    <FileCardPendingParseTooltip summary={corpusSummary} />
                    {costLoading ? (
                      <span className="text-[11px] text-slate-400">Refreshing…</span>
                    ) : null}
                  </div>
                ) : costLoading ? (
                  <p className="mt-2 text-[11px] text-slate-400">Loading corpus status…</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <nav className="flex rounded-lg bg-slate-100 p-1 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setTab("run")}
                    className={`rounded-md px-3 py-1 transition ${
                      tab === "run"
                        ? "bg-white font-semibold text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("qualify")}
                    className={`rounded-md px-3 py-1 transition ${
                      tab === "qualify"
                        ? "bg-white font-semibold text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Qualify cards
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("history")}
                    className={`rounded-md px-3 py-1 transition ${
                      tab === "history"
                        ? "bg-white font-semibold text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    History
                  </button>
                </nav>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {error ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {error}
                </div>
              ) : null}

              {tab === "run" ? (
                <div className="space-y-6">
                  {/* Active Run Card */}
                  {activeRun?.status === "running" ? (
                    <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-3 w-3">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
                          </span>
                          <span className="font-semibold text-amber-950">
                            Generating file cards in progress…
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleCancelRun}
                          disabled={busy}
                          className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                        >
                          Cancel run
                        </button>
                      </div>

                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-amber-900">
                          <span>
                            {activeRun.completedDocs + activeRun.failedDocs} / {activeRun.totalDocs} documents
                          </span>
                          <span>
                            Cost: ${activeRun.totalCostUsd.toFixed(4)} ({activeRun.totalInputTokens + activeRun.totalOutputTokens} tokens)
                          </span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-amber-200">
                          <div
                            className="h-full bg-amber-600 transition-all duration-300"
                            style={{
                              width: `${
                                activeRun.totalDocs > 0
                                  ? Math.min(
                                      100,
                                      Math.round(
                                        ((activeRun.completedDocs + activeRun.failedDocs) /
                                          activeRun.totalDocs) *
                                          100,
                                      ),
                                    )
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        {activeRun.currentLabel ? (
                          <p className="mt-1.5 truncate text-xs text-amber-800">
                            Current: {activeRun.currentLabel}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* Scope Selection */}
                  <div className="space-y-3">
                    <label className="block text-sm font-semibold text-slate-800">
                      Scope of attachments to process
                    </label>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => setScope("test")}
                        className={`rounded-xl border p-3.5 text-left transition ${
                          scope === "test"
                            ? "border-teal-600 bg-teal-50/50 ring-2 ring-teal-600/20"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="font-semibold text-slate-900">Test sample</div>
                        <div className="mt-1 text-xs text-slate-500">
                          Run on a small set of parsed attachments that lack cards.
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setScope("target_emails")}
                        className={`rounded-xl border p-3.5 text-left transition ${
                          scope === "target_emails"
                            ? "border-teal-600 bg-teal-50/50 ring-2 ring-teal-600/20"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="font-semibold text-slate-900">Target emails</div>
                        <div className="mt-1 text-xs text-slate-500">
                          Search or specify emails (e.g. Reserve Fund Study threads).
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setScope("pending_corpus")}
                        className={`rounded-xl border p-3.5 text-left transition ${
                          scope === "pending_corpus"
                            ? "border-teal-600 bg-teal-50/50 ring-2 ring-teal-600/20"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="font-semibold text-slate-900">Pending corpus</div>
                        <div className="mt-1 text-xs text-slate-500">
                          All parsed attachments with no card yet.
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Scope Options */}
                  {scope === "test" ? (
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-slate-700">
                        Documents limit:
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={testLimit}
                        onChange={(e) => setTestLimit(Math.max(1, Number(e.target.value) || 1))}
                        className="w-20 rounded-md border border-slate-300 px-2.5 py-1 text-sm text-slate-800"
                      />
                    </div>
                  ) : null}

                  {scope === "target_emails" ? (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-800">
                          Search emails by keyword (subject, filename, sender)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. reserve fund, Trace, Egis, RFS"
                          value={emailQuery}
                          onChange={(e) => setEmailQuery(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
                        />
                        <p className="text-[11px] leading-snug text-slate-500">
                          Each row is one synced message (Re:/Fw: are separate). Gmail threads with
                          seven messages may show fewer rows if only some were synced or only some
                          match your keywords. File cards run on parsed attachments, not the email
                          body alone.
                        </p>
                      </div>

                      {emailSearchResults.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white p-2">
                          <div className="space-y-1.5">
                            {emailSearchResults.map((item) => {
                              const isChecked = selectedEmailIds.includes(item.emailId);
                              return (
                                <label
                                  key={item.emailId}
                                  className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-slate-50"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedEmailIds((prev) => [...prev, item.emailId]);
                                      } else {
                                        setSelectedEmailIds((prev) =>
                                          prev.filter((id) => id !== item.emailId),
                                        );
                                      }
                                    }}
                                    className="mt-1"
                                  />
                                  <div className="min-w-0 flex-1 text-xs">
                                    <div className="font-medium text-slate-900">
                                      {item.subject}
                                    </div>
                                    <div className="text-slate-500">
                                      {item.receivedAt ? item.receivedAt.slice(0, 10) : ""}
                                      {item.fromAddress ? ` · ${item.fromAddress}` : ""}
                                    </div>
                                    <TargetEmailResultBadges item={item} />
                                    {item.sampleFilenames.length > 0 ? (
                                      <div className="mt-1 truncate text-[11px] text-slate-400">
                                        {item.sampleFilenames.slice(0, 3).join(", ")}
                                        {item.sampleFilenames.length > 3
                                          ? ` (+${item.sampleFilenames.length - 3} more)`
                                          : ""}
                                      </div>
                                    ) : null}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-800">
                          Or paste comma-separated Email IDs:
                        </label>
                        <input
                          type="text"
                          placeholder="uuid-1, uuid-2"
                          value={pastedEmailIds}
                          onChange={(e) => setPastedEmailIds(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-xs"
                        />
                      </div>

                      {resolvedTargetEmailIds.length > 0 ? (
                        <div className="text-xs font-medium text-teal-800">
                          {resolvedTargetEmailIds.length} email(s) targeted.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Overwrite Checkbox */}
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={forceOverwrite}
                      onChange={(e) => setForceOverwrite(e.target.checked)}
                      className="rounded text-teal-600 focus:ring-teal-500"
                    />
                    Force overwrite existing file cards
                  </label>

                  {/* DeepSeek Pricing Timeline & Cost Panel */}
                  <div className="space-y-3 pt-2">
                    <DeepSeekPricingTimeline pricingStatus={pricingStatus} atMs={Date.now()} />

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
                        <span className="font-semibold text-slate-900">
                          Estimated Cost & Targets
                        </span>
                        {costLoading ? (
                          <span className="text-xs text-slate-500">Calculating targets…</span>
                        ) : (
                          <span className="text-xs font-medium text-teal-700">
                            {targetCount} attachment{targetCount === 1 ? "" : "s"} selected
                          </span>
                        )}
                      </div>

                      {costError ? (
                        <div className="mt-2 text-xs text-red-600">{costError}</div>
                      ) : costContext ? (
                        <div className="mt-3 space-y-3 text-xs">
                          <p className="text-slate-500">
                            Per attachment (cache-miss input): ~
                            {costContext.avgInputTokensPerDoc.toLocaleString()} in / ~
                            {costContext.avgOutputTokensPerDoc.toLocaleString()} out
                            {costContext.tokensPerDocBasis === "observed"
                              ? ` · from ${costContext.observedCardCount} billed card${costContext.observedCardCount === 1 ? "" : "s"}`
                              : " · default until billed cards exist"}
                          </p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <span className="text-slate-500">Selected scope tokens:</span>{" "}
                              <span className="font-medium text-slate-800">
                                ~{costContext.estimatedInputTokens.toLocaleString()} in / ~
                                {costContext.estimatedOutputTokens.toLocaleString()} out
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500">Selected scope off-peak:</span>{" "}
                              <span className="font-semibold text-teal-700">
                                ${costContext.estimatedOffPeakCostUsd.toFixed(4)}
                              </span>{" "}
                              <span className="text-slate-400">
                                (vs ${costContext.estimatedPeakCostUsd.toFixed(4)} peak)
                              </span>
                            </div>
                          </div>
                          {corpusCostContext &&
                          corpusTargetCount > 0 &&
                          scope !== "pending_corpus" ? (
                            <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 p-3">
                              <div className="font-semibold text-amber-950">
                                Full pending corpus
                              </div>
                              <div className="mt-1 text-amber-900/80">
                                {corpusTargetCount.toLocaleString()} parsed attachments without
                                cards
                              </div>
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <div>
                                  <span className="text-amber-800/70">Tokens:</span>{" "}
                                  <span className="font-medium text-amber-950">
                                    ~{corpusCostContext.estimatedInputTokens.toLocaleString()} in
                                    / ~
                                    {corpusCostContext.estimatedOutputTokens.toLocaleString()} out
                                  </span>
                                </div>
                                <div>
                                  <span className="text-amber-800/70">Off-peak:</span>{" "}
                                  <span className="font-semibold text-amber-950">
                                    ${corpusCostContext.estimatedOffPeakCostUsd.toFixed(2)}
                                  </span>{" "}
                                  <span className="text-amber-800/60">
                                    (vs ${corpusCostContext.estimatedPeakCostUsd.toFixed(2)} peak)
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Start Button */}
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={handleStartRun}
                      disabled={busy || targetCount === 0 || activeRun?.status === "running"}
                      className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-teal-700 disabled:opacity-50"
                    >
                      {busy
                        ? "Starting…"
                        : `Start file cards run (${targetCount} attachment${targetCount === 1 ? "" : "s"})`}
                    </button>
                  </div>
                </div>
              ) : tab === "qualify" ? (
                <div className="space-y-4">
                  {/* Filter by run */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-slate-600">Filter by run:</span>
                      <select
                        value={cardsRunFilter}
                        onChange={(e) => {
                          setCardsRunFilter(e.target.value);
                          setCardsPage(1);
                        }}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-800"
                      >
                        <option value="">All recent runs</option>
                        {recentRuns.map((r) => (
                          <option key={r.id} value={r.id}>
                            {formatDateTime(r.startedAt)} · {r.scope} ({r.completedDocs} docs)
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => loadCards(cardsRunFilter || undefined, cardsPage)}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Refresh
                    </button>
                  </div>

                  {cardsLoading ? (
                    <div className="py-12 text-center text-sm text-slate-500">
                      Loading generated file cards…
                    </div>
                  ) : cards.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                      No file cards generated yet. Run a test batch or target emails in the Run tab.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {cards.map((card) => {
                        const isExpanded = expandedHashes.has(card.contentHash);
                        const typeBg =
                          card.documentType === "study"
                            ? "bg-purple-100 text-purple-900 border-purple-200"
                            : card.documentType === "tables"
                              ? "bg-blue-100 text-blue-900 border-blue-200"
                              : card.documentType === "signed_report"
                                ? "bg-emerald-100 text-emerald-900 border-emerald-200"
                                : card.documentType === "proposal" || card.documentType === "sample"
                                  ? "bg-amber-100 text-amber-900 border-amber-200"
                                  : "bg-slate-100 text-slate-800 border-slate-200";

                        return (
                          <div
                            key={card.contentHash}
                            className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${typeBg}`}
                                  >
                                    {card.documentType}
                                  </span>
                                  <a
                                    href={
                                      card.attachmentId
                                        ? `/api/email/attachments/${card.attachmentId}`
                                        : "#"
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-semibold text-slate-900 hover:text-teal-700 hover:underline"
                                  >
                                    {card.filename}
                                  </a>
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  Email:{" "}
                                  {card.emailId ? (
                                    <Link
                                      href={emailMessageDetailHref(card.emailId)}
                                      className="font-medium text-teal-800 underline hover:text-teal-950"
                                    >
                                      {card.emailSubject || "(view email)"}
                                    </Link>
                                  ) : (
                                    card.emailSubject || "(no parent email)"
                                  )}
                                  {card.documentDate ? ` · Date: ${card.documentDate}` : ""}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-400">
                                  ${card.costUsd.toFixed(4)} ({card.pricingTier})
                                </span>
                                {/* Thumbs up / down qualify buttons */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleRateCard(
                                      card.contentHash,
                                      card.rating === "up" ? null : "up",
                                    )
                                  }
                                  className={`rounded-md p-1 transition ${
                                    card.rating === "up"
                                      ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-500"
                                      : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                  }`}
                                  title="Approve / accurate summary"
                                >
                                  👍
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleRateCard(
                                      card.contentHash,
                                      card.rating === "down" ? null : "down",
                                    )
                                  }
                                  className={`rounded-md p-1 transition ${
                                    card.rating === "down"
                                      ? "bg-red-100 text-red-800 ring-1 ring-red-500"
                                      : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                  }`}
                                  title="Flag / inaccurate summary"
                                >
                                  👎
                                </button>
                              </div>
                            </div>

                            <div className="mt-3 space-y-2 text-xs">
                              <div>
                                <span className="font-semibold text-slate-700">Summary: </span>
                                <span className="text-slate-800">{card.summary}</span>
                              </div>

                              {card.coveringEmailContext ? (
                                <div>
                                  <span className="font-semibold text-slate-700">Email Context: </span>
                                  <span className="text-slate-600">{card.coveringEmailContext}</span>
                                </div>
                              ) : null}

                              {card.parties && card.parties.length > 0 ? (
                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                  <span className="font-semibold text-slate-700">Parties:</span>
                                  {card.parties.map((party) => (
                                    <span
                                      key={party}
                                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700"
                                    >
                                      {party}
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              {card.sections && card.sections.length > 0 ? (
                                <div className="pt-1">
                                  <span className="font-semibold text-slate-700">Outline: </span>
                                  <span className="text-slate-600">
                                    {card.sections
                                      .slice(0, 10)
                                      .map((entry) =>
                                        entry.page != null
                                          ? `p.${entry.page} ${entry.title}`
                                          : entry.title,
                                      )
                                      .join(" · ")}
                                  </span>
                                </div>
                              ) : null}

                              {card.fileMetadata ? (
                                <div className="pt-1 text-slate-600">
                                  <span className="font-semibold text-slate-700">
                                    Document properties:{" "}
                                  </span>
                                  {[
                                    card.fileMetadata.author
                                      ? `Author: ${card.fileMetadata.author}`
                                      : null,
                                    card.fileMetadata.creator
                                      ? `Application: ${card.fileMetadata.creator}`
                                      : null,
                                    card.fileMetadata.producer
                                      ? `Producer: ${card.fileMetadata.producer}`
                                      : null,
                                    card.fileMetadata.creationDate
                                      ? `Created: ${card.fileMetadata.creationDate}`
                                      : null,
                                    card.fileMetadata.modificationDate
                                      ? `Modified: ${card.fileMetadata.modificationDate}`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "extracted"}
                                  {card.fileMetadata.headerText ? (
                                    <div className="mt-1 text-[11px] text-slate-500">
                                      Header: {card.fileMetadata.headerText.replace(/\n/g, " · ")}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>

                            {/* Packed Excerpt Toggle */}
                            {card.packedExcerpt ? (
                              <div className="mt-3 border-t border-slate-100 pt-2">
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(card.contentHash)}
                                  className="text-[11px] font-medium text-slate-500 underline hover:text-slate-700"
                                >
                                  {isExpanded ? "Hide packed prompt excerpt" : "Show packed prompt excerpt"}
                                </button>
                                {isExpanded ? (
                                  <pre className="mt-1.5 max-h-40 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] text-slate-600">
                                    {card.packedExcerpt}
                                  </pre>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <EntityListPagination
                    total={cardsTotal}
                    page={cardsPage}
                    pageSize={QUALIFY_CARDS_PAGE_SIZE}
                    pending={cardsLoading}
                    onPageChange={setCardsPage}
                    ariaLabel="Qualified file cards pagination"
                  />
                </div>
              ) : (
                /* History Tab */
                <div className="space-y-3">
                  {recentRuns.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-500">
                      No past file card runs.
                    </div>
                  ) : (
                    recentRuns.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-700"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider text-[10px] ${
                                r.status === "completed"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : r.status === "running"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {r.status}
                            </span>
                            <span className="font-semibold text-slate-900">
                              Scope: {r.scope}
                            </span>
                            <span className="text-slate-400">
                              {formatDateTime(r.startedAt)}
                            </span>
                          </div>
                          <div className="mt-1 text-slate-500">
                            {r.completedDocs} completed · {r.failedDocs} failed · {r.totalDocs} total docs
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="font-semibold text-slate-800">
                            ${r.totalCostUsd.toFixed(4)}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {r.totalInputTokens + r.totalOutputTokens} tokens
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
