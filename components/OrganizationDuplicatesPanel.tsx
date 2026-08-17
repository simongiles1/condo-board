"use client";

import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MergeIcon } from "@/components/MergeEntityDialog";
import type {
  OrgDuplicateGroup,
  OrgDuplicateGroupMember,
} from "@/lib/organizations/duplicate-groups";
import { ORG_NAME_FUZZY_THRESHOLD } from "@/lib/organizations/org-name-fuzzy";
import { splitOrgMultiValue } from "@/lib/organizations/org-multi-values";

function orgDuplicateMemberSubtitle(member: OrgDuplicateGroupMember): string {
  const parts: string[] = [];
  if (member.organization_role?.trim()) {
    parts.push(member.organization_role.trim());
  }
  const email = splitOrgMultiValue(member.email)[0];
  if (email) parts.push(email);
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

function groupSubtitle(group: OrgDuplicateGroup): string {
  return `${group.memberCount} cards · links ≥ ${formatScore(group.minLinkScore)}`;
}

export function OrganizationDuplicatesPanel({
  groups,
  loading,
  error,
  pending = false,
  onRefresh,
  onOpenMerge,
  onMergeAllInto,
}: {
  groups: OrgDuplicateGroup[];
  loading: boolean;
  error: string | null;
  pending?: boolean;
  onRefresh: () => void;
  onOpenMerge: (members: OrgDuplicateGroupMember[]) => void;
  onMergeAllInto: (
    target: OrgDuplicateGroupMember,
    sources: OrgDuplicateGroupMember[],
  ) => void;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [mergeAllTarget, setMergeAllTarget] =
    useState<OrgDuplicateGroupMember | null>(null);

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
          Clusters of organizations whose names are similar after stripping
          legal suffixes (Inc, Ltd, LLC, …). Pairs at or above{" "}
          {formatScore(ORG_NAME_FUZZY_THRESHOLD)} similarity are grouped;
          connected chains share a cluster. Review and merge by hand — nothing
          auto-merges.
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
                No fuzzy name matches found. Clusters appear here when two or
                more organizations score at or above{" "}
                {formatScore(ORG_NAME_FUZZY_THRESHOLD)} similarity.
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
                          Fuzzy name · {groupSubtitle(group)}
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
                  {groupSubtitle(selectedGroup)} — review aliases and contact
                  fields before merging; the absorbed name is kept as an alias.
                </p>
              </div>

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
                          ? "Select at least 2 organizations to merge"
                          : `Merge ${checkedCount} selected organizations`
                      }
                      aria-label={
                        checkedCount < 2
                          ? "Merge selected (select at least 2)"
                          : `Merge ${checkedCount} selected organizations`
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
                  const checked = checkedIds.has(member.id);
                  const subtitle = orgDuplicateMemberSubtitle(member);
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
                              className="whitespace-nowrap rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50"
                            >
                              Merge all into this
                            </button>
                          ) : null}
                          <button
                            type="button"
                            title={`Merge ${member.displayName} into another organization`}
                            aria-label={`Merge ${member.displayName} into another organization`}
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
        title="Merge all into this organization?"
        description={
          mergeAllTarget
            ? `Merge ${mergeAllSources.length} other card${mergeAllSources.length === 1 ? "" : "s"} in this group into “${mergeAllTarget.displayName}”. Absorbed names become aliases; emails, phones, and websites are combined.`
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
