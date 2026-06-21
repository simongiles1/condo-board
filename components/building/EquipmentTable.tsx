"use client";

import { useMemo, useState } from "react";

import { EmailSidePanel } from "@/components/EmailSidePanel";
import { EquipmentViewToggle } from "@/components/EquipmentTimeline";
import { AssetEmailInfoPopover } from "@/components/building/AssetEmailInfoPopover";
import {
  EquipmentTableTabStrip,
  type EquipmentTableTabId,
} from "@/components/building/EquipmentTableTabStrip";
import {
  equipmentClassificationLabel,
  filterClassifiedEquipment,
} from "@/lib/equipment/classification";
import type {
  BuildingEquipmentAssetRow,
  BuildingMaintenanceEventRow,
} from "@/lib/building/fetch-equipment";

type EquipmentTableProps = {
  events: BuildingMaintenanceEventRow[];
  assets: BuildingEquipmentAssetRow[];
};

function formatDate(
  occurredAt: string | null,
  occurredTime: string | null,
): string {
  if (!occurredAt) return "Unknown";
  return occurredTime ? `${occurredAt} ${occurredTime}` : occurredAt;
}

function formatCost(cost: string | null): string {
  if (!cost) return "—";
  return cost.startsWith("$") ? cost : `$${cost}`;
}

function defaultTableTab(
  assets: BuildingEquipmentAssetRow[],
  events: BuildingMaintenanceEventRow[],
): EquipmentTableTabId {
  if (assets.length > 0) return "assets";
  if (events.length > 0) return "events";
  return "assets";
}

export function EquipmentTable({ events, assets }: EquipmentTableProps) {
  const [activeTab, setActiveTab] = useState<EquipmentTableTabId>(() =>
    defaultTableTab(assets, events),
  );
  const [panelEmailId, setPanelEmailId] = useState<string | null>(null);
  const [showAllEquipment, setShowAllEquipment] = useState(false);

  const visibleAssets = useMemo(
    () =>
      filterClassifiedEquipment(
        assets.map((asset) => ({
          ...asset,
          kind: asset.kind,
          significance: asset.significance,
          canonicalId: asset.canonicalId,
        })),
        showAllEquipment,
      ),
    [assets, showAllEquipment],
  );

  const visibleEvents = useMemo(
    () =>
      filterClassifiedEquipment(
        events.map((event) => ({
          ...event,
          kind: event.equipmentKind,
          significance: event.equipmentSignificance,
          canonicalId: event.equipmentCanonicalId,
        })),
        showAllEquipment,
      ),
    [events, showAllEquipment],
  );

  const hiddenCount = useMemo(() => {
    const hiddenAssets =
      assets.length -
      filterClassifiedEquipment(
        assets.map((asset) => ({
          kind: asset.kind,
          significance: asset.significance,
          canonicalId: asset.canonicalId,
        })),
        false,
      ).length;
    const hiddenEvents =
      events.length -
      filterClassifiedEquipment(
        events.map((event) => ({
          kind: event.equipmentKind,
          significance: event.equipmentSignificance,
          canonicalId: event.equipmentCanonicalId,
        })),
        false,
      ).length;
    return Math.max(hiddenAssets, hiddenEvents);
  }, [assets, events]);

  if (!events.length && !assets.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No equipment data yet. Analyze emails mentioning repairs, replacements,
        or service calls to populate this table.
      </p>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <EquipmentTableTabStrip
            active={activeTab}
            onChange={setActiveTab}
            counts={{
              assets: visibleAssets.length,
              events: visibleEvents.length,
            }}
          />
          <EquipmentViewToggle
            showAll={showAllEquipment}
            onChange={setShowAllEquipment}
            hiddenCount={hiddenCount}
          />
        </div>

        {activeTab === "assets" ? (
          visibleAssets.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th
                      scope="col"
                      className="w-10 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      <span className="sr-only">Emails</span>
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      Equipment
                    </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Location
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Category
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Events
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Last event
                  </th>
                </tr>
              </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleAssets.map((asset) => (
                    <tr key={asset.id} className="hover:bg-slate-50/80">
                      <td className="px-3 py-2">
                        <AssetEmailInfoPopover
                          emails={asset.relatedEmails}
                          onOpenEmail={setPanelEmailId}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        <div className="space-y-1">
                          <div>{asset.name}</div>
                          <div className="text-xs font-normal text-slate-500">
                            {equipmentClassificationLabel({
                              kind: asset.kind,
                              significance: asset.significance,
                              canonicalId: asset.canonicalId,
                            })}
                          </div>
                        </div>
                      </td>
                    <td className="px-3 py-2 text-slate-600">
                      {asset.location ?? "—"}
                    </td>
                    <td className="px-3 py-2 capitalize text-slate-600">
                      {asset.manufacturer ?? asset.category ?? "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">
                      {asset.eventCount}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">
                      {asset.lastEventAt ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            No equipment assets yet.
          </p>
        )
      ) : visibleEvents.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Date
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Equipment
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Event
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Location
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Vendor
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Cost
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="min-w-48 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Description
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Email
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleEvents.map((event) => (
                <tr key={event.id} className="hover:bg-slate-50/80">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                    {formatDate(event.occurredAt, event.occurredTime)}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {event.equipmentName}
                  </td>
                  <td className="px-3 py-2 capitalize text-teal-700">
                    {event.eventType}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {event.equipmentLocation ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {event.vendorName ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                    {formatCost(event.cost)}
                  </td>
                  <td className="px-3 py-2 capitalize text-slate-600">
                    {event.status ?? "—"}
                  </td>
                  <td className="max-w-xs px-3 py-2 text-slate-700">
                    {event.description ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {event.email ? (
                      <button
                        type="button"
                        onClick={() => setPanelEmailId(event.email?.emailId ?? null)}
                        className="text-sm font-medium text-teal-700 hover:text-teal-900 hover:underline"
                      >
                        View email
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No maintenance events yet.
        </p>
      )}
      </div>

      <EmailSidePanel
        emailId={panelEmailId}
        onClose={() => setPanelEmailId(null)}
      />
    </>
  );
}
