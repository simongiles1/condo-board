"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmailSidePanel } from "@/components/EmailSidePanel";
import {
  ResolutionReasonBadge,
  RolePhraseBadge,
} from "@/components/EntityMentionBadges";
import { ReHarvestThreadButton, type HarvestRunMessage } from "@/components/ReHarvestThreadButton";
import { harvestMessageClassName } from "@/components/HarvestRunNotice";
import {
  rankMergeOptions,
  type MergeSearchOption,
} from "@/lib/contacts/merge-search";
import type {
  ContactMentionStats,
  MentionQueueGroup,
  MentionQueueView,
} from "@/lib/contacts/mention-queue-shared";
import { formatDateTime } from "@/lib/format/datetime";

type PersonOption = MergeSearchOption & {
  subtitle?: string | null;
};

const VIEW_OPTIONS: Array<{ id: MentionQueueView; label: string }> = [
  { id: "unresolved", label: "Unresolved" },
  { id: "full_name", label: "Full names" },
  { id: "provisional", label: "Provisional" },
  { id: "thread_participant", label: "Thread participant" },
];

/** Same mark as the email side-panel quote highlight. */
const QUOTE_HIGHLIGHT_CLASS =
  "rounded-sm bg-amber-200 text-inherit box-decoration-clone px-0.5";

function groupKindLabel(kind: MentionQueueGroup["kind"]): string {
  if (kind === "first_last") return "full name";
  if (kind === "first_org") return "first + org";
  if (kind === "first_name") return "first name";
  if (kind === "email") return "email";
  return "other";
}

function extraMentionBits(sample: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  rawCompany: string | null;
  jobTitle: string | null;
  rolePhrase?: string | null;
  resolvedPersonName?: string | null;
}): string | null {
  const bits: string[] = [];
  const last = sample.lastName?.trim();
  if (last) {
    bits.push([sample.firstName?.trim(), last].filter(Boolean).join(" "));
  }
  for (const value of [
    sample.rawCompany,
    sample.jobTitle && sample.jobTitle.trim() !== sample.rolePhrase?.trim()
      ? sample.jobTitle
      : null,
    sample.email,
    sample.phone,
  ]) {
    const trimmed = value?.trim();
    if (trimmed) bits.push(trimmed);
  }
  if (sample.resolvedPersonName?.trim()) {
    bits.push(`→ ${sample.resolvedPersonName.trim()}`);
  }
  return bits.length > 0 ? bits.join(" · ") : null;
}

