"use client";

type MaintenanceEvent = {
  id: string;
  equipmentName: string;
  eventType: string;
  occurredAt: string | null;
  occurredTime: string | null;
  vendorName: string | null;
  cost: string | null;
  description: string | null;
};

export function EquipmentTimeline({ events }: { events: MaintenanceEvent[] }) {
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
              <h3 className="font-semibold text-slate-900">{event.equipmentName}</h3>
              <p className="text-sm capitalize text-teal-700">{event.eventType}</p>
            </div>
            <p className="text-sm tabular-nums text-slate-600">
              {event.occurredAt
                ? `${event.occurredAt}${event.occurredTime ? ` ${event.occurredTime}` : ""}`
                : "Date unknown"}
            </p>
          </div>
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
