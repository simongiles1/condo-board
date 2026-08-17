"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import type {
  AffiliationQueueCandidate,
  AffiliationQueuePerson,
} from "@/lib/affiliations/queue";

type QueueStats = {
  peopleNeedingLink: number;
  peopleWithCandidates: number;
  totalCandidates: number;
  organizationCount: number;
};

function candidateSignalLabel(candidate: AffiliationQueueCandidate): string {
  const parts: string[] = [candidate.source.replace(/_/g, " "), candidate.confidence];
  if (candidate.evidence.domain) parts.push(`@${candidate.evidence.domain}`);
  if (candidate.evidence.companyNames?.length) {
    parts.push(candidate.evidence.companyNames.slice(0, 2).join(", "));
  }
  if (candidate.evidence.rationale) parts.push(candidate.evidence.rationale);
  return parts.join(" · ");
}

export function AffiliationMatchingQueue({
  onLinked,
}: {
  /** Called after an Accept so the People list can refresh org labels. */
  onLinked?: () => void;
}) {
  const [people, setPeople] = useState<AffiliationQueuePerson[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"with_candidates" | "all">(
    "with_candidates",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();

  const visiblePeople = useMemo(() => {
    if (filter === "all") return people;
    return people.filter((p) => p.candidateCount > 0);
  }, [filter, people]);

  const selected =
    visiblePeople.find((p) => p.personId === selectedPersonId) ??
    visiblePeople[0] ??
    null;

  async function refreshQueue(opts?: { keepSelection?: boolean }) {
    const res = await fetch("/api/affiliations?view=queue");
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(json.error ?? "Failed to load matching queue.");
      setLoaded(true);
      return;
    }
    const json = (await res.json()) as {
      people: AffiliationQueuePerson[];
      stats: QueueStats;
    };
    setPeople(json.people);
    setStats(json.stats);
    setLoaded(true);
    if (!opts?.keepSelection) {
      const first =
        json.people.find((p) => p.candidateCount > 0)?.personId ??
        json.people[0]?.personId ??
        null;
      setSelectedPersonId(first);
    } else if (
      selectedPersonId &&
      !json.people.some((p) => p.personId === selectedPersonId)
    ) {
      const first =
        json.people.find((p) => p.candidateCount > 0)?.personId ??
        json.people[0]?.personId ??
        null;
      setSelectedPersonId(first);
    }
  }

  useEffect(() => {
    startTransition(async () => {
      await refreshQueue();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  function removeCandidateLocally(personId: string, organizationId: string) {
    setPeople((prev) =>
      prev.map((person) => {
        if (person.personId !== personId) return person;
        const candidates = person.candidates.filter(
          (c) => c.organizationId !== organizationId,
        );
        return {
          ...person,
          candidates,
          candidateCount: candidates.length,
        };
      }),
    );
  }

  function removePersonLocally(personId: string) {
    setPeople((prev) => {
      const next = prev.filter((p) => p.personId !== personId);
      setSelectedPersonId((current) => {
        if (current !== personId) return current;
        const fromVisible =
          filter === "all"
            ? next
            : next.filter((p) => p.candidateCount > 0);
        return fromVisible[0]?.personId ?? next[0]?.personId ?? null;
      });
      return next;
    });
  }

  function runDecision(
    kind: "accept" | "reject",
    person: AffiliationQueuePerson,
    candidate: AffiliationQueueCandidate,
  ) {
    startTransition(async () => {
      setMessage(kind === "accept" ? "Accepting…" : "Rejecting…");
      const res = await fetch("/api/affiliations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:
            kind === "accept" ? "accept_candidate" : "reject_candidate",
          personId: person.personId,
          organizationId: candidate.organizationId,
          affiliationId: candidate.affiliationId,
          source: candidate.source,
          confidence: candidate.confidence,
          evidence: candidate.evidence,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(json.error ?? `${kind} failed.`);
        return;
      }

      if (kind === "accept") {
        setMessage(`Linked ${person.displayName} → ${candidate.organizationName ?? candidate.organizationKey}.`);
        removePersonLocally(person.personId);
        onLinked?.();
      } else {
        setMessage(`Rejected ${candidate.organizationName ?? candidate.organizationKey}.`);
        removeCandidateLocally(person.personId, candidate.organizationId);
        // If no candidates left, stay on person (empty shortlist) so Skip is clear.
      }
    });
  }

  function skipPerson() {
    if (!selected) return;
    const idx = visiblePeople.findIndex(
      (p) => p.personId === selected.personId,
    );
    const next =
      visiblePeople[idx + 1] ?? visiblePeople[0] ?? null;
    if (next && next.personId !== selected.personId) {
      setSelectedPersonId(next.personId);
      setMessage(`Skipped ${selected.displayName}.`);
    } else {
      setMessage("No other people in this filter.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Link people → organizations
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Deterministic shortlist from email domain, company co-occurrence, and
            aliases. Accept or reject without opening each person.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filter}
            onChange={(e) =>
              setFilter(e.target.value as "with_candidates" | "all")
            }
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
            aria-label="Filter people in matching queue"
          >
            <option value="with_candidates">With shortlist</option>
            <option value="all">All unlinked</option>
          </select>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setMessage("Refreshing shortlist…");
                await refreshQueue({ keepSelection: true });
                setMessage("Shortlist refreshed.");
              })
            }
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {stats ? (
        <p className="text-xs text-slate-500">
          {stats.peopleWithCandidates} with shortlist · {stats.peopleNeedingLink}{" "}
          unlinked · {stats.totalCandidates} candidates · {stats.organizationCount}{" "}
          orgs
        </p>
      ) : null}

      {message ? (
        <p className="text-xs text-slate-600" role="status">
          {message}
        </p>
      ) : null}

      {!loaded && pending ? (
        <p className="text-sm text-slate-500">Loading matching queue…</p>
      ) : null}

      {loaded && visiblePeople.length === 0 ? (
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          {filter === "with_candidates"
            ? "No unlinked people with a deterministic shortlist. Switch to “All unlinked” or wait for AI shortlisting later."
            : "Everyone in range already has an organization link."}
        </p>
      ) : null}

      {visiblePeople.length > 0 ? (
        <div className="grid min-w-0 gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex max-h-[70vh] flex-col overflow-hidden border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
              People ({visiblePeople.length})
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {visiblePeople.map((person) => {
                const active = selected?.personId === person.personId;
                return (
                  <li key={person.personId}>
                    <button
                      type="button"
                      onClick={() => setSelectedPersonId(person.personId)}
                      className={
                        active
                          ? "flex w-full flex-col gap-0.5 border-l-2 border-teal-700 bg-teal-50 px-3 py-2 text-left"
                          : "flex w-full flex-col gap-0.5 border-l-2 border-transparent px-3 py-2 text-left hover:bg-slate-50"
                      }
                    >
                      <span className="truncate text-sm font-medium text-slate-900">
                        {person.displayName}
                      </span>
                      <span className="truncate text-xs text-slate-500">
                        {person.emails[0] ?? "No email"}
                        {person.candidateCount > 0
                          ? ` · ${person.candidateCount} option${person.candidateCount === 1 ? "" : "s"}`
                          : " · no shortlist"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="min-w-0 border border-slate-200 bg-white">
            {selected ? (
              <div className="flex h-full max-h-[70vh] flex-col">
                <div className="border-b border-slate-200 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-slate-900">
                        {selected.displayName}
                      </h3>
                      <p className="mt-0.5 break-words text-xs text-slate-500">
                        {selected.emails.join(", ") || "No emails"}
                        {selected.nameAliases.length > 0
                          ? ` · aka ${selected.nameAliases.slice(0, 3).join(", ")}`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={skipPerson}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Skip
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {selected.candidates.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No deterministic matches. Skip for now — AI shortlisting can
                      be added later.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {selected.candidates.map((candidate) => (
                        <li
                          key={candidate.organizationId}
                          className="rounded border border-slate-200 px-3 py-2"
                        >
                          <div className="font-medium text-slate-900">
                            {candidate.organizationName ??
                              candidate.organizationKey}
                          </div>
                          {candidate.organizationEmail ? (
                            <div className="text-xs text-slate-500">
                              {candidate.organizationEmail}
                            </div>
                          ) : null}
                          <div className="mt-0.5 break-words text-xs text-slate-500">
                            {candidateSignalLabel(candidate)}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                runDecision("accept", selected, candidate)
                              }
                              className="rounded bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                runDecision("reject", selected, candidate)
                              }
                              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="px-4 py-6 text-sm text-slate-500">
                Select a person to review organization options.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