function MentionContextSnippet({
  text,
  term,
}: {
  text: string;
  term: string | null;
}) {
  const needle = term?.trim();
  if (!needle) {
    return <>{text}</>;
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(escaped, "i").exec(text);
  if (!match || match.index == null) {
    return <>{text}</>;
  }
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

export function ContactMentionsPanel({
  stats,
  pending = false,
  people,
  onStats,
  onChanged,
}: {
  stats: {
    mentionUnresolvedCount?: number;
    mentionProvisionalCount?: number;
    mentionConfirmedCount?: number;
    mentionTotalCount?: number;
    sparseStubCount?: number;
  };
  pending?: boolean;
  people: PersonOption[];
  onStats?: (stats: {
    mentionUnresolvedCount: number;
    mentionProvisionalCount: number;
    mentionConfirmedCount: number;
    mentionTotalCount: number;
  }) => void;
  onChanged?: () => void;
}) {
  const [view, setView] = useState<MentionQueueView>("unresolved");
  const [groups, setGroups] = useState<MentionQueueGroup[]>([]);
  const [mentionStats, setMentionStats] = useState<ContactMentionStats | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [harvestMessage, setHarvestMessage] = useState<HarvestRunMessage | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [attachPending, startAttach] = useTransition();
  const [confirmPerson, setConfirmPerson] = useState<PersonOption | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [panelEmailId, setPanelEmailId] = useState<string | null>(null);
  const [panelQuote, setPanelQuote] = useState<string | null>(null);
  const [panelThreadId, setPanelThreadId] = useState<string | null>(null);
  const [selectedMentionIds, setSelectedMentionIds] = useState<Set<string>>(
    () => new Set(),
  );

  const selected = useMemo(
    () => groups.find((group) => group.id === selectedId) ?? null,
    [groups, selectedId],
  );

  async function loadGroups(nextView = view): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/contacts/registry?view=mentions&mentionView=${nextView}`,
      );
      if (!res.ok) {
        setError("Failed to load mention groups.");
        return;
      }
      const json = (await res.json()) as {
        groups?: MentionQueueGroup[];
        mentionStats?: ContactMentionStats;
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
    } catch {
      setError("Failed to load mention groups.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGroups(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view-driven fetch
  }, [view]);

  useEffect(() => {
    if (!selected) {
      setSelectedMentionIds(new Set());
      return;
    }
    setSelectedMentionIds(
      new Set(selected.samples.map((sample) => sample.mentionId)),
    );
  }, [selected]);

  const visibleGroups = useMemo(
    () => groups.filter((group) => !skippedIds.has(group.id)),
    [groups, skippedIds],
  );

  const searchHits = useMemo(() => {
    if (!selected || (view !== "unresolved" && view !== "full_name")) return [];
    const hinted = new Set(selected.candidates.map((c) => c.id));
    const options: PersonOption[] = people.filter((person) => !hinted.has(person.id));
    if (!search.trim()) return [];
    return rankMergeOptions(options, search, 8);
  }, [people, search, selected, view]);

  function leaveGroup(groupId: string) {
    const remaining = visibleGroups.filter((group) => group.id !== groupId);
    setSkippedIds((prev) => new Set(prev).add(groupId));
    setSelectedId(remaining[0]?.id ?? null);
    setSearch("");
    setMessage("Left unresolved — skipped for this session.");
  }

  function mentionIdsToAttach(): string[] {
    if (!selected) return [];
    return selected.samples
      .map((sample) => sample.mentionId)
      .filter((id) => selectedMentionIds.has(id));
  }

  function requestAttach(person: PersonOption) {
    if (mentionIdsToAttach().length === 0) {
      setMessage("Select at least one mention to attach.");
      return;
    }
    setConfirmPerson(person);
  }

  function toggleMention(mentionId: string) {
    setSelectedMentionIds((prev) => {
      const next = new Set(prev);
      if (next.has(mentionId)) next.delete(mentionId);
      else next.add(mentionId);
      return next;
    });
  }

  function attachTo(person: PersonOption) {
    if (!selected) return;
    const mentionIds = mentionIdsToAttach();
    if (mentionIds.length === 0) {
      setMessage("Select at least one mention to attach.");
      return;
    }
    startAttach(async () => {
      setMessage(`Attaching ${mentionIds.length} mention${mentionIds.length === 1 ? "" : "s"} → ${person.displayName}…`);
      try {
        const res = await fetch("/api/contacts/registry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "attach_mentions",
            groupId: selected.id,
            personId: person.id,
            mentionIds,
          }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          attached?: number;
          displayName?: string;
          error?: string;
        };
        if (!res.ok || !json.ok) {
          setMessage(json.error ?? "Could not attach mentions.");
          return;
        }
        setMessage(
          `Attached ${json.attached ?? 0} mention${json.attached === 1 ? "" : "s"} to ${json.displayName ?? person.displayName}.`,
        );
        setConfirmPerson(null);
        setSearch("");
        await loadGroups(view);
        onChanged?.();
      } catch {
        setMessage("Could not attach mentions.");
      }
    });
  }

  function createPersonFromSelected() {
    if (!selected || selected.kind !== "first_last") return;
    const mentionIds = mentionIdsToAttach();
    if (mentionIds.length === 0) {
      setMessage("Select at least one mention to create a person.");
      return;
    }
    startAttach(async () => {
      setMessage(
        `Creating a person from ${mentionIds.length} mention${mentionIds.length === 1 ? "" : "s"}…`,
      );
      try {
        const res = await fetch("/api/contacts/registry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_person_from_mentions",
            groupId: selected.id,
            mentionIds,
          }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          created?: boolean;
          attached?: number;
          displayName?: string;
          error?: string;
        };
        if (!res.ok || !json.ok) {
          setMessage(json.error ?? "Could not create a person.");
          return;
        }
        const name = json.displayName ?? selected.label;
        setMessage(
          json.created
            ? `Created ${name} and attached ${json.attached ?? 0} mention${json.attached === 1 ? "" : "s"}.`
            : `Attached ${json.attached ?? 0} mention${json.attached === 1 ? "" : "s"} to existing ${name} instead of creating a duplicate.`,
        );
        setConfirmCreate(false);
        setSearch("");
        await loadGroups(view);
        onChanged?.();
      } catch {
        setMessage("Could not create a person.");
      }
    });
  }

  const unresolvedCount =
    mentionStats?.unresolved ?? stats.mentionUnresolvedCount ?? 0;
  const fullNameCount = mentionStats?.fullName ?? 0;
  const canAttach =
    (view === "unresolved" || view === "full_name") && selected != null;
  const busy = pending || attachPending || loading;
  const sampleIds = selected?.samples.map((sample) => sample.mentionId) ?? [];
  const checkedCount = sampleIds.filter((id) => selectedMentionIds.has(id)).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {VIEW_OPTIONS.map((option) => {
          const count =
            option.id === "unresolved"
              ? Math.max(0, unresolvedCount - fullNameCount)
              : option.id === "full_name"
                ? fullNameCount
                : option.id === "provisional"
                ? (mentionStats?.provisional ?? stats.mentionProvisionalCount ?? 0)
                : null;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setView(option.id);
                setSkippedIds(new Set());
                setMessage(null);
              }}
              className={
                view === option.id
                  ? "rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white"
                  : "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
              }
            >
              {option.label}
              {count != null ? ` (${count.toLocaleString()})` : ""}
            </button>
          );
        })}
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
          href="/knowledge/entities/mention-rules"
          className="rounded-md px-3 py-1.5 text-slate-700 hover:underline"
        >
          How mentions match
        </Link>
      </div>
      {view === "full_name" ? (
        <p className="mb-3 text-sm text-slate-600">
          Harvest already stored a first and last name, but ingest did not make
          a People card — or the matcher could not attach it. Create a person
          from the checked mentions, or attach them to someone who already
          exists if this is a spelling of a name above.
        </p>
      ) : null}
      {view === "thread_participant" ? (
        <p className="mb-3 text-sm text-slate-600">
          Sample of confirmed header matches. Open a message if a first name on a
          crowded To-line looks wrong.
        </p>
      ) : null}
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
          {loading && groups.length === 0 ? (
            <li className="p-4 text-sm text-slate-500">Loading mentions…</li>
          ) : visibleGroups.length === 0 ? (
            <li className="p-4 text-sm text-slate-500">
              {view === "unresolved"
                ? "No unresolved mention groups."
                : view === "full_name"
                  ? "No full-name mention leaks."
                  : view === "provisional"
                  ? "No provisional mentions."
                  : "No thread-participant samples."}
            </li>
          ) : (
            visibleGroups.map((group) => {
              const active = group.id === selected?.id;
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(group.id);
                      setSearch("");
                      setMessage(null);
                    }}
                    className={
                      active
                        ? "w-full border-l-2 border-teal-700 bg-teal-50 px-3 py-2 text-left"
                        : "w-full border-l-2 border-transparent px-3 py-2 text-left hover:bg-slate-50"
                    }
                  >
                    <span className="block text-sm font-medium text-slate-900">
                      {group.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {group.mentionCount} mention
                      {group.mentionCount === 1 ? "" : "s"} · {group.emailCount}{" "}
                      email{group.emailCount === 1 ? "" : "s"} ·{" "}
                      {groupKindLabel(group.kind)}
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
                    {selected.participantCount > 0
                      ? ` · ${selected.participantCount} on To/From`
                      : ""}
                  </p>
                </div>
                {selected.samples.some(
                  (sample) => sample.threadId || sample.sourceEmailId,
                ) ? (
                  <ReHarvestThreadButton
                    threadId={
                      selected.samples.find((sample) => sample.threadId)
                        ?.threadId ?? null
                    }
                    emailIds={selected.samples
                      .map((sample) => sample.sourceEmailId)
                      .filter((id): id is string => Boolean(id))}
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

              {canAttach ? (
                <div className="mt-4 space-y-3">
                  {selected.candidates.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {selected.kind === "first_last"
                          ? "Existing people"
                          : "Same first name"}
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {selected.candidates.map((candidate) => (
                          <li key={candidate.id}>
                            <button
                              type="button"
                              disabled={busy || checkedCount === 0}
                              onClick={() =>
                                requestAttach({
                                  id: candidate.id,
                                  displayName: candidate.displayName,
                                  searchText: candidate.displayName,
                                  rankHint: candidate.sourceEmailCount,
                                  subtitle: [
                                    `${candidate.sourceEmailCount} mentions`,
                                    candidate.currentOrganizationName,
                                  ]
                                    .filter(Boolean)
                                    .join(" · "),
                                })
                              }
                              className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1 text-sm text-teal-900 hover:bg-teal-100 disabled:opacity-50"
                            >
                              {candidate.displayName}
                              {candidate.currentOrganizationName
                                ? ` · ${candidate.currentOrganizationName}`
                                : ""}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <label className="block text-sm text-slate-700">
                    Attach to a person
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Search by name, email, or phone…"
                      disabled={busy}
                    />
                  </label>
                  <p className="text-xs text-slate-500">
                    Attaches the checked mentions
                    {selected.kind === "first_name"
                      ? " — first-name groups can mix different people."
                      : selected.kind === "first_last"
                        ? " — or create a new People card from this full name."
                        : "."}
                  </p>
                  {searchHits.length > 0 ? (
                    <ul className="max-h-40 overflow-y-auto rounded-md border border-slate-200">
                      {searchHits.map((person) => (
                        <li key={person.id}>
                          <button
                            type="button"
                            disabled={busy || checkedCount === 0}
                            onClick={() => requestAttach(person)}
                            className="w-full px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50"
                          >
                            <span className="block text-sm font-medium text-slate-900">
                              {person.displayName}
                            </span>
                            {person.subtitle ? (
                              <span className="block text-xs text-slate-500">
                                {person.subtitle}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : search.trim() ? (
                    <p className="text-sm text-slate-500">No matching people.</p>
                  ) : null}
                  {selected.kind === "first_last" ? (
                    <button
                      type="button"
                      disabled={busy || checkedCount === 0}
                      onClick={() => setConfirmCreate(true)}
                      className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                    >
                      Create person
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => leaveGroup(selected.id)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Leave unresolved
                  </button>
                </div>
              ) : null}

              {canAttach && selected.samples.length > 0 ? (
                <div className="mt-4 flex items-center gap-3 px-3">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    checked={
                      checkedCount > 0 &&
                      checkedCount === selected.samples.length
                    }
                    ref={(element) => {
                      if (element) {
                        element.indeterminate =
                          checkedCount > 0 &&
                          checkedCount < selected.samples.length;
                      }
                    }}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedMentionIds(
                          new Set(
                            selected.samples.map((sample) => sample.mentionId),
                          ),
                        );
                        return;
                      }
                      setSelectedMentionIds(new Set());
                    }}
                    disabled={busy}
                    aria-label="Select all mentions"
                  />
                  <span className="text-xs text-slate-500">
                    {checkedCount} of {selected.samples.length} selected
                  </span>
                </div>
              ) : null}

              <ul className={canAttach ? "mt-2 space-y-3" : "mt-4 space-y-3"}>
                {selected.samples.map((sample) => {
                  const extra = extraMentionBits(sample);
                  const quote =
                    [sample.firstName, sample.lastName]
                      .filter(Boolean)
                      .join(" ") || selected.label;
                  const checked = selectedMentionIds.has(sample.mentionId);
                  return (
                    <li
                      key={sample.mentionId}
                      className="rounded-md border border-slate-200 px-3 py-2"
                    >
                      <div className="flex items-start gap-3">
                        {canAttach ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMention(sample.mentionId)}
                            disabled={busy}
                            className="mt-1.5 size-4 shrink-0 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                            aria-label={`Select mention in ${sample.subject || "email"}`}
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900">
                            {sample.subject || "(no subject)"}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {formatDateTime(sample.receivedAt)}
                            {sample.fromAddress
                              ? ` · from ${sample.fromAddress}`
                              : ""}
                          </p>
                          {sample.toPreview ? (
                            <p className="mt-0.5 text-xs text-slate-500">
                              To: {sample.toPreview}
                            </p>
                          ) : null}
                          {extra ? (
                            <p className="mt-1 text-xs text-slate-600">{extra}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <RolePhraseBadge
                              rolePhrase={sample.rolePhrase}
                              jobTitle={sample.jobTitle}
                            />
                            <ResolutionReasonBadge
                              reason={sample.resolutionReason}
                            />
                          </div>
                          {sample.contextSnippet ? (
                            <p className="mt-2 text-sm leading-5 text-slate-700">
                              <MentionContextSnippet
                                text={sample.contextSnippet}
                                term={
                                  [sample.firstName, sample.lastName]
                                    .filter(Boolean)
                                    .join(" ") || selected.label
                                }
                              />
                            </p>
                          ) : null}
                        </div>
                        {sample.sourceEmailId ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPanelEmailId(sample.sourceEmailId);
                              setPanelQuote(quote);
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

      <ConfirmDialog
        open={confirmPerson != null && selected != null}
        title={`Attach to ${confirmPerson?.displayName ?? "this person"}?`}
        description={
          confirmPerson && selected
            ? [
                `${checkedCount} selected mention${checkedCount === 1 ? "" : "s"} will be confirmed as ${confirmPerson.displayName}.`,
                checkedCount < selected.samples.length
                  ? `The other ${selected.samples.length - checkedCount} stay unresolved.`
                  : null,
                "This does not merge people.",
              ]
                .filter(Boolean)
                .join(" ")
            : null
        }
        confirmLabel="Attach"
        busy={attachPending}
        busyLabel="Attaching…"
        onConfirm={() => {
          if (confirmPerson) attachTo(confirmPerson);
        }}
        onCancel={() => {
          if (!attachPending) setConfirmPerson(null);
        }}
      />

      <ConfirmDialog
        open={confirmCreate && selected != null}
        title={`Create ${selected?.label ?? "this person"}?`}
        description={
          selected
            ? [
                `A new People card named ${selected.label} will be created from ${checkedCount} selected mention${checkedCount === 1 ? "" : "s"}.`,
                selected.candidates.length > 0
                  ? "If this is a spelling of someone listed above, attach instead."
                  : null,
                checkedCount < selected.samples.length
                  ? `The other ${selected.samples.length - checkedCount} stay unresolved.`
                  : null,
              ]
                .filter(Boolean)
                .join(" ")
            : null
        }
        confirmLabel="Create person"
        busy={attachPending}
        busyLabel="Creating…"
        onConfirm={() => {
          createPersonFromSelected();
        }}
        onCancel={() => {
          if (!attachPending) setConfirmCreate(false);
        }}
      />

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
