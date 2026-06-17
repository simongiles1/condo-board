"use client";

import { useMemo, useState } from "react";

import {
  buildConceptRoutingPreview,
  SKILL_ONLY_DESTINATION_ID,
  type ConceptFieldMapping,
  type ConceptRoutingPreview,
  type RoutableConceptDestination,
} from "@/lib/email/concept-routing";

type SkillEntryDetail = {
  id: string;
  conceptName: string;
  description: string;
  suggestedFields: Array<{ name: string; type?: string; description?: string }>;
  occurrenceCount: number;
  status: string;
  routing: {
    destinationId: string;
    fieldMapping: ConceptFieldMapping;
    configuredAt: string | null;
  };
};

type RoutingHistoryItem = {
  id: string;
  createdAt: string;
  details: Record<string, unknown>;
};

type ConceptDetailPanelProps = {
  entry: SkillEntryDetail;
  routingPreview: ConceptRoutingPreview;
  routableDestinations: RoutableConceptDestination[];
  routingHistory: RoutingHistoryItem[];
  saving: boolean;
  onSaveRouting: (input: {
    routingDestinationId: string;
    fieldMapping: ConceptFieldMapping;
  }) => Promise<void>;
  onPatchEntry: (patch: Record<string, unknown>) => Promise<void>;
};

function routingBadgeClass(destinationId: string): string {
  if (destinationId === SKILL_ONLY_DESTINATION_ID) {
    return "bg-slate-100 text-slate-700";
  }
  return "bg-teal-50 text-teal-800";
}

