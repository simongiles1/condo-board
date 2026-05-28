"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SkillEntry = {
  id: string;
  conceptName: string;
  description: string;
  suggestedFields: Array<{ name: string; type?: string; description?: string }>;
  exampleQuotes: string[];
  occurrenceCount: number;
  status: "active" | "archived" | "merged";
  category: string | null;
  userNotes: string | null;
};

type Fact = {
  id: string;
  payload: Record<string, unknown>;
  sourceQuote: string | null;
  confidence: string | null;
  createdAt: string;
};

function parseFields(value: string) {
  return value
    .split(",")
    .map((name) => ({ name: name.trim(), type: "string" }))
    .filter((field) => field.name);
}

export default function SkillPage() {
  const [entries, setEntries] = useState<SkillEntry[]>([]);
  const [status, setStatus] = useState("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);
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

  async function loadFacts(id: string) {
    setSelectedId(id);
    const response = await fetch(`/api/skill/${id}`);
    const data = (await response.json()) as { facts: Fact[] };
    setFacts(data.facts ?? []);
  }

  async function patchEntry(id: string, patch: Record<string, unknown>) {
    setSavingId(id);
    await fetch("/api/skill", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    await loadEntries();
    if (selectedId === id) {
      await loadFacts(id);
    }
    setSavingId(null);
  }

  useEffect(() => {
    void loadEntries(status);
  }, [loadEntries, status]);

  return (
    <section className="min-h-0 flex-1 space-y-6 overflow-y-auto">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Email analysis
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Dynamic extraction skill
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Review concepts learned from processed emails. Active concepts are
            injected into future extraction prompts; archived and merged entries
            stay available for audit.
          </p>
        </div>
        <label className="text-sm text-slate-700">
          Status{" "}
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="merged">Merged</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1.4fr_80px_120px_220px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>Concept</span>
            <span>Seen</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {loading ? (
            <p className="p-4 text-sm text-slate-600">Loading skill entries...</p>
          ) : entries.length ? (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[1.4fr_80px_120px_220px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
              >
                <div className="space-y-2">
                  <input
                    defaultValue={entry.conceptName}
                    onBlur={(event) => {
                      if (event.target.value !== entry.conceptName) {
                        void patchEntry(entry.id, {
                          conceptName: event.target.value,
                        });
                      }
                    }}
                    className="w-full rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-900"
                  />
                  <textarea
                    defaultValue={entry.description}
                    onBlur={(event) => {
                      if (event.target.value !== entry.description) {
                        void patchEntry(entry.id, {
                          description: event.target.value,
                        });
                      }
                    }}
                    className="h-16 w-full rounded-md border border-slate-200 px-2 py-1 text-slate-700"
                  />
                  <input
                    defaultValue={entry.suggestedFields
                      .map((field) => field.name)
                      .join(", ")}
                    onBlur={(event) =>
                      void patchEntry(entry.id, {
                        suggestedFields: parseFields(event.target.value),
                      })
                    }
                    placeholder="field_one, field_two"
                    className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
                  />
                </div>
                <span className="pt-2 font-semibold text-slate-900">
                  {entry.occurrenceCount}
                </span>
                <span className="pt-2 text-slate-700">{entry.status}</span>
                <div className="flex flex-wrap items-start gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void loadFacts(entry.id)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Facts
                  </button>
                  <button
                    type="button"
                    disabled={savingId === entry.id}
                    onClick={() =>
                      void patchEntry(entry.id, {
                        status:
                          entry.status === "archived" ? "active" : "archived",
                      })
                    }
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                  >
                    {entry.status === "archived" ? "Restore" : "Archive"}
                  </button>
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value) {
                        void patchEntry(entry.id, {
                          mergeIntoId: event.target.value,
                        });
                      }
                    }}
                    className="max-w-40 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                  >
                    <option value="">Merge into...</option>
                    {entries
                      .filter((target) => target.id !== entry.id)
                      .map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.conceptName}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            ))
          ) : (
            <p className="p-4 text-sm text-slate-600">
              No skill entries for this status yet.
            </p>
          )}
        </div>

        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-slate-900">
            {selected ? selected.conceptName : "Facts"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Click Facts on a concept to inspect extracted payloads.
          </p>
          <div className="mt-4 space-y-3">
            {facts.map((fact) => (
              <div key={fact.id} className="rounded-lg border border-slate-200 p-3">
                <pre className="whitespace-pre-wrap text-xs text-slate-800">
                  {JSON.stringify(fact.payload, null, 2)}
                </pre>
                {fact.sourceQuote ? (
                  <blockquote className="mt-2 border-l-2 border-teal-500 pl-2 text-xs text-slate-600">
                    {fact.sourceQuote}
                  </blockquote>
                ) : null}
                <p className="mt-2 text-xs text-slate-500">
                  {fact.confidence ?? "unknown"} confidence · {fact.createdAt}
                </p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
