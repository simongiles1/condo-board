"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EntityListPagination } from "@/components/EntityListPagination";
import {
  MergeEntityDialog,
  MergeIcon,
  type MergeEntityOption,
} from "@/components/MergeEntityDialog";
import { OrgEvidenceSidePanel } from "@/components/OrgEvidenceSidePanel";
import { OrganizationDuplicatesPanel } from "@/components/OrganizationDuplicatesPanel";
import {
  personDisplayName,
  type ContactRegistryPersonSummary,
} from "@/lib/contacts/registry-shared";
import {
  clampEntityListPage,
  sliceEntityListPage,
} from "@/lib/entities/registry-page";
import type {
  OrgDuplicateGroup,
  OrgDuplicateGroupMember,
} from "@/lib/organizations/duplicate-groups";
import type {
  OrgFingerprintListStats,
  OrgFingerprintSummary,
} from "@/lib/organizations/fingerprint-list";
import type { OrgDeniableField } from "@/lib/organizations/field-denials";
import {
  sortOrgFingerprintSummaries,
  type OrgFingerprintListSort,
} from "@/lib/organizations/org-list-sort";
import {
  foldOrgNames,
  mergeOrgAliasLists,
  mergeOrgMultiValues,
  removeOrgMultiValue,
  splitOrgMultiValue,
} from "@/lib/organizations/org-multi-values";
import type { OrgEvidenceField } from "@/lib/organizations/registry-evidence-shared";

const ORG_LIST_SORT_OPTIONS: Array<{
  value: OrgFingerprintListSort;
  label: string;
}> = [
  { value: "mentions-desc", label: "Mentions (high → low)" },
  { value: "mentions-asc", label: "Mentions (low → high)" },
  { value: "name-asc", label: "Name (A → Z)" },
  { value: "name-desc", label: "Name (Z → A)" },
];