export function ConceptDetailPanel({
  entry,
  routingPreview,
  routableDestinations,
  routingHistory,
  saving,
  onSaveRouting,
  onPatchEntry,
}: ConceptDetailPanelProps) {
  const [destinationId, setDestinationId] = useState(
    entry.routing.destinationId || SKILL_ONLY_DESTINATION_ID,
  );
  const [fieldMapping, setFieldMapping] = useState<ConceptFieldMapping>(
    entry.routing.fieldMapping,
  );

  const selectedDestination = useMemo(
    () =>
      routableDestinations.find((destination) => destination.id === destinationId) ??
      routableDestinations[0],
    [destinationId, routableDestinations],
  );

  const livePreview = useMemo(
    () =>
      buildConceptRoutingPreview({
        conceptName: entry.conceptName,
        config: {
          destinationId,
          fieldMapping,
          options: {},
          configuredAt: entry.routing.configuredAt,
        },
        suggestedFieldNames: entry.suggestedFields.map((field) => field.name),
        facts: routingPreview.facts.map((fact) => ({
          id: fact.factId,
          payload: fact.payload,
          sourceQuote: fact.sourceQuote,
          confidence: fact.confidence,
          createdAt: fact.createdAt,
        })),
      }),
    [
      destinationId,
      entry.conceptName,
      entry.routing.configuredAt,
      entry.suggestedFields,
      fieldMapping,
      routingPreview.facts,
    ],
  );

  const routingDirty =
    destinationId !== (entry.routing.destinationId || SKILL_ONLY_DESTINATION_ID) ||
    fieldMapping.date !== entry.routing.fieldMapping.date ||
    fieldMapping.title !== entry.routing.fieldMapping.title ||
    fieldMapping.description !== entry.routing.fieldMapping.description;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Concept
            </p>
            <h2 className="text-lg font-semibold text-slate-900">
              {entry.conceptName}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{entry.description}</p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${routingBadgeClass(
              entry.routing.destinationId || SKILL_ONLY_DESTINATION_ID,
            )}`}
          >
            {livePreview.destinationTitle}
          </span>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900">Routing transparency</h3>
            <p className="mt-1 text-sm text-slate-600">
              Where facts for this concept are stored today, and where you intend
              them to go.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <p>
              <span className="font-semibold">{livePreview.totalFacts}</span>{" "}
              facts extracted
            </p>
            <p className="mt-1">
              Currently stored in{" "}
              <span className="font-semibold">discovered_facts</span> only
            </p>
            <p className="mt-1">
              Promoted elsewhere:{" "}
              <span className="font-semibold">0</span> (execution phase pending)
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Configured destination"
            value={livePreview.destinationTitle}
          />
          <StatCard
            label="Would promote (preview)"
            value={String(livePreview.promotableCount)}
          />
          <StatCard
            label="Blocked in preview"
            value={String(livePreview.blockedCount)}
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-slate-900">Declare routing intent</h3>
        <p className="mt-1 text-sm text-slate-600">
          Choose where this concept should live. Saving records your decision for
          audit; automatic promotion comes in a later phase.
        </p>

        <div className="mt-4 space-y-4">
          <label className="block text-sm text-slate-700">
            Destination
            <select
              value={destinationId}
              onChange={(event) => setDestinationId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {routableDestinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.title}
                </option>
              ))}
            </select>
          </label>

          {selectedDestination ? (
            <p className="text-sm text-slate-600">{selectedDestination.description}</p>
          ) : null}

          {destinationId === "calendar" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <MappingField
                label="Date field"
                value={fieldMapping.date ?? livePreview.inferredFieldMapping.date ?? ""}
                placeholder={livePreview.inferredFieldMapping.date ?? "date"}
                onChange={(value) =>
                  setFieldMapping((current) => ({ ...current, date: value || undefined }))
                }
              />
              <MappingField
                label="Title field"
                value={fieldMapping.title ?? livePreview.inferredFieldMapping.title ?? ""}
                placeholder={livePreview.inferredFieldMapping.title ?? "name"}
                onChange={(value) =>
                  setFieldMapping((current) => ({ ...current, title: value || undefined }))
                }
              />
              <MappingField
                label="Description field"
                value={
                  fieldMapping.description ??
                  livePreview.inferredFieldMapping.description ??
                  ""
                }
                placeholder={
                  livePreview.inferredFieldMapping.description ?? "description"
                }
                onChange={(value) =>
                  setFieldMapping((current) => ({
                    ...current,
                    description: value || undefined,
                  }))
                }
              />
            </div>
          ) : null}

          {selectedDestination?.executionNote ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {selectedDestination.executionNote}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || !routingDirty}
              onClick={() =>
                void onSaveRouting({
                  routingDestinationId: destinationId,
                  fieldMapping: {
                    date:
                      fieldMapping.date || livePreview.inferredFieldMapping.date,
                    title:
                      fieldMapping.title || livePreview.inferredFieldMapping.title,
                    description:
                      fieldMapping.description ||
                      livePreview.inferredFieldMapping.description,
                  },
                })
              }
              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save routing intent"}
            </button>
            {entry.routing.configuredAt ? (
              <p className="self-center text-xs text-slate-500">
                Last saved {new Date(entry.routing.configuredAt).toLocaleString()}
              </p>
            ) : (
              <p className="self-center text-xs text-slate-500">
                No routing intent saved yet
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-slate-900">Fact preview</h3>
        <p className="mt-1 text-sm text-slate-600">
          Per-fact view of what the system captured and what would happen under
          the current routing intent.
        </p>

        <div className="mt-4 space-y-3">
          {livePreview.facts.length ? (
            livePreview.facts.map((fact) => (
              <article
                key={fact.factId}
                className="rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {fact.proposedTitle ?? entry.conceptName}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">{fact.promotionNote}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      fact.promotable
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {fact.promotable ? "Preview ready" : "Not promotable"}
                  </span>
                </div>

                <dl className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold text-slate-500">Storage</dt>
                    <dd>{fact.currentStorage}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">Target</dt>
                    <dd>{fact.configuredDestinationTitle}</dd>
                  </div>
                  {fact.proposedDate ? (
                    <div>
                      <dt className="font-semibold text-slate-500">Preview date</dt>
                      <dd>{fact.proposedDate}</dd>
                    </div>
                  ) : null}
                  {fact.proposedDescription ? (
                    <div>
                      <dt className="font-semibold text-slate-500">Preview detail</dt>
                      <dd>{fact.proposedDescription}</dd>
                    </div>
                  ) : null}
                </dl>

                <pre className="mt-3 overflow-x-auto rounded-md bg-slate-50 p-2 text-xs text-slate-800">
                  {JSON.stringify(fact.payload, null, 2)}
                </pre>
                {fact.sourceQuote ? (
                  <blockquote className="mt-2 border-l-2 border-teal-500 pl-2 text-xs text-slate-600">
                    {fact.sourceQuote}
                  </blockquote>
                ) : null}
              </article>
            ))
          ) : (
            <p className="text-sm text-slate-600">No facts extracted for this concept yet.</p>
          )}
        </div>
      </section>

      {routingHistory.length ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-slate-900">Routing decisions</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {routingHistory.map((item) => (
              <li key={item.id} className="rounded-md border border-slate-100 px-3 py-2">
                <span className="font-medium">
                  {String(item.details.destinationId ?? "skill_only")}
                </span>
                <span className="text-slate-500">
                  {" "}
                  · {new Date(item.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-slate-900">Concept metadata</h3>
        <div className="mt-3 space-y-3">
          <textarea
            defaultValue={entry.description}
            onBlur={(event) => {
              if (event.target.value !== entry.description) {
                void onPatchEntry({ description: event.target.value });
              }
            }}
            className="h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
          />
          <input
            defaultValue={entry.suggestedFields.map((field) => field.name).join(", ")}
            onBlur={(event) => {
              const suggestedFields = event.target.value
                .split(",")
                .map((name) => ({ name: name.trim(), type: "string" }))
                .filter((field) => field.name);
              void onPatchEntry({ suggestedFields });
            }}
            placeholder="field_one, field_two"
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700"
          />
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function MappingField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm text-slate-700">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
    </label>
  );
}
