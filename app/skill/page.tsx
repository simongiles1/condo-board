"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ConceptDetailPanel } from "@/components/ConceptDetailPanel";
import {
  SKILL_ONLY_DESTINATION_ID,
  type ConceptFieldMapping,
  type ConceptRoutingPreview,
  type RoutableConceptDestination,
} from "@/lib/email/concept-routing";

type SkillEntry = {
  id: string;
  conceptName: string;
  description: string;
  suggestedFields: Array<{ name: string; type?: string; description?: string }>;
  occurrenceCount: number;
  status: "active" | "archived" | "merged";
  routing: {
    destinationId: string;
    fieldMapping: ConceptFieldMapping;
    configuredAt: string | null;
  };
};

type ConceptDetailResponse = {
  entry: SkillEntry;
  routingPreview: ConceptRoutingPreview;
  routableDestinations: RoutableConceptDestination[];
  routingHistory: Array<{
    id: string;
    createdAt: string;
    details: Record<string, unknown>;
  }>;
};

function routingLabel(entry: SkillEntry): string {
  const destinationId = entry.routing.destinationId || SKILL_ONLY_DESTINATION_ID;
  if (destinationId === SKILL_ONLY_DESTINATION_ID) return "Skill only";
  return destinationId.replace(/_/g, " ");
}

function routingBadgeClass(destinationId: string): string {
  if (destinationId === SKILL_ONLY_DESTINATION_ID) {
    return "bg-slate-100 text-slate-700";
  }
  return "bg-teal-50 text-teal-800";
}

export default function SkillPage() {
  const [entries, setEntries] = useState<SkillEntry[]>([]);
  const [status, setStatus] = useState("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConceptDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const selected = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );

  const loadEntries = useCallback(async (nextStatus = status) => {
    setLoading(true);
    const response = await fetch(`/api/skill?status=${nextStatus}`);
    const data = (await response.json()) as { entries: SkillEntry[] };
    setEntries(data.entries ?? []);
    setLoading(false);
  }, [status]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setSelectedId(id);
    const response = await fetch(`/api/skill/${id}`);
    if (!response.ok) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    const data = (await response.json()) as ConceptDetailResponse;
    setDetail(data);
    setDetailLoading(false);
  }, []);

  async function patchEntry(id: string, patch: Record<string, unknown>) {
    setSavingId(id);
    await fetch("/api/skill", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    await loadEntries();
    await loadDetail(id);
    setSavingId(null);
  }

  useEffect(() => {
    void loadEntries(status);
  }, [loadEntries, status]);

  useEffect(() => {
    if (entries.length && !selectedId) {
      void loadDetail(entries[0].id);
    }
  }, [entries, loadDetail, selectedId]);

  return (
    <section className="min-h-0 flex-1 space-y-6 overflow-y-auto">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Email analysis
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Extraction concepts
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Review what the AI extracted, see where each concept is routed today,
            and declare where facts should go. Promotion into destinations is
            recorded as intent first; execution arrives in a later phase.
          </p>
        </div>
        <label className="text-sm text-slate-700">
          Status{" "}
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setSelectedId(null);
              setDetail(null);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="merged">Merged</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Concepts</h2>
            <p className="text-xs text-slate-600">
              {entries.length} concept{entries.length === 1 ? "" : "s"}
            </p>
          </div>
          {loading ? (
            <p className="p-4 text-sm text-slate-600">Loading concepts...</p>
          ) : entries.length ? (
            <ul className="divide-y divide-slate-100">
              {entries.map((entry) => {
                const destinationId =
                  entry.routing.destinationId || SKILL_ONLY_DESTINATION_ID;
                const isSelected = entry.id === selectedId;

                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => void loadDetail(entry.id)}
                      className={`w-full px-4 py-3 text-left transition ${
                        isSelected ? "bg-teal-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">
                            {entry.conceptName}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                            {entry.description}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-slate-700">
                          {entry.occurrenceCount}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${routingBadgeClass(
                            destinationId,
                          )}`}
                        >
                          {routingLabel(entry)}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {entry.routing.configuredAt
                            ? "Intent saved"
                            : "No routing intent"}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-4 text-sm text-slate-600">
              No concepts for this status yet.
            </p>
          )}
        </div>

        <div className="min-w-0">
          {detailLoading ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
              Loading concept detail...
            </div>
          ) : detail && selected ? (
            <ConceptDetailPanel
              key={selected.id}
              entry={detail.entry}
              routingPreview={detail.routingPreview}
              routableDestinations={detail.routableDestinations}
              routingHistory={detail.routingHistory}
              saving={savingId === selected.id}
              onSaveRouting={async (input) => {
                await patchEntry(selected.id, input);
              }}
              onPatchEntry={async (patch) => {
                await patchEntry(selected.id, patch);
              }}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
              Select a concept to inspect routing transparency and declare intent.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
