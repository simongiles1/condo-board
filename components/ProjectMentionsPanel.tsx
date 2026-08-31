"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";

import { EmailSidePanel } from "@/components/EmailSidePanel";
import {
  MintedBadge,
  ResolutionReasonBadge,
} from "@/components/EntityMentionBadges";
import { ReHarvestThreadButton, type HarvestRunMessage } from "@/components/ReHarvestThreadButton";
import { harvestMessageClassName } from "@/components/HarvestRunNotice";
import type {
  ProjectMentionQueueGroup,
  ProjectMentionQueueView,
  ProjectMentionStats,
} from "@/lib/projects/mention-queue-shared";
import { formatDateTime } from "@/lib/format/datetime";

const VIEW_OPTIONS: Array<{ id: ProjectMentionQueueView; label: string }> = [
  { id: "unresolved", label: "Unresolved" },
  { id: "provisional", label: "Provisional" },
  { id: "confirmed", label: "Confirmed" },
];

const LOAD_TIMEOUT_MS = 20_000;

const QUOTE_HIGHLIGHT_CLASS =
  "rounded-sm bg-amber-200 text-inherit box-decoration-clone px-0.5";

function MentionContextSnippet({
  text,
  term,
}: {
  text: string;
  term: string | null;
}) {
  const needle = term?.trim();
  if (!needle) return <>{text}</>;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(escaped, "i").exec(text);
  if (!match || match.index == null) return <>{text}</>;
  return (
    <>
      {text.slice(0, match.index)}
      <mark className={QUOTE_HIGHLIGHT_CLASS}>{match[0]}</mark>
      {text.slice(match.index + match[0].length)}
    </>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12s-3.75 6.75-9.75 6.75S2.25 12 2.25 12z"
      />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

export function ProjectMentionsPanel({
  stats,
  pending = false,
  statsKnown = false,
  onStats,
  onChanged,
  onOpenProject,
}: {
  stats: {
    mentionUnresolvedCount?: number;
    mentionProvisionalCount?: number;
    mentionConfirmedCount?: number;
    mentionTotalCount?: number;
  };
  pending?: boolean;
  statsKnown?: boolean;
  onStats?: (stats: {
    mentionUnresolvedCount: number;
    mentionProvisionalCount: number;
    mentionConfirmedCount: number;
    mentionTotalCount: number;
  }) => void;
  onChanged?: () => void;
  onOpenProject?: (identityKey: string) => void;
}) {
  const [view, setView] = useState<ProjectMentionQueueView>("unresolved");
  const [groups, setGroups] = useState<ProjectMentionQueueGroup[]>([]);
  const [mentionStats, setMentionStats] = useState<ProjectMentionStats | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!statsKnown);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [harvestMessage, setHarvestMessage] = useState<HarvestRunMessage | null>(
    null,
  );
  const [resolvePending, startResolve] = useTransition();
  const [panelEmailId, setPanelEmailId] = useState<string | null>(null);
  const [panelQuote, setPanelQuote] = useState<string | null>(null);
  const [panelThreadId, setPanelThreadId] = useState<string | null>(null);

  const selected = useMemo(
    () => groups.find((group) => group.id === selectedId) ?? null,
    [groups, selectedId],
  );

  async function loadGroups(
    nextView = view,
    signal?: AbortSignal,
  ): Promise<void> {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      if (!signal?.aborted) controller.abort("timeout");
    }, LOAD_TIMEOUT_MS);
    const onParentAbort = () => controller.abort();
    signal?.addEventListener("abort", onParentAbort);
    try {
      const res = await fetch(
        `/api/projects/registry?view=mentions&mentionView=${nextView}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!res.ok) {
        setError("Failed to load project mentions.");
        return;
      }
      const json = (await res.json()) as {
        groups?: ProjectMentionQueueGroup[];
        mentionStats?: ProjectMentionStats;
        error?: string;
      };
      const nextGroups = json.groups ?? [];
      setGroups(nextGroups);
      if (json.mentionStats) {
        setMentionStats(json.mentionStats);
        onStats?.({
          mentionUnresolvedCount: json.mentionStats.unresolved,
          mentionProvisionalCount: json.mentionStats.provisional,
          mentionConfirmedCount: json.mentionStats.confirmed,
          mentionTotalCount: json.mentionStats.total,
        });
      }
      setSelectedId((prev) => {
        if (prev && nextGroups.some((group) => group.id === prev)) return prev;
        return nextGroups[0]?.id ?? null;
      });
    } catch (error) {
      if (signal?.aborted) return;
      const timedOut =
        controller.signal.reason === "timeout" ||
        (error instanceof DOMException && error.name === "TimeoutError") ||
        (error instanceof Error && error.name === "AbortError");
      setError(
        timedOut
          ? "Project mentions timed out. Try Refresh."
          : "Failed to load project mentions.",
      );
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onParentAbort);
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadGroups(view, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view-driven fetch
  }, [view]);

  function processPendingMerges() {
    startResolve(async () => {
      setMessage("Syncing project registry and resolving mentions…");
      try {
        const res = await fetch("/api/projects/registry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resolve_mentions" }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          scanned?: number;
          confirmed?: number;
          provisional?: number;
          unresolved?: number;
          retracted?: number;
          error?: string;
        };
        if (!res.ok || !json.ok) {
          setMessage(json.error ?? "Could not resolve project mentions.");
          return;
        }
        setMessage(
          `Resolved ${json.scanned ?? 0} mention${json.scanned === 1 ? "" : "s"} → ${json.confirmed ?? 0} confirmed, ${json.provisional ?? 0} provisional, ${json.unresolved ?? 0} still unresolved${json.retracted ? `, ${json.retracted} retracted` : ""}.`,
        );
        await loadGroups(view);
        onChanged?.();
      } catch {
        setMessage("Could not resolve project mentions.");
      }
    });
  }

  const unresolvedCount =
    mentionStats?.unresolved ?? stats.mentionUnresolvedCount ?? 0;
  const viewCount =
    view === "unresolved"
      ? unresolvedCount
      : view === "provisional"
        ? (mentionStats?.provisional ?? stats.mentionProvisionalCount ?? 0)
        : (mentionStats?.confirmed ?? stats.mentionConfirmedCount ?? 0);
  const showLoading =
    loading && groups.length === 0 && !(statsKnown && viewCount === 0);
  const busy = pending || resolvePending || showLoading;
  const harvestThreadId =
    selected?.samples.find((sample) => sample.threadId)?.threadId ?? null;
  const harvestEmailIds = [
    ...new Set(
      (selected?.samples ?? [])
        .map((sample) => sample.sourceEmailId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {VIEW_OPTIONS.map((option) => {
          const count =
            option.id === "unresolved"
              ? unresolvedCount
              : option.id === "provisional"
                ? (mentionStats?.provisional ?? stats.mentionProvisionalCount ?? 0)
                : (mentionStats?.confirmed ?? stats.mentionConfirmedCount ?? 0);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setView(option.id);
                setMessage(null);
              }}
              className={
                view === option.id
                  ? "rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white"
                  : "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
              }
            >
              {option.label}
              {` (${count.toLocaleString()})`}
            </button>
          );
        })}
        <button
          type="button"
          disabled={busy}
          onClick={processPendingMerges}
          className="rounded-md bg-orange-700 px-3 py-1.5 font-medium text-white hover:bg-orange-800 disabled:opacity-50"
        >
          Process pending project merges
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setMessage(null);
            void loadGroups(view);
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Refresh
        </button>
        <Link
          href="/knowledge/entities/mention-rules#projects"
          className="rounded-md px-3 py-1.5 text-slate-700 hover:underline"
        >
          How mentions match
        </Link>
      </div>
      <p className="mb-3 text-sm text-slate-600">
        Per-email project observations. Unminted cards failed the name gate;
        minted cards attach when identity or a unique name/alias is unambiguous.
        Process pending project merges re-syncs the registry and re-runs the
        matcher.
      </p>
      {harvestMessage ? (
        <p
          className={`mb-3 ${harvestMessageClassName(harvestMessage.tone)}`}
          role={harvestMessage.tone === "error" ? "alert" : "status"}
        >
          {harvestMessage.text}
        </p>
      ) : null}
      {message ? (
        <p className="mb-3 text-sm text-slate-600" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mb-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
        <ul className="max-h-[70vh] overflow-y-auto border border-slate-200 bg-white">
          {showLoading ? (
            <li className="p-4 text-sm text-slate-500">Loading mentions…</li>
          ) : groups.length === 0 ? (
            <li className="p-4 text-sm text-slate-500">
              {view === "unresolved"
                ? "No unresolved project mentions yet. Re-harvest a thread (or Inbox Re-harvest C+P) to write pass-3 cards into this queue."
                : view === "provisional"
                  ? "No provisional project mentions."
                  : "No confirmed project mentions."}
            </li>
          ) : (
            groups.map((group) => {
              const active = group.id === selected?.id;
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(group.id);
                      setMessage(null);
                    }}
                    className={
                      active
                        ? "w-full border-l-2 border-orange-700 bg-orange-50 px-3 py-2 text-left"
                        : "w-full border-l-2 border-transparent px-3 py-2 text-left hover:bg-slate-50"
                    }
                  >
                    <span className="block text-sm font-medium text-slate-900">
                      {group.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {group.mentionCount} mention
                      {group.mentionCount === 1 ? "" : "s"} · {group.emailCount}{" "}
                      email{group.emailCount === 1 ? "" : "s"}
                      {group.mintedCount > 0
                        ? ` · ${group.mintedCount} minted`
                        : ""}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <section className="min-w-0 border border-slate-200 bg-white p-4">
          {!selected ? (
            <p className="text-sm text-slate-500">Select a group.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {selected.label}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {selected.mentionCount} mention
                    {selected.mentionCount === 1 ? "" : "s"} across{" "}
                    {selected.emailCount} email
                    {selected.emailCount === 1 ? "" : "s"}
                  </p>
                </div>
                {harvestEmailIds.length > 0 ? (
                  <ReHarvestThreadButton
                    threadId={harvestThreadId}
                    emailIds={harvestEmailIds}
                    kinds={["contacts", "projects"]}
                    disabled={busy}
                    onComplete={() => {
                      void loadGroups(view);
                      onChanged?.();
                    }}
                    onMessage={setHarvestMessage}
                  />
                ) : null}
              </div>

              <ul className="mt-4 space-y-3">
                {selected.samples.map((sample) => {
                  const extraBits = [
                    sample.contractor,
                    sample.yearHint,
                    sample.phase,
                    sample.location,
                  ]
                    .map((value) => value?.trim())
                    .filter(Boolean);
                  return (
                    <li
                      key={sample.mentionId}
                      className="rounded-md border border-slate-200 px-3 py-2"
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900">
                            {sample.rawName}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {sample.subject || "(no subject)"}
                            {sample.receivedAt
                              ? ` · ${formatDateTime(sample.receivedAt)}`
                              : ""}
                            {sample.fromAddress
                              ? ` · from ${sample.fromAddress}`
                              : ""}
                          </p>
                          {sample.toPreview ? (
                            <p className="mt-0.5 text-xs text-slate-500">
                              To: {sample.toPreview}
                            </p>
                          ) : null}
                          {extraBits.length > 0 ? (
                            <p className="mt-1 text-xs text-slate-600">
                              {extraBits.join(" · ")}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <MintedBadge minted={sample.minted} />
                            <ResolutionReasonBadge
                              reason={sample.resolutionReason}
                            />
                            {sample.resolvedProjectIdentityKey &&
                            sample.resolvedProjectName ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenProject?.(
                                    sample.resolvedProjectIdentityKey!,
                                  )
                                }
                                className="inline-flex rounded bg-orange-50 px-1.5 py-px text-[11px] font-medium text-orange-950 ring-1 ring-orange-200/90 hover:bg-orange-100"
                              >
                                {sample.resolvedProjectName}
                              </button>
                            ) : sample.resolvedProjectName ? (
                              <span className="inline-flex rounded bg-orange-50 px-1.5 py-px text-[11px] font-medium text-orange-950 ring-1 ring-orange-200/90">
                                {sample.resolvedProjectName}
                              </span>
                            ) : null}
                          </div>
                          {sample.contextSnippet ? (
                            <p className="mt-2 text-sm leading-5 text-slate-700">
                              <MentionContextSnippet
                                text={sample.contextSnippet}
                                term={sample.rawName}
                              />
                            </p>
                          ) : null}
                        </div>
                        {sample.sourceEmailId ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPanelEmailId(sample.sourceEmailId);
                              setPanelQuote(sample.rawName);
                              setPanelThreadId(sample.threadId);
                            }}
                            aria-label="Open email"
                            title="Open email"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          >
                            <EyeIcon className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>

      <EmailSidePanel
        emailId={panelEmailId}
        threadId={panelThreadId}
        highlightQuote={panelQuote}
        onClose={() => {
          setPanelEmailId(null);
          setPanelQuote(null);
          setPanelThreadId(null);
        }}
      />
    </div>
  );
}
