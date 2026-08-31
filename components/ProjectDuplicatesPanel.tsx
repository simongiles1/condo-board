"use client";

import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MergeIcon } from "@/components/MergeEntityDialog";
import type {
  ProjectDuplicateGroup,
  ProjectDuplicateGroupMember,
} from "@/lib/projects/duplicate-groups";
import { PROJECT_NAME_FUZZY_THRESHOLD } from "@/lib/projects/project-name-fuzzy";
import { splitProjectMultiValue } from "@/lib/projects/project-multi-values";
import type { IdentityReviewRunRecord } from "@/lib/projects/identity-review-shared";

function projectDuplicateMemberSubtitle(member: ProjectDuplicateGroupMember): string {
  const parts: string[] = [];
  if (member.phase?.trim()) {
    parts.push(member.phase.trim());
  }
  const contractor = splitProjectMultiValue(member.contractor)[0];
  if (contractor) parts.push(contractor);
  if ((member.aliases?.length ?? 0) > 0) {
    parts.push(`aliases: ${member.aliases!.join(", ")}`);
  }
  return parts.join(" · ");
}

function ClearSelectionIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function DuplicatesWaitBanner({ reason }: { reason: string }) {
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    setElapsedSec(0);
    const timer = window.setInterval(() => {
      setElapsedSec((sec) => sec + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [reason]);
  const clock =
    elapsedSec >= 60
      ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`
      : `${elapsedSec}s`;
  return (
    <p
      role="status"
      aria-live="polite"
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
    >
      {reason}
      {elapsedSec >= 3 ? ` · waited ${clock}` : ""}
    </p>
  );
}

function reviewProgressLabel(run: IdentityReviewRunRecord): string {
  if (run.status === "running") {
    if (run.currentPass === 2) {
      return `Pass 2 · ${run.clusterCompleted} / ${run.clusterTotal} clusters`;
    }
    return `Pass 1 · clustering ${run.projectCount} projects`;
  }
  if (run.status === "completed") return "Identity review complete";
  if (run.status === "cancelled") return "Identity review cancelled";
  if (run.status === "failed") {
    return run.lastError
      ? `Identity review failed: ${run.lastError}`
      : "Identity review failed";
  }
  return "Identity review";
}

function groupKindLabel(group: ProjectDuplicateGroup): string {
  if (group.kind === "ai_review") {
    const confidence = group.confidence ?? "medium";
    const kind =
      group.decisionKind === "single_span"
        ? "one spanning job"
        : group.decisionKind === "recurring_by_year"
          ? "yearly campaigns"
          : group.decisionKind === "mixed"
            ? "mixed"
            : "review";
    return `AI review · ${confidence} · ${kind}`;
  }
  return `Fuzzy name · ${groupSubtitle(group)}`;
}

function groupSubtitle(group: ProjectDuplicateGroup): string {
  if (group.kind === "ai_review") {
    return `${group.memberCount} cards`;
  }
  return `${group.memberCount} cards · links ≥ ${formatScore(group.minLinkScore)}`;
}

export function ProjectDuplicatesPanel({
  groups,
  loading,
  error,
  pending = false,
  waitReason = null,
  reviewRun = null,
  reviewError = null,
  reviewPending = false,
  onRefresh,
  onOpenMerge,
  onMergeAllInto,
  onStartReview,
  onCancelReview,
}: {
  groups: ProjectDuplicateGroup[];
  loading: boolean;
  error: string | null;
  pending?: boolean;
  waitReason?: string | null;
  reviewRun?: IdentityReviewRunRecord | null;
  reviewError?: string | null;
  reviewPending?: boolean;
  onRefresh: () => void;
  onOpenMerge: (members: ProjectDuplicateGroupMember[]) => void;
  onMergeAllInto: (
    target: ProjectDuplicateGroupMember,
    sources: ProjectDuplicateGroupMember[],
  ) => void;
  onStartReview: () => void;
  onCancelReview: () => void;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [mergeAllTarget, setMergeAllTarget] =
    useState<ProjectDuplicateGroupMember | null>(null);
  const reviewRunning = reviewRun?.status === "running";
  const reviewBlocked = Boolean(waitReason) || loading || pending || reviewPending;
  const reviewButtonLabel = reviewRunning
    ? "Reviewing…"
    : waitReason
      ? "Waiting…"
      : "AI review identities";

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedGroupId(null);
      return;
    }
    setSelectedGroupId((prev) => {
      if (prev && groups.some((g) => g.id === prev)) return prev;
      return groups[0]!.id;
    });
  }, [groups]);

  useEffect(() => {
    setCheckedIds(new Set());
    setMergeAllTarget(null);
  }, [selectedGroupId]);

  const members = selectedGroup?.members ?? [];
  const mergeAllSources = useMemo(() => {
    if (!mergeAllTarget) return [];
    return members.filter((m) => m.id !== mergeAllTarget.id);
  }, [members, mergeAllTarget]);
  const checkedCount = checkedIds.size;
  const allMembersSelected =
    members.length > 0 && members.every((m) => checkedIds.has(m.id));

  function toggleChecked(orgId: string, checked: boolean) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orgId);
      else next.delete(orgId);
      return next;
    });
  }

  function toggleSelectAll() {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (allMembersSelected) {
        for (const member of members) next.delete(member.id);
      } else {
        for (const member of members) next.add(member.id);
      }
      return next;
    });
  }

  function openMergeFromChecked() {
    const selected = members.filter((m) => checkedIds.has(m.id));
    if (selected.length < 2) return;
    onOpenMerge(selected);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          AI review groups work-type duplicates after reading emails (high
          confidence auto-merges; medium/low wait here). Fuzzy name clusters
          (≥ {formatScore(PROJECT_NAME_FUZZY_THRESHOLD)}) remain for anything
          the review did not propose.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={reviewBlocked || reviewRunning}
            title={
              waitReason ??
              (reviewRunning
                ? "Identity review is running"
                : "Cluster work-type duplicates after reading emails")
            }
            aria-busy={reviewBlocked || reviewRunning}
            onClick={onStartReview}
            className="rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-50"
          >
            {reviewButtonLabel}
          </button>
          {reviewRunning ? (
            <button
              type="button"
              disabled={reviewPending}
              onClick={onCancelReview}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={loading || pending || Boolean(waitReason)}
            onClick={onRefresh}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {waitReason ? <DuplicatesWaitBanner reason={waitReason} /> : null}

      {reviewRun ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {reviewProgressLabel(reviewRun)}
          {reviewRun.totalCostUsd > 0
            ? ` · ~$${reviewRun.totalCostUsd.toFixed(3)}`
            : ""}
          {reviewRun.highApplied > 0
            ? ` · ${reviewRun.highApplied} high-confidence merge${reviewRun.highApplied === 1 ? "" : "s"} applied`
            : ""}
          {reviewRun.proposedCount > 0
            ? ` · ${reviewRun.proposedCount} proposed`
            : ""}
        </p>
      ) : null}

      {reviewError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {reviewError}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="flex max-h-[70vh] flex-col overflow-hidden border border-slate-200 bg-white">
          <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
            {loading && groups.length === 0
              ? "Loading duplicate groups…"
              : `${groups.length} duplicate group${groups.length === 1 ? "" : "s"}`}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {!loading && groups.length === 0 ? (
              <li className="p-4 text-sm text-slate-500">
                No fuzzy or AI-review groups found. Run AI review identities
                to cluster MagLock-style variants; fuzzy matches still appear
                when names score at or above{" "}
                {formatScore(PROJECT_NAME_FUZZY_THRESHOLD)} similarity.
              </li>
            ) : (
              groups.map((group) => {
                const selected = group.id === selectedGroupId;
                return (
                  <li key={group.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedGroupId(group.id)}
                      className={
                        selected
                          ? "flex w-full items-start justify-between gap-2 border-b border-slate-100 bg-orange-50 px-3 py-2 text-left"
                          : "flex w-full items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                      }
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {group.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {groupKindLabel(group)}
                        </span>
                      </span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                        {group.memberCount}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <section className="border border-slate-200 bg-white">
          {!selectedGroup ? (
            <p className="p-4 text-sm text-slate-500">
              Select a duplicate group.
            </p>
          ) : (
            <>
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  {selectedGroup.label}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedGroup.kind === "ai_review"
                    ? selectedGroup.rationale ||
                      `${groupKindLabel(selectedGroup)} — review aliases and project fields before merging.`
                    : `${groupSubtitle(selectedGroup)} — review aliases and project fields before merging; the absorbed name is kept as an alias.`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={allMembersSelected}
                    onChange={toggleSelectAll}
                    disabled={pending || members.length === 0}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-orange-700 focus:ring-orange-500"
                  />
                  Select all
                </label>
                {checkedCount > 0 ? (
                  <div className="ml-auto flex items-center gap-1">
                    <span className="text-xs text-slate-500">
                      {checkedCount} selected
                    </span>
                    <button
                      type="button"
                      disabled={pending || checkedCount < 2}
                      onClick={openMergeFromChecked}
                      title={
                        checkedCount < 2
                          ? "Select at least 2 projects to merge"
                          : `Merge ${checkedCount} selected projects`
                      }
                      aria-label={
                        checkedCount < 2
                          ? "Merge selected (select at least 2)"
                          : `Merge ${checkedCount} selected projects`
                      }
                      className="rounded p-1.5 text-slate-500 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-50"
                    >
                      <MergeIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setCheckedIds(new Set())}
                      title="Clear selection"
                      aria-label="Clear selection"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                    >
                      <ClearSelectionIcon className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
              </div>

              <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
                {members.map((member) => {
                  const checked = checkedIds.has(member.id);
                  const subtitle = projectDuplicateMemberSubtitle(member);
                  return (
                    <li
                      key={member.id}
                      className={
                        checked ? "bg-slate-50 px-4 py-3" : "px-4 py-3"
                      }
                    >
                      <div className="flex items-start gap-3">
                        <label className="mt-1 shrink-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={pending}
                            onChange={(e) =>
                              toggleChecked(member.id, e.target.checked)
                            }
                            aria-label={`Select ${member.displayName}`}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-orange-700 focus:ring-orange-500"
                          />
                        </label>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-900">
                              {member.displayName}
                            </span>
                            {member.nameless ? (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                                nameless
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">
                            mentions {member.sourceEmailCount}
                            {member.sourceMergeCount > 0
                              ? ` · ${member.sourceMergeCount} thread merge${member.sourceMergeCount === 1 ? "" : "s"}`
                              : ""}
                          </p>
                          {subtitle ? (
                            <p className="mt-1 text-xs text-slate-600">
                              {subtitle}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 self-start">
                          {members.length >= 2 ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => setMergeAllTarget(member)}
                              className="whitespace-nowrap rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-medium text-orange-800 hover:bg-orange-100 disabled:opacity-50"
                            >
                              Merge all into this
                            </button>
                          ) : null}
                          <button
                            type="button"
                            title={`Merge ${member.displayName} into another project`}
                            aria-label={`Merge ${member.displayName} into another project`}
                            disabled={pending}
                            onClick={() => onOpenMerge([member])}
                            className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-50"
                          >
                            <MergeIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={mergeAllTarget != null && mergeAllSources.length > 0}
        title="Merge all into this project?"
        description={
          mergeAllTarget
            ? `Merge ${mergeAllSources.length} other card${mergeAllSources.length === 1 ? "" : "s"} in this group into “${mergeAllTarget.displayName}”. Absorbed names become aliases; contractors and locations are combined.`
            : ""
        }
        confirmLabel="Merge all"
        busyLabel="Merging…"
        busy={pending}
        onCancel={() => {
          if (pending) return;
          setMergeAllTarget(null);
        }}
        onConfirm={() => {
          if (!mergeAllTarget) return;
          const target = mergeAllTarget;
          const sources = mergeAllSources;
          setMergeAllTarget(null);
          onMergeAllInto(target, sources);
        }}
      />
    </div>
  );
}
