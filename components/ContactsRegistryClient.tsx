"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AffiliationMatchingQueue } from "@/components/AffiliationMatchingQueue";
import { ContactDuplicatesPanel } from "@/components/ContactDuplicatesPanel";
import { ContactEvidenceSidePanel } from "@/components/ContactEvidenceSidePanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PersonAffiliationsPanel } from "@/components/PersonAffiliationsPanel";
import {
  MergeEntityDialog,
  MergeIcon,
  type MergeEntityOption,
} from "@/components/MergeEntityDialog";
import type {
  ContactDuplicateGroup,
  ContactDuplicateGroupMember,
} from "@/lib/contacts/duplicate-groups";
import {
  CONTACT_PERSONS_PAGE_SIZE,
  type ContactPersonListSort,
  type ContactRegistryPersonSummary,
} from "@/lib/contacts/registry-shared";
import type { ContactEvidenceKind } from "@/lib/contacts/registry-evidence-shared";
import type {
  ContactEmailIndexRow,
  ContactMergeActivityRow,
} from "@/lib/contacts/registry-load";
import type { ContactDeniableField } from "@/lib/contacts/field-denials";

type PersonRow = ContactRegistryPersonSummary & { displayName: string };

type PersonListSort = ContactPersonListSort;

/** Full-registry fetch for merge-target search (People list is paginated at 100). */
const MERGE_CANDIDATE_FETCH_LIMIT = 2000;

const PERSON_LIST_SORT_OPTIONS: Array<{ value: PersonListSort; label: string }> =
  [
    { value: "mentions-desc", label: "Mentions (high → low)" },
    { value: "mentions-asc", label: "Mentions (low → high)" },
    { value: "name-asc", label: "Name (A → Z)" },
    { value: "name-desc", label: "Name (Z → A)" },
  ];

