"use client";

import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MergeIcon } from "@/components/MergeEntityDialog";
import type {
  ContactDuplicateGroup,
  ContactDuplicateGroupMember,
} from "@/lib/contacts/duplicate-groups";
import {
  classifyDuplicateMergeRole,
  type DuplicateMergeProposeBucket,
  type DuplicateMergeProposeResult,
} from "@/lib/contacts/duplicate-merge-propose-shared";

function formatRange(from: string | null, to: string | null): string {
  const a = from?.slice(0, 10) ?? "…";
  const b = to?.slice(0, 10) ?? "present";
  return `${a} → ${b}`;
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

function groupSubtitle(group: ContactDuplicateGroup): string {
  if (group.kind === "first_name") {
    const parts = [`${group.memberCount} cards`];
    if (group.firstNameOnlyCount > 0) {
      parts.push(`${group.firstNameOnlyCount} first-name only`);
    }
    return parts.join(" · ");
  }
  const parts = [`${group.memberCount} cards`];
  if (group.namelessCount > 0) {
    parts.push(`${group.namelessCount} nameless`);
  }
  return parts.join(" · ");
}

function memberBadge(member: ContactDuplicateGroupMember): string | null {
  if (member.nameless) return "nameless";
  if (member.firstNameOnly) return "first-name only";
  if (member.sparseStub) return "stub";
  return null;
}

function confidenceLabel(confidence: DuplicateMergeProposeBucket["confidence"]) {
  if (confidence === "high") return "High confidence";
  if (confidence === "low") return "Low confidence";
  return "Medium confidence";
}

export function ContactDuplicatesPanel({
  groups,
  loading,
  error,
  pending = false,
  onRefresh,
  onOpenMerge,
  onMergeAllInto,
}: {
  groups: ContactDuplicateGroup[];
  loading: boolean;
  error: string | null;
  pending?: boolean;
  onRefresh: () => void;
  onOpenMerge: (members: ContactDuplicateGroupMember[]) => void;
  onMergeAllInto: (
    target: ContactDuplicateGroupMember,
    sources: ContactDuplicateGroupMember[],
  ) => void;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [mergeAllTarget, setMergeAllTarget] =
    useState<ContactDuplicateGroupMember | null>(null);
  const [proposals, setProposals] = useState<DuplicateMergeProposeResult | null>(
    null,
  );
  const [proposeLoading, setProposeLoading] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [approveBucket, setApproveBucket] =
    useState<DuplicateMergeProposeBucket | null>(null);

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
    setProposals(null);
    setProposeError(null);
    setApproveBucket(null);
  }, [selectedGroupId]);

  const members = selectedGroup?.members ?? [];
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );
  const mergeAllSources = useMemo(() => {
    if (!mergeAllTarget) return [];
    return members.filter((m) => m.id !== mergeAllTarget.id);
  }, [members, mergeAllTarget]);
  const checkedCount = checkedIds.size;
  const allMembersSelected =
    members.length > 0 && members.every((m) => checkedIds.has(m.id));
  const firstNameOnlyIds = members
    .filter((m) => m.firstNameOnly)
    .map((m) => m.id);
  const namelessIds = members.filter((m) => m.nameless).map((m) => m.id);
  const candidateCount = members.filter(
    (m) => classifyDuplicateMergeRole(m) === "candidate",
  ).length;
  const anchorCount = members.filter(
    (m) => classifyDuplicateMergeRole(m) === "anchor",
  ).length;
  const canProposeAi =
    selectedGroup?.kind === "first_name" &&
    candidateCount > 0 &&
    anchorCount > 0;

  const approveSources = useMemo(() => {
    if (!approveBucket) return [];
    return approveBucket.sourcePersonIds
      .map((id) => memberById.get(id))
      .filter(Boolean) as ContactDuplicateGroupMember[];
  }, [approveBucket, memberById]);

  const approveTarget = approveBucket
    ? (memberById.get(approveBucket.targetPersonId) ?? null)
    : null;

  function toggleChecked(personId: string, checked: boolean) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(personId);
      else next.delete(personId);
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

  function selectSubset(ids: string[]) {
    setCheckedIds(new Set(ids));
  }

  function openMergeFromChecked() {
    const selected = members.filter((m) => checkedIds.has(m.id));
    if (selected.length < 2) return;
    onOpenMerge(selected);
  }

  async function runAiPropose() {
    if (!selectedGroup || !canProposeAi) return;
    setProposeLoading(true);
    setProposeError(null);
    setProposals(null);
    try {
      const res = await fetch("/api/contacts/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "propose_duplicate_merges",
          memberIds: selectedGroup.members.map((m) => m.id),
        }),
      });
      const json = (await res.json()) as DuplicateMergeProposeResult & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setProposeError(json.error ?? "AI suggest merges failed.");
        return;
      }
      setProposals({
        buckets: json.buckets ?? [],
        unresolved: json.unresolved ?? [],
        meta: json.meta,
      });
    } catch {
      setProposeError("AI suggest merges failed.");
    } finally {
      setProposeLoading(false);
    }
  }

  function skipBucket(targetPersonId: string) {
    setProposals((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        buckets: prev.buckets.filter((b) => b.targetPersonId !== targetPersonId),
      };
    });
  }

  function dismissProposals() {
    setProposals(null);
    setProposeError(null);
    setApproveBucket(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Clusters of contacts that share a first name or email, sorted by size.
          Email occupancy ranges are shown so shared mailboxes can be merged into
          the right person for that period.
        </p>
        <button
          type="button"
          disabled={loading || pending}
          onClick={onRefresh}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="flex max-h-[70vh] flex-col overflow-hidden border border-slate-200 bg-white">
          <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
            {loading && groups.length === 0
              ? "Scanning registry…"
              : `${groups.length} duplicate group${groups.length === 1 ? "" : "s"}`}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {!loading && groups.length === 0 ? (
              <li className="p-4 text-sm text-slate-500">
                No shared first names or emails found. Duplicate clusters appear
                here when two or more contacts share a given name or mailbox.
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
                          ? "flex w-full items-start justify-between gap-2 border-b border-slate-100 bg-teal-50 px-3 py-2 text-left"
                          : "flex w-full items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                      }
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {group.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {group.kind === "first_name" ? "First name" : "Email"}{" "}
                          · {groupSubtitle(group)}
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
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-slate-900">
                      {selectedGroup.kind === "first_name"
                        ? `First name “${selectedGroup.label}”`
                        : selectedGroup.label}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {groupSubtitle(selectedGroup)}
                      {selectedGroup.kind === "email"
                        ? " — merge using the occupancy dates below when the same mailbox changed hands."
                        : " — first-name-only stubs are listed first; full-name cards with this given name are included for comparison."}
                    </p>
                  </div>
                  {canProposeAi ? (
                    <button
                      type="button"
                      disabled={pending || proposeLoading || loading}
                      onClick={() => {
                        void runAiPropose();
                      }}
                      className="shrink-0 rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-50"
                    >
                      {proposeLoading ? "Evaluating…" : "AI suggest merges"}
                    </button>
                  ) : null}
                </div>
              </div>

              {proposeError ? (
                <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-800">
                  {proposeError}
                </p>
              ) : null}

              {proposals ? (
                <div className="space-y-3 border-b border-amber-100 bg-amber-50/60 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        AI merge proposals
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {proposals.buckets.length} bucket
                        {proposals.buckets.length === 1 ? "" : "s"}
                        {proposals.unresolved.length > 0
                          ? ` · ${proposals.unresolved.length} unresolved`
                          : ""}
                        {" · "}
                        {proposals.meta.emailsSampled} emails sampled ·{" "}
                        {proposals.meta.modelName}
                        {proposals.meta.costUsd > 0
                          ? ` · ~$${proposals.meta.costUsd.toFixed(4)}`
                          : ""}
                        . Session only — leave or switch groups to discard.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={pending || proposeLoading}
                      onClick={dismissProposals}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Dismiss proposals
                    </button>
                  </div>

                  {proposals.buckets.length === 0 &&
                  proposals.unresolved.length === 0 ? (
                    <p className="text-sm text-slate-600">
                      No merge suggestions for this group.
                    </p>
                  ) : null}

                  {proposals.buckets.map((bucket) => {
                    const sources = bucket.sourcePersonIds
                      .map((id) => memberById.get(id))
                      .filter(Boolean) as ContactDuplicateGroupMember[];
                    return (
                      <div
                        key={bucket.targetPersonId}
                        className="rounded-md border border-amber-200 bg-white px-3 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">
                              Merge into {bucket.targetDisplayName}
                            </p>
                            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                              {confidenceLabel(bucket.confidence)} ·{" "}
                              {bucket.sourcePersonIds.length} card
                              {bucket.sourcePersonIds.length === 1 ? "" : "s"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              disabled={pending || sources.length === 0}
                              onClick={() => setApproveBucket(bucket)}
                              className="rounded-md bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                            >
                              Approve merge
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => skipBucket(bucket.targetPersonId)}
                              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              Skip
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 text-sm text-slate-700">
                          {bucket.synopsis}
                        </p>
                        {sources.length > 0 ? (
                          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                            {sources.map((source) => (
                              <li key={source.id}>
                                {source.displayName}
                                {source.emails[0]?.email
                                  ? ` · ${source.emails[0].email}`
                                  : ""}
                                {` · ${source.sourceEmailCount} mention${source.sourceEmailCount === 1 ? "" : "s"}`}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-xs text-amber-800">
                            Source cards are no longer in this group (refresh or
                            re-run AI).
                          </p>
                        )}
                      </div>
                    );
                  })}

                  {proposals.unresolved.length > 0 ? (
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                      <p className="text-sm font-semibold text-slate-900">
                        Unresolved ({proposals.unresolved.length})
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {proposals.unresolved.map((item) => {
                          const member = memberById.get(item.personId);
                          return (
                            <li
                              key={item.personId}
                              className="text-xs text-slate-600"
                            >
                              <span className="font-medium text-slate-800">
                                {member?.displayName ?? item.personId}
                              </span>
                              {" — "}
                              {item.reason}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={allMembersSelected}
                    onChange={toggleSelectAll}
                    disabled={pending || members.length === 0}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
                  />
                  Select all
                </label>
                {firstNameOnlyIds.length > 0 ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => selectSubset(firstNameOnlyIds)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Select first-name only ({firstNameOnlyIds.length})
                  </button>
                ) : null}
                {namelessIds.length > 0 ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => selectSubset(namelessIds)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Select nameless ({namelessIds.length})
                  </button>
                ) : null}
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
                          ? "Select at least 2 contacts to merge"
                          : `Merge ${checkedCount} selected contacts`
                      }
                      aria-label={
                        checkedCount < 2
                          ? "Merge selected (select at least 2)"
                          : `Merge ${checkedCount} selected contacts`
                      }
                      className="rounded p-1.5 text-slate-500 hover:bg-teal-50 hover:text-teal-700 disabled:opacity-50"
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
                  const badge = memberBadge(member);
                  const checked = checkedIds.has(member.id);
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
                            className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
                          />
                        </label>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-900">
                              {member.displayName}
                            </span>
                            {badge ? (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                                {badge}
                              </span>
                            ) : null}
                            {member.currentOrganizationName ? (
                              <span className="text-xs text-slate-500">
                                {member.currentOrganizationName}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">
                            mentions {member.sourceEmailCount}
                            {member.nameAliases.length > 0
                              ? ` · aliases: ${member.nameAliases.join(", ")}`
                              : ""}
                          </p>
                          {member.emails.length > 0 ? (
                            <ul className="mt-2 space-y-1">
                              {member.emails.map((email) => (
                                <li
                                  key={email.id}
                                  className="text-xs text-slate-700"
                                >
                                  <span className="font-medium">
                                    {email.email}
                                  </span>
                                  <span className="text-slate-500">
                                    {" "}
                                    · {formatRange(email.validFrom, email.validTo)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-slate-400">
                              No email on this card
                            </p>
                          )}
                          {member.titles.length > 0 ? (
                            <p className="mt-1 text-xs text-slate-500">
                              {member.titles
                                .map(
                                  (t) =>
                                    `${t.title} (${formatRange(t.validFrom, t.validTo)})`,
                                )
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 self-start">
                          {members.length >= 2 ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => setMergeAllTarget(member)}
                              className="whitespace-nowrap rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50"
                            >
                              Merge all into this
                            </button>
                          ) : null}
                          <button
                            type="button"
                            title={`Merge ${member.displayName} into another contact`}
                            aria-label={`Merge ${member.displayName} into another contact`}
                            disabled={pending}
                            onClick={() => onOpenMerge([member])}
                            className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-teal-50 hover:text-teal-700 disabled:opacity-50"
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
        title="Merge all into this contact?"
        description={
          mergeAllTarget ? (
            <div className="space-y-2">
              <p>
                Merge{" "}
                <span className="font-medium text-slate-800">
                  {mergeAllSources.length} other contact
                  {mergeAllSources.length === 1 ? "" : "s"}
                </span>{" "}
                in this group into{" "}
                <span className="font-medium text-slate-800">
                  “{mergeAllTarget.displayName}”
                </span>
                . This cannot be undone from the UI.
              </p>
              {mergeAllSources.length <= 8 ? (
                <ul className="list-disc space-y-0.5 pl-5 text-slate-600">
                  {mergeAllSources.map((source) => (
                    <li key={source.id}>{source.displayName}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500">
                  Including{" "}
                  {mergeAllSources
                    .slice(0, 3)
                    .map((s) => s.displayName)
                    .join(", ")}
                  , and {mergeAllSources.length - 3} more.
                </p>
              )}
            </div>
          ) : null
        }
        confirmLabel="Merge all"
        busyLabel="Merging…"
        busy={pending}
        onCancel={() => {
          if (pending) return;
          setMergeAllTarget(null);
        }}
        onConfirm={() => {
          if (!mergeAllTarget || mergeAllSources.length === 0) return;
          const target = mergeAllTarget;
          const sources = mergeAllSources;
          setMergeAllTarget(null);
          onMergeAllInto(target, sources);
        }}
      />

      <ConfirmDialog
        open={approveBucket != null && approveTarget != null && approveSources.length > 0}
        title="Approve AI merge proposal?"
        description={
          approveBucket && approveTarget ? (
            <div className="space-y-2">
              <p>
                Merge{" "}
                <span className="font-medium text-slate-800">
                  {approveSources.length} contact
                  {approveSources.length === 1 ? "" : "s"}
                </span>{" "}
                into{" "}
                <span className="font-medium text-slate-800">
                  “{approveTarget.displayName}”
                </span>
                . This cannot be undone from the UI.
              </p>
              <p className="text-slate-600">{approveBucket.synopsis}</p>
            </div>
          ) : null
        }
        confirmLabel="Approve merge"
        busyLabel="Merging…"
        busy={pending}
        onCancel={() => {
          if (pending) return;
          setApproveBucket(null);
        }}
        onConfirm={() => {
          if (!approveBucket || !approveTarget || approveSources.length === 0) {
            return;
          }
          const target = approveTarget;
          const sources = approveSources;
          const targetId = approveBucket.targetPersonId;
          setApproveBucket(null);
          skipBucket(targetId);
          onMergeAllInto(target, sources);
        }}
      />
    </div>
  );
}
