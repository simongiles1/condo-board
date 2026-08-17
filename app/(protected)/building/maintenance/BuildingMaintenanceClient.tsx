"use client";

import { useState } from "react";

import { EquipmentTable } from "@/components/building/EquipmentTable";
import {
  EquipmentTimeline,
  type MaintenanceEvent,
} from "@/components/EquipmentTimeline";
import {
  ExtractionSidePanel,
  type ExtractionPanelTarget,
} from "@/components/ExtractionSidePanel";
import type { BuildingEquipmentData } from "@/lib/building/fetch-equipment";

export function BuildingMaintenanceClient({
  tableData,
  timelineEvents,
}: {
  tableData: BuildingEquipmentData;
  timelineEvents: MaintenanceEvent[];
}) {
  const [extractionTarget, setExtractionTarget] =
    useState<ExtractionPanelTarget | null>(null);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Building model
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          Maintenance history
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Extracted maintenance events and equipment assets from analyzed emails.
        </p>
      </div>

      <EquipmentTable events={tableData.events} assets={tableData.assets} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Timeline ({timelineEvents.length})
        </h2>
        <EquipmentTimeline
          events={timelineEvents}
          onOpenSourceEmail={(emailId) =>
            setExtractionTarget({ kind: "email", emailId })
          }
        />
      </section>

      <ExtractionSidePanel
        target={extractionTarget}
        processingEntries={[]}
        onClose={() => setExtractionTarget(null)}
      />
    </section>
  );
}