function OrgListSortMenu({
  value,
  onChange,
}: {
  value: OrgFingerprintListSort;
  onChange: (next: OrgFingerprintListSort) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const currentLabel =
    ORG_LIST_SORT_OPTIONS.find((option) => option.value === value)?.label ??
    "Sort";

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0 border-b border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Sort organizations: ${currentLabel}`}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100"
      >
        <span className="truncate">Sort: {currentLabel}</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Organization sort options"
          className="absolute left-0 right-0 top-full z-20 border border-slate-200 bg-white py-1 shadow-lg"
        >
          {ORG_LIST_SORT_OPTIONS.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={
                  selected
                    ? "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-teal-900 bg-teal-50"
                    : "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                }
              >
                <span>{option.label}</span>
                {selected ? (
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-teal-700"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      d="M3.5 8.5l3 3 6-7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ClearSelectionIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function ListSearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}

function SeverIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4L4 12" strokeLinecap="round" />
    </svg>
  );
}

function MoveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FieldRow({
  label,
  value,
  disabled,
  onSever,
  onEvidence,
}: {
  label: string;
  value: string | null;
  disabled?: boolean;
  onSever?: () => void;
  onEvidence?: () => void;
}) {
  const hasValue = Boolean(value?.trim());
  return (
    <div className="grid grid-cols-[7rem_1fr_auto] items-start gap-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">
        {hasValue && onEvidence ? (
          <button
            type="button"
            onClick={onEvidence}
            className="text-left text-teal-800 underline-offset-2 hover:underline"
          >
            {value}
          </button>
        ) : hasValue ? (
          value
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </dd>
      {hasValue && onSever ? (
        <button
          type="button"
          title={`Stop associating this ${label.toLowerCase()}`}
          aria-label={`Sever ${label.toLowerCase()} association`}
          disabled={disabled}
          onClick={onSever}
          className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
        >
          <SeverIcon className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="w-4" aria-hidden="true" />
      )}
    </div>
  );
}

function MultiValueField({
  label,
  values,
  disabled,
  onSever,
  onMove,
  onEvidence,
}: {
  label: string;
  values: string[];
  disabled?: boolean;
  onSever: (value: string) => void;
  onMove?: (value: string) => void;
  onEvidence?: (value: string) => void;
}) {
  if (values.length === 0) {
    return <FieldRow label={label} value={null} disabled={disabled} />;
  }
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0">
        <ul className="space-y-1">
          {values.map((value) => (
            <li
              key={`${label}:${value}`}
              className="grid grid-cols-[1fr_auto_auto] items-start gap-1"
            >
              {onEvidence ? (
                <button
                  type="button"
                  onClick={() => onEvidence(value)}
                  className="min-w-0 break-words text-left text-teal-800 underline-offset-2 hover:underline"
                >
                  {value}
                </button>
              ) : (
                <span className="break-words text-slate-900">{value}</span>
              )}
              {onMove ? (
                <button
                  type="button"
                  title={`Move this ${label.toLowerCase()} to another organization or contact`}
                  aria-label={`Move ${label.toLowerCase()} “${value}”`}
                  disabled={disabled}
                  onClick={() => onMove(value)}
                  className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-teal-700 disabled:opacity-50"
                >
                  <MoveIcon className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                title={`Stop associating this ${label.toLowerCase()}`}
                aria-label={`Sever ${label.toLowerCase()} “${value}”`}
                disabled={disabled}
                onClick={() => onSever(value)}
                className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
              >
                <SeverIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function orgSubtitle(org: OrgFingerprintSummary): string {
  const parts: string[] = [];
  if (org.organization_role?.trim()) parts.push(org.organization_role.trim());
  const emails = splitOrgMultiValue(org.email);
  if (emails[0]) parts.push(emails[0]);
  const phones = splitOrgMultiValue(org.phone);
  if (phones[0]) parts.push(phones[0]);
  return parts.join(" · ");
}

function orgToMergeOption(org: OrgFingerprintSummary): MergeEntityOption {
  const searchParts = [
    org.displayName,
    org.name,
    ...(org.aliases ?? []),
    org.organization_role,
    ...splitOrgMultiValue(org.email),
    ...splitOrgMultiValue(org.phone),
    ...splitOrgMultiValue(org.phone).map((phone) => phone.replace(/\D/g, "")),
    ...splitOrgMultiValue(org.website),
  ];
  return {
    id: org.id,
    displayName: org.displayName,
    subtitle: orgSubtitle(org) || null,
    searchText: searchParts
      .filter(Boolean)
      .join("\n")
      .toLowerCase(),
  };
}

function personToMergeOption(person: ContactRegistryPersonSummary): MergeEntityOption {
  const displayName = personDisplayName(person);
  const emails = person.emails.map((row) => row.email);
  const searchParts = [
    displayName,
    person.firstName,
    person.lastName,
    ...person.nameAliases,
    ...emails,
    ...person.phones.map((row) => row.phone),
  ];
  return {
    id: `person:${person.id}`,
    displayName,
    subtitle: `Person${emails[0] ? ` · ${emails[0]}` : ""}`,
    searchText: searchParts.filter(Boolean).join("\n").toLowerCase(),
    rankHint: person.sourceEmailCount,
  };
}

/** Local fold so the UI updates before the slow registry reload finishes. */
function foldOrgSummariesLocally(
  target: OrgFingerprintSummary,
  sources: OrgFingerprintSummary[],
): OrgFingerprintSummary {
  let folded = target;
  for (const source of sources) {
    if (source.id === target.id) continue;
    const foldedNames = foldOrgNames({
      preferredName: folded.name,
      otherName: source.name,
      preferredAliases: folded.aliases,
      otherAliases: source.aliases,
    });
    folded = {
      ...folded,
      name: foldedNames.name,
      aliases: foldedNames.aliases,
      organization_role:
        folded.organization_role?.trim() ||
        source.organization_role?.trim() ||
        null,
      email: mergeOrgMultiValues("email", folded.email, source.email),
      phone: mergeOrgMultiValues("phone", folded.phone, source.phone),
      website: mergeOrgMultiValues("website", folded.website, source.website),
      displayName: foldedNames.name?.trim() || folded.displayName,
      sourceMergeCount: folded.sourceMergeCount + source.sourceMergeCount,
      sourceEmailCount: folded.sourceEmailCount + source.sourceEmailCount,
      modelIds: [...new Set([...folded.modelIds, ...source.modelIds])],
    };
  }
  return folded;
}

function applyOptimisticOrgFieldMove(params: {
  organizations: OrgFingerprintSummary[];
  sourceId: string;
  targetId: string;
  field: "email" | "phone" | "website" | "name_alias";
  value: string;
}): {
  organizations: OrgFingerprintSummary[];
  target: OrgFingerprintSummary | null;
} {
  const source = params.organizations.find((org) => org.id === params.sourceId);
  const target = params.organizations.find((org) => org.id === params.targetId);
  if (!source || !target || source.id === target.id) {
    return { organizations: params.organizations, target: target ?? null };
  }

  let nextSource: OrgFingerprintSummary = {
    ...source,
    aliases: [...(source.aliases ?? [])],
  };
  let nextTarget: OrgFingerprintSummary = {
    ...target,
    aliases: [...(target.aliases ?? [])],
  };
  const value = params.value.trim();

  if (params.field === "name_alias") {
    const valueKey = value.toLowerCase();
    nextSource = {
      ...nextSource,
      aliases: mergeOrgAliasLists(
        nextSource.name,
        nextSource.aliases.filter((alias) => alias.trim().toLowerCase() !== valueKey),
      ),
    };
    nextTarget = {
      ...nextTarget,
      aliases: mergeOrgAliasLists(nextTarget.name, nextTarget.aliases, [value]),
    };
  } else {
    nextSource = {
      ...nextSource,
      [params.field]: removeOrgMultiValue(params.field, nextSource[params.field], value),
    };
    nextTarget = {
      ...nextTarget,
      [params.field]: mergeOrgMultiValues(params.field, nextTarget[params.field], value),
    };
  }

  return {
    organizations: params.organizations.map((org) => {
      if (org.id === nextSource.id) return nextSource;
      if (org.id === nextTarget.id) return nextTarget;
      return org;
    }),
    target: nextTarget,
  };
}

function applyOptimisticOrgMerge(params: {
  organizations: OrgFingerprintSummary[];
  duplicateGroups: OrgDuplicateGroup[];
  targetId: string;
  sourceIds: string[];
}): {
  organizations: OrgFingerprintSummary[];
  duplicateGroups: OrgDuplicateGroup[];
  survivor: OrgFingerprintSummary | null;
} {
  const sourceIdSet = new Set(
    params.sourceIds.filter((id) => id && id !== params.targetId),
  );
  const targetFromList = params.organizations.find(
    (org) => org.id === params.targetId,
  );
  const targetFromGroups = params.duplicateGroups
    .flatMap((g) => g.members)
    .find((m) => m.id === params.targetId);
  const target = targetFromList ?? targetFromGroups ?? null;
  if (!target || sourceIdSet.size === 0) {
    return {
      organizations: params.organizations,
      duplicateGroups: params.duplicateGroups,
      survivor: target,
    };
  }
  const sources = params.organizations.filter((org) => sourceIdSet.has(org.id));
  // Also pull sources that only exist inside duplicate groups.
  const fromGroups: OrgFingerprintSummary[] = [];
  for (const group of params.duplicateGroups) {
    for (const member of group.members) {
      if (sourceIdSet.has(member.id) && !sources.some((s) => s.id === member.id)) {
        fromGroups.push(member);
      }
    }
  }
  const survivor = foldOrgSummariesLocally(target, [...sources, ...fromGroups]);
  const removedIds = new Set(sourceIdSet);
  const withoutSources = params.organizations.filter(
    (org) => !removedIds.has(org.id),
  );
  const organizations = withoutSources.some((org) => org.id === survivor.id)
    ? withoutSources.map((org) => (org.id === survivor.id ? survivor : org))
    : [survivor, ...withoutSources];

  const duplicateGroups: OrgDuplicateGroup[] = [];
  for (const group of params.duplicateGroups) {
    const members = group.members
      .filter((m) => !removedIds.has(m.id))
      .map((m) =>
        m.id === survivor.id
          ? { ...survivor, nameless: !(survivor.name?.trim() || survivor.aliases?.length) }
          : m,
      );
    // Ensure survivor stays in the group if it was a member or absorbed one.
    const groupTouched =
      group.members.some((m) => m.id === survivor.id || removedIds.has(m.id));
    if (groupTouched && !members.some((m) => m.id === survivor.id)) {
      members.push({
        ...survivor,
        nameless: !(survivor.name?.trim() || survivor.aliases?.length),
      });
    }
    if (members.length < 2) continue;
    const sortedIds = [...members.map((m) => m.id)].sort();
    duplicateGroups.push({
      ...group,
      id: groupTouched ? `fuzzy:${sortedIds.join("|")}` : group.id,
      label: groupTouched
        ? (members.find((m) => m.id === survivor.id)?.displayName ??
          group.label)
        : group.label,
      memberCount: members.length,
      members,
    });
  }

  return { organizations, duplicateGroups, survivor };
}

type PendingSever = {
  field: OrgDeniableField;
  label: string;
  value: string;
};

type PendingMove = {
  field: "email" | "phone" | "website" | "name_alias";
  label: string;
  value: string;
};

export function OrganizationsRegistryClient({
  initialOrganizations,
  initialStats,
}: {
  initialOrganizations: OrgFingerprintSummary[];
  initialStats: OrgFingerprintListStats;
}) {
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [stats, setStats] = useState(initialStats);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialOrganizations[0]?.id ?? null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mergeSources, setMergeSources] = useState<OrgFingerprintSummary[]>([]);
  const [mergeCandidatePool, setMergeCandidatePool] = useState<
    OrgFingerprintSummary[]
  >([]);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [checkedOrgIds, setCheckedOrgIds] = useState<Set<string>>(new Set());
  const [pendingSever, setPendingSever] = useState<PendingSever | null>(null);
  const [severError, setSeverError] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [peopleMoveOptions, setPeopleMoveOptions] = useState<MergeEntityOption[]>(
    [],
  );
  const [evidenceTarget, setEvidenceTarget] = useState<{
    organizationId: string;
    organizationName: string;
    field: OrgEvidenceField;
    value: string;
  } | null>(null);
  const [orgSort, setOrgSort] = useState<OrgFingerprintListSort>("mentions-desc");
  const [tab, setTab] = useState<"organizations" | "duplicates">(
    "organizations",
  );
  const duplicatesLoaded = useRef(false);
  const [duplicateGroups, setDuplicateGroups] = useState<OrgDuplicateGroup[]>(
    [],
  );
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string | null>(null);
  const [listSearchOpen, setListSearchOpen] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [listPage, setListPage] = useState(1);
  const listSearchInputRef = useRef<HTMLInputElement>(null);

  const sortedOrganizations = useMemo(
    () => sortOrgFingerprintSummaries(organizations, orgSort),
    [organizations, orgSort],
  );

  const filteredOrganizations = useMemo(() => {
    const query = listSearch.trim().toLowerCase();
    if (!query) return sortedOrganizations;
    return sortedOrganizations.filter((org) =>
      org.displayName.toLowerCase().includes(query),
    );
  }, [sortedOrganizations, listSearch]);

  const pagedOrganizations = useMemo(
    () => sliceEntityListPage(filteredOrganizations, listPage),
    [filteredOrganizations, listPage],
  );

  useEffect(() => {
    setListPage((page) => clampEntityListPage(page, filteredOrganizations.length));
  }, [filteredOrganizations.length]);

  useEffect(() => {
    if (listSearchOpen) listSearchInputRef.current?.focus();
  }, [listSearchOpen]);

  useEffect(() => {
    if (!pendingMove) return;
    if (peopleMoveOptions.length > 0) return;
    let cancelled = false;
    fetch("/api/contacts/registry?limit=2000&skipVerifiedMentions=1")
      .then(async (response) => {
        const data = (await response.json()) as {
          persons?: ContactRegistryPersonSummary[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error ?? "Could not load people.");
        }
        return data.persons ?? [];
      })
      .then((persons) => {
        if (!cancelled) setPeopleMoveOptions(persons.map(personToMergeOption));
      })
      .catch(() => {
        if (!cancelled) setPeopleMoveOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingMove, peopleMoveOptions.length]);

  const checkedCount = checkedOrgIds.size;
  const allVisibleSelected =
    pagedOrganizations.length > 0 &&
    pagedOrganizations.every((org) => checkedOrgIds.has(org.id));

  const selected = useMemo(
    () => organizations.find((org) => org.id === selectedId) ?? null,
    [organizations, selectedId],
  );

  function toggleOrgChecked(orgId: string, checked: boolean) {
    setCheckedOrgIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orgId);
      else next.delete(orgId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setCheckedOrgIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const org of pagedOrganizations) next.delete(org.id);
      } else {
        for (const org of pagedOrganizations) next.add(org.id);
      }
      return next;
    });
  }

  function openBulkMerge() {
    const selectedOrgs = organizations.filter((org) => checkedOrgIds.has(org.id));
    if (selectedOrgs.length < 2) return;
    setMergeError(null);
    setMergeSources(selectedOrgs);
    setMergeCandidatePool(organizations);
  }

  async function refreshData(): Promise<OrgFingerprintSummary[] | null> {
    const res = await fetch("/api/organizations/registry", {
      cache: "no-store",
    });
    const json = (await res.json()) as {
      organizations?: OrgFingerprintSummary[];
      stats?: OrgFingerprintListStats;
      error?: string;
    };
    if (!res.ok) {
      setMessage(json.error ?? "Failed to refresh organizations.");
      return null;
    }
    const next = json.organizations ?? [];
    setOrganizations(next);
    if (json.stats) setStats(json.stats);
    setSelectedId((prev) => {
      if (prev && next.some((org) => org.id === prev)) return prev;
      return next[0]?.id ?? null;
    });
    return next;
  }

  async function loadDuplicates(): Promise<void> {
    setDuplicatesLoading(true);
    setDuplicatesError(null);
    try {
      const res = await fetch("/api/organizations/registry?view=duplicates", {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        groups?: OrgDuplicateGroup[];
        error?: string;
      };
      if (!res.ok) {
        setDuplicatesError(
          json.error ?? "Failed to load duplicate groups.",
        );
        return;
      }
      setDuplicateGroups(json.groups ?? []);
      duplicatesLoaded.current = true;
    } catch {
      setDuplicatesError("Failed to load duplicate groups.");
    } finally {
      setDuplicatesLoading(false);
    }
  }

  function openDuplicatesTab() {
    setTab("duplicates");
    if (!duplicatesLoaded.current) {
      startTransition(async () => {
        await loadDuplicates();
      });
    }
  }

  function refresh() {
    startTransition(async () => {
      setMessage(null);
      await refreshData();
      if (tab === "duplicates" || duplicatesLoaded.current) {
        await loadDuplicates();
      }
    });
  }

  function openDuplicateMerge(members: OrgDuplicateGroupMember[]) {
    if (members.length === 0) return;
    setMergeError(null);
    setMergeSources(members);
    const byId = new Map(organizations.map((org) => [org.id, org]));
    for (const member of members) byId.set(member.id, member);
    const group = duplicateGroups.find((g) =>
      members.every((m) => g.members.some((gm) => gm.id === m.id)),
    );
    if (group) {
      for (const member of group.members) byId.set(member.id, member);
    }
    setMergeCandidatePool([...byId.values()]);
  }

  function mergeAllDuplicatesInto(
    target: OrgDuplicateGroupMember,
    sources: OrgDuplicateGroupMember[],
  ) {
    if (sources.length === 0) return;
    setMergeError(null);
    runMerge(target.id, sources, target.displayName);
  }

  function changeOrgSort(next: OrgFingerprintListSort) {
    if (next === orgSort) return;
    setOrgSort(next);
    setCheckedOrgIds(new Set());
    setListPage(1);
  }

  function runMerge(
    targetOrganizationId: string,
    sourceOverride?: OrgFingerprintSummary[],
    targetDisplayName?: string,
  ) {
    const sources = sourceOverride ?? mergeSources;
    if (sources.length === 0) return;
    const sourceIds = sources.map((org) => org.id);
    const targetNameHint =
      targetDisplayName ??
      organizations.find((org) => org.id === targetOrganizationId)
        ?.displayName ??
      sources.find((org) => org.id === targetOrganizationId)?.displayName ??
      "organization";

    startTransition(async () => {
      setMergeError(null);
      setMessage(null);
      const res = await fetch("/api/organizations/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge",
          sourceOrganizationIds: sourceIds,
          targetOrganizationId,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        survivorId?: string;
        merged?: number;
        error?: string;
      };
      if (!res.ok) {
        setMergeError(json.error ?? "Merge failed.");
        return;
      }
      setMergeSources([]);
      setMergeCandidatePool([]);
      setCheckedOrgIds(new Set());

      const survivorId = json.survivorId ?? targetOrganizationId;
      const mergedCount = json.merged ?? sources.length;

      // Instant UI update — don't block on the expensive registry reload.
      const optimistic = applyOptimisticOrgMerge({
        organizations,
        duplicateGroups,
        targetId: survivorId,
        sourceIds,
      });
      setOrganizations(optimistic.organizations);
      setDuplicateGroups(optimistic.duplicateGroups);
      setStats((prev) => ({
        ...prev,
        organizationCount: optimistic.organizations.length,
      }));
      setSelectedId(survivorId);
      setMessage(
        `Merged ${mergedCount} organization${mergedCount === 1 ? "" : "s"} into “${
          optimistic.survivor?.displayName ?? targetNameHint
        }”.`,
      );

      // Reconcile with server in the background.
      void (async () => {
        await refreshData();
        if (tab === "duplicates" || duplicatesLoaded.current) {
          await loadDuplicates();
        }
      })();
    });
  }

  function confirmSeverField() {
    if (!selected || !pendingSever) return;
    const org = selected;
    const sever = pendingSever;
    startTransition(async () => {
      setSeverError(null);
      setMessage(null);
      const res = await fetch("/api/organizations/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deny_field",
          organizationId: org.id,
          field: sever.field,
          value: sever.value,
          organizationName: org.name ?? org.displayName,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setSeverError(json.error ?? "Could not sever association.");
        return;
      }
      setPendingSever(null);
      setMessage(
        `Stopped associating ${sever.label.toLowerCase()} “${sever.value}” with “${org.displayName}”.`,
      );
      const next = await refreshData();
      if (next) {
        const byName = next.find(
          (o) =>
            (o.name ?? o.displayName).toLowerCase() ===
            (org.name ?? org.displayName).toLowerCase(),
        );
        if (byName) setSelectedId(byName.id);
      }
    });
  }

  function confirmMoveField(targetId: string) {
    if (!selected || !pendingMove) return;
    const org = selected;
    const move = pendingMove;
    if (targetId.startsWith("person:")) {
      const personId = targetId.slice("person:".length);
      const personOption = peopleMoveOptions.find((item) => item.id === targetId);
      startTransition(async () => {
        setMoveError(null);
        setMessage(null);
        const res = await fetch("/api/organizations/registry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "move_field_to_person",
            sourceOrganizationId: org.id,
            targetPersonId: personId,
            field: move.field,
            value: move.value,
            sourceOrganizationName: org.name ?? org.displayName,
          }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          setMoveError(json.error ?? "Could not move that value.");
          return;
        }
        const stripped = organizations.map((item) => {
          if (item.id !== org.id) return item;
          if (move.field === "name_alias") {
            const valueKey = move.value.trim().toLowerCase();
            return {
              ...item,
              aliases: mergeOrgAliasLists(
                item.name,
                (item.aliases ?? []).filter(
                  (alias) => alias.trim().toLowerCase() !== valueKey,
                ),
              ),
            };
          }
          return {
            ...item,
            [move.field]: removeOrgMultiValue(
              move.field,
              item[move.field],
              move.value,
            ),
          };
        });
        setOrganizations(stripped);
        setPendingMove(null);
        setMessage(
          json.message ??
            `Moved ${move.label.toLowerCase()} “${move.value}” onto ${personOption?.displayName ?? "the contact"}.`,
        );
        await refreshData();
      });
      return;
    }
    const target = organizations.find((item) => item.id === targetId);
    if (!target) {
      setMoveError("Pick an organization or person from the search results.");
      return;
    }
    startTransition(async () => {
      setMoveError(null);
      setMessage(null);
      const res = await fetch("/api/organizations/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "move_field",
          sourceOrganizationId: org.id,
          targetOrganizationId: target.id,
          field: move.field,
          value: move.value,
          sourceOrganizationName: org.name ?? org.displayName,
          targetOrganizationName: target.name ?? target.displayName,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setMoveError(json.error ?? "Could not move that value.");
        return;
      }
      const optimistic = applyOptimisticOrgFieldMove({
        organizations,
        sourceId: org.id,
        targetId: target.id,
        field: move.field,
        value: move.value,
      });
      setOrganizations(optimistic.organizations);
      setPendingMove(null);
      setMessage(
        `Moved ${move.label.toLowerCase()} “${move.value}” from “${org.displayName}” to “${target.displayName}”.`,
      );
      const next = await refreshData();
      if (next) {
        const byName = next.find(
          (o) =>
            (o.name ?? o.displayName).toLowerCase() ===
            (target.name ?? target.displayName).toLowerCase(),
        );
        if (byName) setSelectedId(byName.id);
      }
    });
  }

  return (
    <div>
      <header className="mb-6">
        <dl className="flex flex-wrap gap-6 text-sm text-slate-700">
          <div>
            <dt className="text-slate-500">Organizations</dt>
            <dd className="font-semibold">{stats.organizationCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Thread merges</dt>
            <dd className="font-semibold">{stats.mergeCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Source emails</dt>
            <dd className="font-semibold">{stats.emailCount}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-slate-600">
          Unique organizations from extraction pass 4 (thread merges),
          coalesced across threads by email and name. Use the merge icon to
          fold duplicates by hand — the absorbed name is kept as an alias, and
          emails / phones / websites are combined. Use the arrow on a field to
          move that value to another organization without merging cards. Moving
          an alias takes the source emails harvested under that name with it
          (including aliases you already moved). Use × to sever a wrong
          association; the system remembers not to reattach it. Check the
          Duplicates tab for fuzzy name matches (Inc / Ltd / spelling variants).
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={refresh}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        {message ? (
          <p className="mt-3 text-sm text-slate-600" role="status">
            {message}
          </p>
        ) : null}
      </header>

      <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-200 pb-2 text-sm">
        {(
          [
            ["organizations", "Organizations"],
            ["duplicates", "Duplicates"],
          ] as const
        ).map(([id, label]) => {
          const count =
            id === "organizations"
              ? stats.organizationCount
              : duplicateGroups.length;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (id === "duplicates") openDuplicatesTab();
                else setTab(id);
              }}
              className={
                tab === id
                  ? "rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white"
                  : "rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100"
              }
            >
              {label}
              {count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {tab === "duplicates" ? (
        <OrganizationDuplicatesPanel
          groups={duplicateGroups}
          loading={duplicatesLoading}
          error={duplicatesError}
          pending={pending}
          onRefresh={() => {
            startTransition(async () => {
              await loadDuplicates();
            });
          }}
          onOpenMerge={openDuplicateMerge}
          onMergeAllInto={mergeAllDuplicatesInto}
        />
      ) : (
      <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="flex max-h-[70vh] flex-col overflow-hidden border border-slate-200 bg-white">
          {sortedOrganizations.length > 0 ? (
            <OrgListSortMenu value={orgSort} onChange={changeOrgSort} />
          ) : null}
          {sortedOrganizations.length > 0 ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
              <label className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  disabled={pending}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-fuchsia-700 focus:ring-fuchsia-500"
                />
                <span className="truncate">Select visible</span>
              </label>
              {checkedCount > 0 ? (
                <span className="min-w-0 truncate text-xs text-slate-500">
                  {checkedCount} selected
                </span>
              ) : null}
              <div className="ml-auto flex shrink-0 items-center">
                {checkedCount > 0 ? (
                  <>
                    <button
                      type="button"
                      disabled={pending || checkedCount < 2}
                      onClick={openBulkMerge}
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
                      className="rounded p-1.5 text-slate-500 hover:bg-fuchsia-50 hover:text-fuchsia-700 disabled:opacity-50"
                    >
                      <MergeIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setCheckedOrgIds(new Set())}
                      title="Clear selection"
                      aria-label="Clear selection"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                    >
                      <ClearSelectionIcon className="h-4 w-4" />
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => setListSearchOpen((prev) => !prev)}
                  title="Search organizations"
                  aria-label="Search organizations"
                  aria-expanded={listSearchOpen}
                  className={
                    listSearchOpen
                      ? "rounded p-1.5 text-fuchsia-700 bg-fuchsia-50"
                      : "rounded p-1.5 text-slate-500 hover:bg-fuchsia-50 hover:text-fuchsia-700"
                  }
                >
                  <ListSearchIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
          {listSearchOpen && sortedOrganizations.length > 0 ? (
            <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">
              <input
                ref={listSearchInputRef}
                type="search"
                value={listSearch}
                onChange={(event) => {
                  setListSearch(event.target.value);
                  setListPage(1);
                }}
                placeholder="Filter by name…"
                aria-label="Filter organizations by name"
                className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-fuchsia-600 focus:outline-none focus:ring-1 focus:ring-fuchsia-600"
              />
            </div>
          ) : null}
          <ul className="overflow-y-auto">
          {sortedOrganizations.length === 0 ? (
            <li className="p-4 text-sm text-slate-500">
              No organizations yet. Select threads on Emails and run{" "}
              <span className="font-medium text-slate-700">
                Extract Organizations
              </span>{" "}
              (all 4 passes).
            </li>
          ) : filteredOrganizations.length === 0 ? (
            <li className="p-4 text-sm text-slate-500">
              No organizations match your search.
            </li>
          ) : (
            pagedOrganizations.map((org) => (
              <li key={org.id}>
                <div
                  className={
                    selectedId === org.id
                      ? "flex items-stretch border-b border-slate-100 bg-fuchsia-50"
                      : checkedOrgIds.has(org.id)
                        ? "flex items-stretch border-b border-slate-100 bg-slate-100"
                        : "flex items-stretch border-b border-slate-100 hover:bg-slate-50"
                  }
                >
                  <label className="flex shrink-0 items-center self-stretch pl-3">
                    <input
                      type="checkbox"
                      checked={checkedOrgIds.has(org.id)}
                      disabled={pending}
                      onChange={(e) =>
                        toggleOrgChecked(org.id, e.target.checked)
                      }
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${org.displayName}`}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-fuchsia-700 focus:ring-fuchsia-500"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setSelectedId(org.id)}
                    className="min-w-0 flex-1 px-2 py-2 text-left"
                  >
                    <span className="block text-sm font-medium text-slate-900">
                      {org.displayName}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {org.organization_role?.trim()
                        ? org.organization_role
                        : "No role"}
                      {org.sourceEmailCount > 0
                        ? ` · ${org.sourceEmailCount} email${org.sourceEmailCount === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    title={`Merge ${org.displayName} into another organization`}
                    aria-label={`Merge ${org.displayName} into another organization`}
                    disabled={pending}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMergeError(null);
                      setMergeSources([org]);
                      setMergeCandidatePool(organizations);
                    }}
                    className="shrink-0 self-center px-2.5 py-2 text-slate-400 hover:text-fuchsia-700 disabled:opacity-50"
                  >
                    <MergeIcon className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))
          )}
          </ul>
          <EntityListPagination
            total={filteredOrganizations.length}
            page={listPage}
            pending={pending}
            onPageChange={setListPage}
            ariaLabel="Organizations list pagination"
          />
        </div>

        <section className="border border-slate-200 bg-white p-4">
          {!selected ? (
            <p className="text-sm text-slate-500">Select an organization.</p>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-slate-900">
                {selected.displayName}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {selected.sourceMergeCount > 0
                  ? `${selected.sourceMergeCount} thread merge${selected.sourceMergeCount === 1 ? "" : "s"}`
                  : "From pass-3 fingerprints (no merge yet)"}
                {selected.sourceEmailCount > 0
                  ? ` · ${selected.sourceEmailCount} source email${selected.sourceEmailCount === 1 ? "" : "s"}`
                  : ""}
              </p>

              <dl className="mt-5 space-y-1.5">
                <FieldRow
                  label="Name"
                  value={selected.name}
                  disabled={pending}
                  onEvidence={() => {
                    if (!selected.name?.trim()) return;
                    setEvidenceTarget({
                      organizationId: selected.id,
                      organizationName: selected.displayName,
                      field: "name",
                      value: selected.name.trim(),
                    });
                  }}
                  onSever={() => {
                    if (!selected.name?.trim()) return;
                    setSeverError(null);
                    setPendingSever({
                      field: "name",
                      label: "Name",
                      value: selected.name.trim(),
                    });
                  }}
                />
                <MultiValueField
                  label="Also known as"
                  values={selected.aliases ?? []}
                  disabled={pending}
                  onEvidence={(value) => {
                    setEvidenceTarget({
                      organizationId: selected.id,
                      organizationName: selected.displayName,
                      field: "name_alias",
                      value,
                    });
                  }}
                  onMove={(value) => {
                    setMoveError(null);
                    setPendingMove({
                      field: "name_alias",
                      label: "Alias",
                      value,
                    });
                  }}
                  onSever={(value) => {
                    setSeverError(null);
                    setPendingSever({
                      field: "name_alias",
                      label: "Alias",
                      value,
                    });
                  }}
                />
                <FieldRow
                  label="Role"
                  value={selected.organization_role}
                  disabled={pending}
                  onEvidence={() => {
                    if (!selected.organization_role?.trim()) return;
                    setEvidenceTarget({
                      organizationId: selected.id,
                      organizationName: selected.displayName,
                      field: "organization_role",
                      value: selected.organization_role.trim(),
                    });
                  }}
                  onSever={() => {
                    if (!selected.organization_role?.trim()) return;
                    setSeverError(null);
                    setPendingSever({
                      field: "organization_role",
                      label: "Role",
                      value: selected.organization_role.trim(),
                    });
                  }}
                />
                <MultiValueField
                  label="Email"
                  values={splitOrgMultiValue(selected.email)}
                  disabled={pending}
                  onEvidence={(value) => {
                    setEvidenceTarget({
                      organizationId: selected.id,
                      organizationName: selected.displayName,
                      field: "email",
                      value,
                    });
                  }}
                  onMove={(value) => {
                    setMoveError(null);
                    setPendingMove({
                      field: "email",
                      label: "Email",
                      value,
                    });
                  }}
                  onSever={(value) => {
                    setSeverError(null);
                    setPendingSever({
                      field: "email",
                      label: "Email",
                      value,
                    });
                  }}
                />
                <MultiValueField
                  label="Phone"
                  values={splitOrgMultiValue(selected.phone)}
                  disabled={pending}
                  onEvidence={(value) => {
                    setEvidenceTarget({
                      organizationId: selected.id,
                      organizationName: selected.displayName,
                      field: "phone",
                      value,
                    });
                  }}
                  onMove={(value) => {
                    setMoveError(null);
                    setPendingMove({
                      field: "phone",
                      label: "Phone",
                      value,
                    });
                  }}
                  onSever={(value) => {
                    setSeverError(null);
                    setPendingSever({
                      field: "phone",
                      label: "Phone",
                      value,
                    });
                  }}
                />
                <MultiValueField
                  label="Website"
                  values={splitOrgMultiValue(selected.website)}
                  disabled={pending}
                  onEvidence={(value) => {
                    setEvidenceTarget({
                      organizationId: selected.id,
                      organizationName: selected.displayName,
                      field: "website",
                      value,
                    });
                  }}
                  onMove={(value) => {
                    setMoveError(null);
                    setPendingMove({
                      field: "website",
                      label: "Website",
                      value,
                    });
                  }}
                  onSever={(value) => {
                    setSeverError(null);
                    setPendingSever({
                      field: "website",
                      label: "Website",
                      value,
                    });
                  }}
                />
              </dl>

              {selected.modelIds.length > 0 ? (
                <p className="mt-5 text-xs text-slate-500">
                  Models: {selected.modelIds.join(", ")}
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
      )}

      <MergeEntityDialog
        open={mergeSources.length > 0}
        entityLabel="organization"
        sources={mergeSources.map(orgToMergeOption)}
        candidates={(mergeCandidatePool.length > 0
          ? mergeCandidatePool
          : organizations
        ).map(orgToMergeOption)}
        searchPlaceholder="Search by name, email, phone, or website…"
        busy={pending}
        error={mergeError}
        onClose={() => {
          if (pending) return;
          setMergeSources([]);
          setMergeCandidatePool([]);
          setMergeError(null);
        }}
        onMerge={runMerge}
      />

      <MergeEntityDialog
        open={pendingMove != null && selected != null}
        entityLabel="destination"
        sources={selected ? [orgToMergeOption(selected)] : []}
        candidates={[
          ...organizations.map(orgToMergeOption),
          ...(pendingMove?.field === "website" ? [] : peopleMoveOptions),
        ]}
        searchPlaceholder="Search organizations or people…"
        busy={pending}
        error={moveError}
        copy={
          pendingMove && selected
            ? {
                title: `Move ${pendingMove.label.toLowerCase()}`,
                description: `Move ${pendingMove.label.toLowerCase()} “${pendingMove.value}” from “${selected.displayName}” to another organization or a contact. Harvest emails that used that name as the organization name move with an alias. The source card keeps its other fields.`,
                submitLabel: "Move",
                busyLabel: "Moving…",
                intoLabel: "Move to",
                hideSources: true,
                pickError:
                  "Pick an organization or person from the search results to move to.",
              }
            : undefined
        }
        onClose={() => {
          if (pending) return;
          setPendingMove(null);
          setMoveError(null);
        }}
        onMerge={confirmMoveField}
      />

      <ConfirmDialog
        open={pendingSever != null && selected != null}
        title="Sever association?"
        description={
          pendingSever && selected ? (
            <div className="space-y-2">
              <p>
                Stop associating{" "}
                <span className="font-medium text-slate-800">
                  {pendingSever.label.toLowerCase()} “{pendingSever.value}”
                </span>{" "}
                with{" "}
                <span className="font-medium text-slate-800">
                  {selected.displayName}
                </span>
                ?
              </p>
              <p>
                The system will remember this and will not reattach that value
                to this organization on future extractions.
              </p>
              {severError ? (
                <p className="text-sm text-red-600" role="alert">
                  {severError}
                </p>
              ) : null}
            </div>
          ) : null
        }
        confirmLabel="OK"
        cancelLabel="Cancel"
        busy={pending}
        busyLabel="Saving…"
        onConfirm={confirmSeverField}
        onCancel={() => {
          if (pending) return;
          setPendingSever(null);
          setSeverError(null);
        }}
      />

      <OrgEvidenceSidePanel
        target={evidenceTarget}
        onClose={() => setEvidenceTarget(null)}
      />
    </div>
  );
}
