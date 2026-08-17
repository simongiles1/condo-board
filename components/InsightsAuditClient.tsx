"use client";

import { useState } from "react";

import {
  ExtractionSidePanel,
  type ExtractionPanelTarget,
} from "@/components/ExtractionSidePanel";
import { InsightSourceEmailsBadge } from "@/components/InsightSourceEmailsBadge";
import type { MaintenanceEvent } from "@/components/EquipmentTimeline";
import type { ActionItemRow } from "@/lib/insights/load-insights-pages";
import { TODO_WORKING_WINDOW_DAYS } from "@/lib/email-analysis/todo-lifecycle";

export function InsightsAuditClient({
  events,
  actionItems,
}: {
  events: MaintenanceEvent[];
  actionItems: ActionItemRow[];
}) {
  const [extractionTarget, setExtractionTarget] =
    useState<ExtractionPanelTarget | null>(null);

  const eventsWithSources = events.filter(
    (event) => (event.sourceEmails?.length ?? 0) > 0,
  );
  const actionsWithSources = actionItems.filter(
    (item) => item.sourceEmails.length > 0,
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Insights
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">Source audits</h1>
        <p className="mt-1 text-sm text-slate-600">
          Trace extracted maintenance events and action items back to their
          source emails.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Maintenance events with sources ({eventsWithSources.length})
          </h2>
          {eventsWithSources.length > 0 ? (
            <div className="space-y-2">
              {eventsWithSources.map((event) => (
                <div
                  key={event.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {event.equipmentName}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {event.eventType}
                        {event.occurredAt ? ` · ${event.occurredAt}` : ""}
                        {event.vendorName ? ` · ${event.vendorName}` : ""}
                      </p>
                      {event.description ? (
                        <p className="mt-1 text-sm text-slate-500">
                          {event.description}
                        </p>
                      ) : null}
                    </div>
                    <InsightSourceEmailsBadge
                      emails={event.sourceEmails ?? []}
                      onOpenEmail={(emailId) =>
                        setExtractionTarget({ kind: "email", emailId })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <p className="text-sm text-slate-600">
                No maintenance events with linked source emails yet.
              </p>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Action items with sources ({actionsWithSources.length})
          </h2>
          <p className="text-sm text-slate-600">
            Email to-dos are from the last {TODO_WORKING_WINDOW_DAYS} days.
          </p>
          {actionsWithSources.length > 0 ? (
            <div className="space-y-2">
              {actionsWithSources.map((item) => (
                <div
                  key={`${item.source}-${item.id}`}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {item.description}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {item.assignee} · {item.source} · {item.context}
                        {item.deadline ? ` · due ${item.deadline}` : ""}
                      </p>
                    </div>
                    <InsightSourceEmailsBadge
                      emails={item.sourceEmails}
                      onOpenEmail={(emailId) =>
                        setExtractionTarget({ kind: "email", emailId })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <p className="text-sm text-slate-600">
                No action items with linked source emails yet.
              </p>
            </div>
          )}
        </section>
      </div>

      <ExtractionSidePanel
        target={extractionTarget}
        processingEntries={[]}
        onClose={() => setExtractionTarget(null)}
      />
    </section>
  );
}
