"use client";

import { InsightSourceEmailsBadge } from "@/components/InsightSourceEmailsBadge";
import type { BuildingEmailReference } from "@/lib/building/resolve-source-email";
import {
  equipmentClassificationLabel,
  filterClassifiedEquipment,
  type EquipmentClassification,
} from "@/lib/equipment/classification";

export type MaintenanceEvent = {
  id: string;
  equipmentName: string;
  eventType: string;
  occurredAt: string | null;
  occurredTime: string | null;
  vendorName: string | null;
  cost: string | null;
  description: string | null;
  equipmentKind?: string | null;
  equipmentSignificance?: string | null;
  equipmentManufacturer?: string | null;
  equipmentCanonicalId?: string | null;
  sourceEmails?: BuildingEmailReference[];
};

export function filterEquipmentEvents(
  events: MaintenanceEvent[],
  showAll: boolean,
): MaintenanceEvent[] {
  return filterClassifiedEquipment(
    events.map((event) => ({
      ...event,
      kind: event.equipmentKind,
      significance: event.equipmentSignificance,
      canonicalId: event.equipmentCanonicalId,
    })),
    showAll,
  );
}

export function EquipmentViewToggle({
  showAll,
  onChange,
  hiddenCount,
}: {
  showAll: boolean;
  onChange: (showAll: boolean) => void;
  hiddenCount: number;
}) {
  if (hiddenCount <= 0 && !showAll) return null;

  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <input
        type="checkbox"
        checked={showAll}
        onChange={(event) => onChange(event.target.checked)}
        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      />
      Show minor / components / manufacturers
      {!showAll && hiddenCount > 0 ? (
        <span className="text-slate-400">({hiddenCount} hidden)</span>
      ) : null}
    </label>
  );
}

function eventClassification(event: MaintenanceEvent): EquipmentClassification {
  return {
    kind: event.equipmentKind,
    significance: event.equipmentSignificance,
    canonicalId: event.equipmentCanonicalId,
  };
}

export function EquipmentTimeline({
  events,
  onOpenSourceEmail,
}: {
  events: MaintenanceEvent[];
  onOpenSourceEmail?: (emailId: string) => void;
}) {
  if (!events.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
        No maintenance events yet. Analyze emails mentioning repairs or replacements.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <article
          key={event.id}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-slate-900">{event.equipmentName}</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {equipmentClassificationLabel(eventClassification(event))}
                </span>
              </div>
              <p className="text-sm capitalize text-teal-700">{event.eventType}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {onOpenSourceEmail && event.sourceEmails?.length ? (
                <InsightSourceEmailsBadge
                  emails={event.sourceEmails}
                  onOpenEmail={onOpenSourceEmail}
                />
              ) : null}
              <p className="text-sm tabular-nums text-slate-600">
                {event.occurredAt
                  ? `${event.occurredAt}${event.occurredTime ? ` ${event.occurredTime}` : ""}`
                  : "Date unknown"}
              </p>
            </div>
          </div>
          {event.equipmentManufacturer ? (
            <p className="mt-2 text-sm text-slate-600">
              Manufacturer: {event.equipmentManufacturer}
            </p>
          ) : null}
          {event.vendorName ? (
            <p className="mt-2 text-sm text-slate-600">Vendor: {event.vendorName}</p>
          ) : null}
          {event.cost ? (
            <p className="text-sm text-slate-600">Cost: ${event.cost}</p>
          ) : null}
          {event.description ? (
            <p className="mt-2 text-sm text-slate-700">{event.description}</p>
          ) : null}
        </article>
      ))}
    </div>
  );
}