function PersonListSortMenu({
  value,
  onChange,
}: {
  value: PersonListSort;
  onChange: (next: PersonListSort) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const currentLabel =
    PERSON_LIST_SORT_OPTIONS.find((option) => option.value === value)?.label ??
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
        aria-label={`Sort contacts: ${currentLabel}`}
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
          aria-label="Contact sort options"
          className="absolute left-0 right-0 top-full z-20 border border-slate-200 bg-white py-1 shadow-lg"
        >
          {PERSON_LIST_SORT_OPTIONS.map((option) => {
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

function personSubtitle(person: PersonRow): string {
  const parts: string[] = [
    `${person.sourceEmailCount} mention${person.sourceEmailCount === 1 ? "" : "s"}`,
  ];
  if (person.emails[0]?.email) parts.push(person.emails[0].email);
  if (person.phones[0]?.phone) parts.push(person.phones[0].phone);
  if (person.sparseStub) parts.push("stub");
  return parts.join(" · ");
}

function personToMergeOption(person: PersonRow): MergeEntityOption {
  return {
    id: person.id,
    displayName: person.displayName,
    subtitle: personSubtitle(person) || null,
    rankHint: person.sourceEmailCount,
    searchText: [
      person.displayName,
      person.firstName,
      person.lastName,
      ...person.nameAliases,
      ...person.emails.map((e) => e.email),
      ...person.phones.map((p) => p.phone),
      ...person.phones.map((p) => p.phoneNormalized),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase(),
  };
}

type Stats = {
  personCount: number;
  emailCount: number;
  sparseStubCount: number;
  pendingMergeCount: number;
  mergeDecisionCount?: number;
  ingestCompletedCount?: number;
};

type ResolveResult = {
  email: string;
  at: string;
  personId: string | null;
  displayName: string | null;
  validFrom: string | null;
  validTo: string | null;
  usedCurrentFallback: boolean;
};

type PendingSever = {
  field: ContactDeniableField;
  label: string;
  value: string;
};

function formatRange(from: string | null, to: string | null): string {
  const a = from?.slice(0, 10) ?? "…";
  const b = to?.slice(0, 10) ?? "present";
  return `${a} → ${b}`;
}

export function ContactsRegistryClient({
  initialPersons,
  initialEmails,
  initialStats,
  initialActivity = [],
}: {
  initialPersons: PersonRow[];
  initialEmails: ContactEmailIndexRow[];
  initialStats: Stats;
  initialActivity?: ContactMergeActivityRow[];
}) {
  const [tab, setTab] = useState<
    | "persons"
    | "link_orgs"
    | "duplicates"
    | "emails"
    | "activity"
    | "resolve"
  >("persons");
  const [persons, setPersons] = useState(initialPersons);
  const [emails, setEmails] = useState(initialEmails);
  const [activity, setActivity] = useState(initialActivity);
  const [stats, setStats] = useState(initialStats);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(
    initialPersons[0]?.id ?? null,
  );
  const [selectedEmail, setSelectedEmail] = useState<string | null>(
    initialEmails[0]?.email ?? null,
  );
  const [resolveEmail, setResolveEmail] = useState("");
  const [resolveAt, setResolveAt] = useState("");
  const [resolveResult, setResolveResult] = useState<ResolveResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const autoBackfillStarted = useRef(false);
  const autoCoalesceStarted = useRef(false);
  const duplicatesLoaded = useRef(false);
  const [evidenceTarget, setEvidenceTarget] = useState<{
    kind: ContactEvidenceKind;
    attributeId: string;
    label: string;
  } | null>(null);
  const [mergeSources, setMergeSources] = useState<PersonRow[]>([]);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeCandidatePool, setMergeCandidatePool] = useState<PersonRow[]>([]);
  const mergeDialogOpenRef = useRef(false);
  const [checkedPersonIds, setCheckedPersonIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [personSort, setPersonSort] = useState<PersonListSort>("mentions-desc");
  const [personPage, setPersonPage] = useState(1);
  const [pendingSever, setPendingSever] = useState<PendingSever | null>(null);
  const [severError, setSeverError] = useState<string | null>(null);
  const [duplicateGroups, setDuplicateGroups] = useState<
    ContactDuplicateGroup[]
  >([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string | null>(null);

  const selectedPerson = useMemo(
    () => persons.find((p) => p.id === selectedPersonId) ?? null,
    [persons, selectedPersonId],
  );
  const selectedEmailRow = useMemo(
    () => emails.find((e) => e.email === selectedEmail) ?? null,
    [emails, selectedEmail],
  );
  const checkedCount = checkedPersonIds.size;
  const allVisibleSelected =
    persons.length > 0 &&
    persons.every((person) => checkedPersonIds.has(person.id));
  const personTotalPages = Math.max(
    1,
    Math.ceil(stats.personCount / CONTACT_PERSONS_PAGE_SIZE),
  );
  const personRangeStart =
    stats.personCount === 0
      ? 0
      : (personPage - 1) * CONTACT_PERSONS_PAGE_SIZE + 1;
  const personRangeEnd = Math.min(
    personPage * CONTACT_PERSONS_PAGE_SIZE,
    stats.personCount,
  );

  async function refreshData(opts?: {
    personPage?: number;
    personSort?: PersonListSort;
  }): Promise<Stats | null> {
    const page = opts?.personPage ?? personPage;
    const sort = opts?.personSort ?? personSort;
    const offset = (page - 1) * CONTACT_PERSONS_PAGE_SIZE;
    const [personsRes, emailsRes, activityRes] = await Promise.all([
      fetch(
        `/api/contacts/registry?view=persons&limit=${CONTACT_PERSONS_PAGE_SIZE}&offset=${offset}&sort=${sort}`,
      ),
      fetch("/api/contacts/registry?view=emails&limit=500"),
      fetch("/api/contacts/registry?view=activity&limit=100"),
    ]);
    if (!personsRes.ok || !emailsRes.ok) {
      setMessage("Failed to refresh registry.");
      return null;
    }
    const personsJson = (await personsRes.json()) as {
      persons: PersonRow[];
      stats: Stats;
      pagination?: { page: number; totalPages: number };
    };
    const emailsJson = (await emailsRes.json()) as {
      emails: ContactEmailIndexRow[];
      stats: Stats;
    };
    setPersons(personsJson.persons);
    setEmails(emailsJson.emails);
    setStats(personsJson.stats);
    if (personsJson.pagination?.page) {
      setPersonPage(personsJson.pagination.page);
    }
    if (activityRes.ok) {
      const activityJson = (await activityRes.json()) as {
        activity: ContactMergeActivityRow[];
      };
      setActivity(activityJson.activity);
    }
    setSelectedPersonId((prev) => {
      if (prev && personsJson.persons.some((p) => p.id === prev)) return prev;
      return personsJson.persons[0]?.id ?? null;
    });
    setSelectedEmail((prev) => {
      if (prev && emailsJson.emails.some((e) => e.email === prev)) return prev;
      return emailsJson.emails[0]?.email ?? null;
    });
    return personsJson.stats;
  }

  async function loadDuplicates(): Promise<void> {
    setDuplicatesLoading(true);
    setDuplicatesError(null);
    try {
      const res = await fetch("/api/contacts/registry?view=duplicates");
      if (!res.ok) {
        setDuplicatesError("Failed to load duplicate groups.");
        return;
      }
      const json = (await res.json()) as {
        groups: ContactDuplicateGroup[];
        stats?: Stats;
      };
      setDuplicateGroups(json.groups);
      duplicatesLoaded.current = true;
      if (json.stats) setStats(json.stats);
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

  function memberToPersonRow(
    member: ContactDuplicateGroupMember,
  ): PersonRow {
    return {
      ...member,
      displayName: member.displayName,
    };
  }

  function primeMergeCandidatePool(immediate: PersonRow[]) {
    mergeDialogOpenRef.current = true;
    setMergeCandidatePool(immediate);
    void fetch(
      `/api/contacts/registry?view=persons&limit=${MERGE_CANDIDATE_FETCH_LIMIT}&skipVerifiedMentions=1`,
    )
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { persons?: PersonRow[] };
        const all = json.persons ?? [];
        if (!mergeDialogOpenRef.current || all.length === 0) return;
        setMergeCandidatePool(all);
      })
      .catch(() => {
        // Keep the visible page as a fallback if the full-registry fetch fails.
      });
  }

  function closeMergeDialog() {
    mergeDialogOpenRef.current = false;
    setMergeSources([]);
    setMergeCandidatePool([]);
    setMergeError(null);
  }

  function openDuplicateMerge(members: ContactDuplicateGroupMember[]) {
    if (members.length === 0) return;
    setMergeError(null);
    setMergeSources(members.map(memberToPersonRow));
    // Prefer group members as merge targets so survivors in the cluster are searchable.
    const byId = new Map<string, PersonRow>();
    for (const person of persons) byId.set(person.id, person);
    for (const member of members) {
      byId.set(member.id, memberToPersonRow(member));
    }
    // Include the full selected cluster when merging a subset.
    const group = duplicateGroups.find((g) =>
      g.members.some((m) => members.some((sel) => sel.id === m.id)),
    );
    if (group) {
      for (const member of group.members) {
        byId.set(member.id, memberToPersonRow(member));
      }
    }
    primeMergeCandidatePool([...byId.values()]);
  }

  function mergeAllDuplicatesInto(
    target: ContactDuplicateGroupMember,
    sources: ContactDuplicateGroupMember[],
  ) {
    if (sources.length === 0) return;
    setMergeError(null);
    runMerge(
      target.id,
      sources.map(memberToPersonRow),
      target.displayName,
    );
  }

  function openBulkMerge() {
    const selected = persons.filter((person) =>
      checkedPersonIds.has(person.id),
    );
    if (selected.length < 2) return;
    setMergeError(null);
    setMergeSources(selected);
    primeMergeCandidatePool(persons);
  }

  function changePersonSort(next: PersonListSort) {
    if (next === personSort) return;
    setPersonSort(next);
    setPersonPage(1);
    setCheckedPersonIds(new Set());
    startTransition(async () => {
      setMessage(null);
      await refreshData({ personPage: 1, personSort: next });
    });
  }

  function goToPersonPage(nextPage: number) {
    const clamped = Math.min(personTotalPages, Math.max(1, nextPage));
    if (clamped === personPage) return;
    setPersonPage(clamped);
    setCheckedPersonIds(new Set());
    startTransition(async () => {
      setMessage(null);
      await refreshData({ personPage: clamped });
    });
  }

  async function runBackfillAsync(): Promise<void> {
    setMessage("Ingesting prior fingerprint merges into the registry…");
    const res = await fetch("/api/contacts/registry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "backfill", limit: 25 }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      processed?: number;
      completed?: number;
      failed?: number;
      error?: string;
    };
    if (!res.ok) {
      setMessage(json.error ?? "Backfill failed.");
      return;
    }
    setMessage(
      `Backfill: ${json.completed ?? 0} completed, ${json.failed ?? 0} failed (${json.processed ?? 0} processed).`,
    );
    await refreshData();
  }

  function runBackfill() {
    startTransition(async () => {
      await runBackfillAsync();
    });
  }

  // Prior pass-4 runs only wrote fingerprint merges; ingest into this registry
  // on first visit when anything is still pending.
  useEffect(() => {
    if (autoBackfillStarted.current) return;
    if ((initialStats.pendingMergeCount ?? 0) <= 0) return;
    autoBackfillStarted.current = true;
    startTransition(async () => {
      await runBackfillAsync();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, []);

  // Fold nameless / "Haider M" mailbox stubs into the strongest named occupant.
  // Also clears email-local-part first names left by older extractions.
  useEffect(() => {
    if (autoCoalesceStarted.current) return;
    autoCoalesceStarted.current = true;
    startTransition(async () => {
      const res = await fetch("/api/contacts/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "coalesce" }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        merged?: number;
        firstNamesRepaired?: number;
        firstNamesRecovered?: number;
        firstNamesCorrected?: number;
        aliasesPruned?: number;
      };
      const merged = json.merged ?? 0;
      const repaired = json.firstNamesRepaired ?? 0;
      const recovered = json.firstNamesRecovered ?? 0;
      const corrected = json.firstNamesCorrected ?? 0;
      const aliasesPruned = json.aliasesPruned ?? 0;
      if (
        merged > 0 ||
        repaired > 0 ||
        recovered > 0 ||
        corrected > 0 ||
        aliasesPruned > 0
      ) {
        const parts: string[] = [];
        if (recovered > 0) {
          parts.push(
            `recovered ${recovered} missing first name${recovered === 1 ? "" : "s"} from evidence`,
          );
        }
        if (corrected > 0) {
          parts.push(
            `corrected ${corrected} first name${corrected === 1 ? "" : "s"} / alias${corrected === 1 ? "" : "es"} from evidence`,
          );
        }
        if (aliasesPruned > 0) {
          parts.push(
            `pruned Also known as on ${aliasesPruned} contact${aliasesPruned === 1 ? "" : "s"}`,
          );
        }
        if (merged > 0) {
          parts.push(
            `merged ${merged} duplicate mailbox stub${merged === 1 ? "" : "s"} into stronger contacts`,
          );
        }
        if (repaired > 0) {
          parts.push(
            `cleared ${repaired} email-local-part first name${repaired === 1 ? "" : "s"}`,
          );
        }
        setMessage(`${parts.join("; ")}.`);
        await refreshData();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, []);

  function runSweep() {
    startTransition(async () => {
      setMessage(null);
      const res = await fetch("/api/contacts/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sweep", limit: 20 }),
      });
      const json = (await res.json()) as {
        emailsSwept?: number;
        decisions?: number;
        personsMerged?: number;
        error?: string;
      };
      if (!res.ok) {
        setMessage(json.error ?? "Sweep failed.");
        return;
      }
      setMessage(
        `Sweep: ${json.emailsSwept ?? 0} shared mailboxes, ${json.decisions ?? 0} interval updates, ${json.personsMerged ?? 0} stubs merged.`,
      );
      refresh();
    });
  }

  function runResolve() {
    startTransition(async () => {
      setMessage(null);
      setResolveResult(null);
      const params = new URLSearchParams({ email: resolveEmail.trim() });
      if (resolveAt.trim()) params.set("at", resolveAt.trim());
      const res = await fetch(`/api/contacts/resolve?${params.toString()}`);
      const json = (await res.json()) as ResolveResult & { error?: string };
      if (!res.ok) {
        setMessage(json.error ?? "Resolve failed.");
        return;
      }
      setResolveResult(json);
    });
  }

  function togglePersonChecked(personId: string, checked: boolean) {
    setCheckedPersonIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(personId);
      else next.delete(personId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setCheckedPersonIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const person of persons) next.delete(person.id);
      } else {
        for (const person of persons) next.add(person.id);
      }
      return next;
    });
  }

  function runMerge(
    targetPersonId: string,
    sourceOverride?: PersonRow[],
    targetDisplayName?: string,
  ) {
    const sources = sourceOverride ?? mergeSources;
    if (sources.length === 0) return;
    startTransition(async () => {
      setMergeError(null);
      setMessage(null);
      const res = await fetch("/api/contacts/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge",
          sourcePersonIds: sources.map((person) => person.id),
          targetPersonId,
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
        setMessage(json.error ?? "Merge failed.");
        return;
      }
      setMergeSources([]);
      setMergeCandidatePool([]);
      mergeDialogOpenRef.current = false;
      setCheckedPersonIds(new Set());
      const targetName =
        targetDisplayName ??
        persons.find((p) => p.id === targetPersonId)?.displayName ??
        mergeCandidatePool.find((p) => p.id === targetPersonId)?.displayName ??
        sources.find((p) => p.id === targetPersonId)?.displayName ??
        "contact";
      const mergedCount = json.merged ?? sources.length;
      setMessage(
        `Merged ${mergedCount} contact${mergedCount === 1 ? "" : "s"} into “${targetName}”.`,
      );
      await refreshData();
      if (tab === "duplicates" || duplicatesLoaded.current) {
        await loadDuplicates();
      }
      if (json.survivorId) {
        setSelectedPersonId(json.survivorId);
      }
    });
  }

  function confirmSeverField() {
    if (!selectedPerson || !pendingSever) return;
    const person = selectedPerson;
    const sever = pendingSever;
    startTransition(async () => {
      setSeverError(null);
      setMessage(null);
      const res = await fetch("/api/contacts/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deny_field",
          personId: person.id,
          field: sever.field,
          value: sever.value,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setSeverError(json.error ?? "Could not sever association.");
        return;
      }
      setPendingSever(null);
      setMessage(
        `Stopped associating ${sever.label.toLowerCase()} “${sever.value}” with “${person.displayName}”.`,
      );
      await refreshData();
      setSelectedPersonId(person.id);
    });
  }

  return (
    <div>
      <header className="mb-6">
        <dl className="flex flex-wrap gap-6 text-sm text-slate-700">
          <div>
            <dt className="text-slate-500">People</dt>
            <dd className="font-semibold">{stats.personCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Emails indexed</dt>
            <dd className="font-semibold">{stats.emailCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Sparse stubs</dt>
            <dd className="font-semibold">{stats.sparseStubCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">AI decisions</dt>
            <dd className="font-semibold">{stats.mergeDecisionCount ?? activity.length}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Pending merges</dt>
            <dd className="font-semibold">{stats.pendingMergeCount ?? 0}</dd>
          </div>
        </dl>
        {(stats.pendingMergeCount ?? 0) > 0 ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {stats.pendingMergeCount} fingerprint merge
            {stats.pendingMergeCount === 1 ? "" : "s"} from prior extractions
            {pending
              ? " — ingesting into the registry…"
              : " — click Process pending merges (or wait for auto-ingest)."}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={runBackfill}
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            Process pending merges
            {(stats.pendingMergeCount ?? 0) > 0
              ? ` (${stats.pendingMergeCount})`
              : ""}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={runSweep}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Sweep shared mailboxes
          </button>
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
            ["persons", "People"],
            ["link_orgs", "Link orgs"],
            ["duplicates", "Duplicates"],
            ["emails", "Emails"],
            ["activity", "AI decisions"],
            ["resolve", "Resolve at time"],
          ] as const
        ).map(([id, label]) => {
          const count =
            id === "persons"
              ? stats.personCount
              : id === "duplicates"
                ? duplicateGroups.length
                : id === "emails"
                  ? stats.emailCount
                  : id === "activity"
                    ? activity.length
                    : 0;
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
            {id === "duplicates"
              ? count > 0
                ? ` (${count})`
                : ""
              : count > 0
                ? ` (${count})`
                : ""}
          </button>
          );
        })}
      </div>

      {tab === "persons" ? (
        <div className="grid min-w-0 gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex max-h-[70vh] flex-col overflow-hidden border border-slate-200 bg-white">
            {persons.length > 0 || stats.personCount > 0 ? (
              <PersonListSortMenu
                value={personSort}
                onChange={changePersonSort}
              />
            ) : null}
            {persons.length > 0 ? (
              <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
                <label className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    disabled={pending}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
                  />
                  <span className="truncate">Select visible</span>
                </label>
                {checkedCount > 0 ? (
                  <>
                    <span className="min-w-0 truncate text-xs text-slate-500">
                      {checkedCount} selected
                    </span>
                    <div className="ml-auto flex shrink-0 items-center">
                      <button
                        type="button"
                        disabled={pending || checkedCount < 2}
                        onClick={openBulkMerge}
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
                        onClick={() => setCheckedPersonIds(new Set())}
                        title="Clear selection"
                        aria-label="Clear selection"
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                      >
                        <ClearSelectionIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            <ul className="min-h-0 flex-1 overflow-y-auto">
            {persons.length === 0 ? (
              <li className="p-4 text-sm text-slate-500">
                {(stats.pendingMergeCount ?? 0) > 0
                  ? `No people in the registry yet, but ${stats.pendingMergeCount} prior fingerprint merge${stats.pendingMergeCount === 1 ? "" : "s"} ${pending ? "are being ingested…" : "are waiting — Process pending merges will import them."}`
                  : "No people yet. Run contact extraction pass 4 on threads, then they ingest here automatically."}
              </li>
            ) : (
              persons.map((person) => (
                <li key={person.id}>
                  <div
                    className={
                      selectedPersonId === person.id
                        ? "flex items-stretch border-b border-slate-100 bg-teal-50"
                        : checkedPersonIds.has(person.id)
                          ? "flex items-stretch border-b border-slate-100 bg-slate-100"
                          : "flex items-stretch border-b border-slate-100 hover:bg-slate-50"
                    }
                  >
                    <label className="flex shrink-0 items-center self-stretch pl-3">
                      <input
                        type="checkbox"
                        checked={checkedPersonIds.has(person.id)}
                        disabled={pending}
                        onChange={(e) =>
                          togglePersonChecked(person.id, e.target.checked)
                        }
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${person.displayName}`}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setSelectedPersonId(person.id)}
                      className="min-w-0 flex-1 px-2 py-2 text-left"
                    >
                      <span className="block text-sm font-medium text-slate-900">
                        {person.displayName}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        mentions {person.sourceEmailCount}
                        {person.currentOrganizationName
                          ? ` · ${person.currentOrganizationName}`
                          : ""}
                        {person.sparseStub ? " · stub" : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      title={`Merge ${person.displayName} into another contact`}
                      aria-label={`Merge ${person.displayName} into another contact`}
                      disabled={pending}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMergeError(null);
                        setMergeSources([person]);
                        primeMergeCandidatePool(persons);
                      }}
                      className="shrink-0 self-center px-2.5 py-2 text-slate-400 hover:text-teal-700 disabled:opacity-50"
                    >
                      <MergeIcon className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))
            )}
            </ul>
            {stats.personCount > CONTACT_PERSONS_PAGE_SIZE ? (
              <nav
                aria-label="People list pagination"
                className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
              >
                <p>
                  {personRangeStart}–{personRangeEnd} of {stats.personCount}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending || personPage <= 1}
                    onClick={() => goToPersonPage(personPage - 1)}
                    className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="flex-1 text-center text-slate-600">
                    Page {personPage} of {personTotalPages}
                  </span>
                  <button
                    type="button"
                    disabled={pending || personPage >= personTotalPages}
                    onClick={() => goToPersonPage(personPage + 1)}
                    className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </nav>
            ) : null}
          </div>

          <section className="min-w-0 border border-slate-200 bg-white p-4">
            {!selectedPerson ? (
              <p className="text-sm text-slate-500">Select a person.</p>
            ) : (
              <>
                {selectedPerson.sourceEmailCount > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setEvidenceTarget({
                        kind: "person",
                        attributeId: selectedPerson.id,
                        label: selectedPerson.displayName,
                      })
                    }
                    className="text-left"
                  >
                    <h2 className="text-lg font-semibold text-teal-800 underline-offset-2 hover:underline">
                      {selectedPerson.displayName}
                    </h2>
                  </button>
                ) : (
                  <h2 className="text-lg font-semibold text-slate-900">
                    {selectedPerson.displayName}
                  </h2>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {selectedPerson.sourceEmailCount > 0
                    ? `${selectedPerson.sourceEmailCount} mention${selectedPerson.sourceEmailCount === 1 ? "" : "s"}`
                    : "No evidence emails"}
                  {selectedPerson.sparseStub ? " · sparse stub" : ""}
                </p>

                <h3 className="mt-5 text-sm font-semibold text-slate-800">
                  Emails
                </h3>
                {selectedPerson.emails.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">None</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {selectedPerson.emails.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-start gap-2 border-b border-slate-100 pb-2"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setEvidenceTarget({
                              kind: "email",
                              attributeId: row.id,
                              label: row.email,
                            })
                          }
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="break-all font-medium text-teal-800 underline-offset-2 hover:underline">
                            {row.email}
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatRange(row.validFrom, row.validTo)}
                          </div>
                        </button>
                        <button
                          type="button"
                          title={`Stop associating ${row.email} with this contact`}
                          aria-label={`Sever email association for ${row.email}`}
                          disabled={pending}
                          onClick={() => {
                            setSeverError(null);
                            setPendingSever({
                              field: "email",
                              label: "Email",
                              value: row.email,
                            });
                          }}
                          className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
                        >
                          <SeverIcon className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <h3 className="mt-5 text-sm font-semibold text-slate-800">
                  Phones
                </h3>
                {selectedPerson.phones.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">None</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {selectedPerson.phones.map((row) => (
                      <li key={row.id} className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setEvidenceTarget({
                              kind: "phone",
                              attributeId: row.id,
                              label: row.phone,
                            })
                          }
                          className="min-w-0 flex-1 break-all text-left text-teal-800 underline-offset-2 hover:underline"
                        >
                          {row.phone}
                        </button>
                        <button
                          type="button"
                          title={`Stop associating ${row.phone} with this contact`}
                          aria-label={`Sever phone association for ${row.phone}`}
                          disabled={pending}
                          onClick={() => {
                            setSeverError(null);
                            setPendingSever({
                              field: "phone",
                              label: "Phone",
                              value: row.phone,
                            });
                          }}
                          className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
                        >
                          <SeverIcon className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <h3 className="mt-5 text-sm font-semibold text-slate-800">
                  Also known as
                </h3>
                {selectedPerson.nameAliases.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">None</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-slate-700">
                    {selectedPerson.nameAliases.map((alias) => (
                      <li key={alias} className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 break-words">{alias}</span>
                        <button
                          type="button"
                          title={`Remove alias “${alias}” from this contact`}
                          aria-label={`Sever alias association for ${alias}`}
                          disabled={pending}
                          onClick={() => {
                            setSeverError(null);
                            setPendingSever({
                              field: "name_alias",
                              label: "Alias",
                              value: alias,
                            });
                          }}
                          className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
                        >
                          <SeverIcon className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <h3 className="mt-5 text-sm font-semibold text-slate-800">
                  Titles
                </h3>
                {selectedPerson.titles.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">None</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {selectedPerson.titles.map((row) => (
                      <li key={row.id} className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setEvidenceTarget({
                              kind: "title",
                              attributeId: row.id,
                              label: row.title,
                            })
                          }
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="break-words text-teal-800 underline-offset-2 hover:underline">
                            {row.title}
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatRange(row.validFrom, row.validTo)}
                          </div>
                        </button>
                        <button
                          type="button"
                          title={`Stop associating ${row.title} with this contact`}
                          aria-label={`Sever title association for ${row.title}`}
                          disabled={pending}
                          onClick={() => {
                            setSeverError(null);
                            setPendingSever({
                              field: "title",
                              label: "Title",
                              value: row.title,
                            });
                          }}
                          className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
                        >
                          <SeverIcon className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <PersonAffiliationsPanel
                  personId={selectedPerson.id}
                  currentOrganizationName={
                    selectedPerson.currentOrganizationName
                  }
                  onChanged={() => {
                    startTransition(async () => {
                      await refreshData();
                    });
                  }}
                />
              </>
            )}
          </section>
        </div>
      ) : null}

      {tab === "link_orgs" ? (
        <AffiliationMatchingQueue
          onLinked={() => {
            startTransition(async () => {
              await refreshData();
            });
          }}
        />
      ) : null}

      {tab === "duplicates" ? (
        <ContactDuplicatesPanel
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
      ) : null}

      {tab === "emails" ? (
        <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_1fr]">
          <ul className="max-h-[70vh] overflow-y-auto border border-slate-200 bg-white">
            {emails.length === 0 ? (
              <li className="p-4 text-sm text-slate-500">No indexed emails.</li>
            ) : (
              emails.map((row) => (
                <li key={row.email}>
                  <button
                    type="button"
                    onClick={() => setSelectedEmail(row.email)}
                    className={
                      selectedEmail === row.email
                        ? "w-full border-b border-slate-100 bg-teal-50 px-3 py-2 text-left"
                        : "w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                    }
                  >
                    <span className="block break-all text-sm font-medium text-slate-900">
                      {row.email}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Now: {row.currentPersonName ?? "—"}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          <section className="border border-slate-200 bg-white p-4">
            {!selectedEmailRow ? (
              <p className="text-sm text-slate-500">Select an email.</p>
            ) : (
              <>
                <h2 className="break-all text-lg font-semibold text-slate-900">
                  {selectedEmailRow.email}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Current primary:{" "}
                  <span className="font-medium text-slate-900">
                    {selectedEmailRow.currentPersonName ?? "—"}
                  </span>
                </p>
                <h3 className="mt-5 text-sm font-semibold text-slate-800">
                  Occupancy history
                </h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {selectedEmailRow.occupants.map((o) => (
                    <li
                      key={`${o.personId}-${o.validFrom}-${o.validTo}`}
                      className="border-b border-slate-100 pb-2"
                    >
                      <div className="font-medium text-slate-900">
                        {o.personName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatRange(o.validFrom, o.validTo)}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      ) : null}

      {tab === "activity" ? (
        <section className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-600">
            Each row is one AI adjudication when a thread fingerprint merge was
            ingested into this registry (
            <code className="text-xs">merge</code>,{" "}
            <code className="text-xs">keep_separate</code>,{" "}
            <code className="text-xs">link_email</code>,{" "}
            <code className="text-xs">enrich</code>). First-name-only stubs are
            usually kept separate on purpose.
          </div>
          {activity.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">
              No AI decisions yet. Process pending merges (or run pass 4) to
              create them.
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {activity.map((row) => (
                <li key={row.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className={
                        row.action === "merge"
                          ? "rounded bg-teal-100 px-1.5 py-0.5 text-xs font-semibold uppercase text-teal-900"
                          : row.action === "link_email"
                            ? "rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold uppercase text-amber-950"
                            : row.action === "enrich"
                              ? "rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold uppercase text-sky-950"
                              : "rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold uppercase text-slate-700"
                      }
                    >
                      {row.action}
                    </span>
                    <span className="font-medium text-slate-900">
                      {row.incomingLabel}
                    </span>
                    {row.resultPersonName ? (
                      <span className="text-slate-500">
                        → {row.resultPersonName}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {[
                      row.incomingCard.email,
                      row.incomingCard.phone,
                      row.incomingCard.job_title,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "no email/phone/title on incoming card"}
                    {" · "}
                    {row.createdAt.slice(0, 19).replace("T", " ")}
                    {row.reason ? ` · ${row.reason}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "resolve" ? (
        <section className="max-w-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Who had this email at a given time?
          </h2>
          <label className="mt-4 block text-sm text-slate-700">
            Email
            <input
              value={resolveEmail}
              onChange={(e) => setResolveEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="studiopm@iccpropertymanagement.com"
            />
          </label>
          <label className="mt-3 block text-sm text-slate-700">
            At (ISO datetime, optional = now)
            <input
              value={resolveAt}
              onChange={(e) => setResolveAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="2024-06-15T12:00:00.000Z"
            />
          </label>
          <button
            type="button"
            disabled={pending || !resolveEmail.trim()}
            onClick={runResolve}
            className="mt-4 rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            Resolve
          </button>
          {resolveResult ? (
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-slate-500">Person</dt>
                <dd className="font-medium text-slate-900">
                  {resolveResult.displayName ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Range</dt>
                <dd>
                  {formatRange(resolveResult.validFrom, resolveResult.validTo)}
                </dd>
              </div>
              {resolveResult.usedCurrentFallback ? (
                <p className="text-xs text-amber-700">
                  No dated occupancy matched; used current primary.
                </p>
              ) : null}
            </dl>
          ) : null}
        </section>
      ) : null}

      <ContactEvidenceSidePanel
        target={evidenceTarget}
        onClose={() => setEvidenceTarget(null)}
      />

      <MergeEntityDialog
        open={mergeSources.length > 0}
        entityLabel="contact"
        sources={mergeSources.map(personToMergeOption)}
        candidates={(mergeCandidatePool.length > 0
          ? mergeCandidatePool
          : persons
        ).map(personToMergeOption)}
        searchPlaceholder="Search by name, email, or phone…"
        busy={pending}
        error={mergeError}
        onClose={() => {
          if (pending) return;
          closeMergeDialog();
        }}
        onMerge={runMerge}
      />

      <ConfirmDialog
        open={pendingSever != null && selectedPerson != null}
        title="Sever association?"
        description={
          pendingSever && selectedPerson ? (
            <div className="space-y-2">
              <p>
                Stop associating{" "}
                <span className="font-medium text-slate-800">
                  {pendingSever.label.toLowerCase()} “{pendingSever.value}”
                </span>{" "}
                with{" "}
                <span className="font-medium text-slate-800">
                  {selectedPerson.displayName}
                </span>
                ?
              </p>
              <p>
                The system will remember this and will not reattach that value
                to this contact on future extractions.
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
    </div>
  );
}
