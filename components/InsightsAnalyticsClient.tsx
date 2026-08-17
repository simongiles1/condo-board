"use client";

import { useMemo, useState } from "react";

import {
  EquipmentTimeline,
  EquipmentViewToggle,
  filterEquipmentEvents,
  type MaintenanceEvent,
} from "@/components/EquipmentTimeline";
import {
  ExtractionSidePanel,
  type ExtractionPanelTarget,
} from "@/components/ExtractionSidePanel";
import { InsightSourceEmailsBadge } from "@/components/InsightSourceEmailsBadge";
import type { ActionItemRow } from "@/lib/insights/load-insights-pages";
import { TODO_WORKING_WINDOW_DAYS } from "@/lib/email-analysis/todo-lifecycle";

export function InsightsAnalyticsClient({
  events,
  actionItems,
}: {
  events: MaintenanceEvent[];
  actionItems: ActionItemRow[];
}) {
  const [showAllEquipment, setShowAllEquipment] = useState(false);
  const [extractionTarget, setExtractionTarget] =
    useState<ExtractionPanelTarget | null>(null);

  const visibleEquipmentEvents = useMemo(
    () => filterEquipmentEvents(events, showAllEquipment),
    [events, showAllEquipment],
  );

  const hiddenEquipmentCount = useMemo(
    () => events.length - filterEquipmentEvents(events, false).length,
    [events],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Insights
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          Operational analytics
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Equipment maintenance timeline and open action items across meetings
          and email.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Equipment &amp; maintenance
            </h2>
            <EquipmentViewToggle
              showAll={showAllEquipment}
              onChange={setShowAllEquipment}
              hiddenCount={hiddenEquipmentCount}
            />
          </div>
          <EquipmentTimeline
            events={visibleEquipmentEvents}
            onOpenSourceEmail={(emailId) =>
              setExtractionTarget({ kind: "email", emailId })
            }
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Unified action items ({actionItems.length})
          </h2>
          <p className="text-sm text-slate-600">
            Email to-dos are from the last {TODO_WORKING_WINDOW_DAYS} days.
          </p>
          {actionItems.length > 0 ? (
            <div className="space-y-2">
              {actionItems.map((item) => (
                <div
                  key={`${item.source}-${item.id}`}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {item.description}
                    </p>
                    {item.sourceEmails.length > 0 ? (
                      <InsightSourceEmailsBadge
                        emails={item.sourceEmails}
                        onOpenEmail={(emailId) =>
                          setExtractionTarget({ kind: "email", emailId })
                        }
                      />
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.assignee} · {item.source} · {item.context}
                    {item.deadline ? ` · due ${item.deadline}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <p className="text-sm text-slate-600">No open action items yet.</p>
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
