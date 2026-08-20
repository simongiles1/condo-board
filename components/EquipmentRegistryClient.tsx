"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { EntityListPagination } from "@/components/EntityListPagination";
import {
  MergeEntityDialog,
  MergeIcon,
  type MergeEntityOption,
} from "@/components/MergeEntityDialog";
import {
  clampEntityListPage,
  sliceEntityListPage,
} from "@/lib/entities/registry-page";
import type {
  EquipmentRegistryStats,
  EquipmentRegistrySummary,
} from "@/lib/equipment/registry";

function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">
        {value?.trim() ? value : <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}

function equipmentSubtitle(item: EquipmentRegistrySummary): string {
  const parts: string[] = [];
  if (item.manufacturer?.trim()) parts.push(item.manufacturer.trim());
  if (item.category?.trim()) parts.push(item.category.trim());
  if (item.location?.trim()) parts.push(item.location.trim());
  if (item.eventCount > 0) {
    parts.push(
      `${item.eventCount} event${item.eventCount === 1 ? "" : "s"}`,
    );
  }
  return parts.join(" · ");
}

function equipmentToMergeOption(
  item: EquipmentRegistrySummary,
): MergeEntityOption {
  return {
    id: item.id,
    displayName: item.displayName,
    subtitle: equipmentSubtitle(item) || null,
    searchText: [
      item.displayName,
      item.name,
      item.manufacturer,
      item.category,
      item.location,
      item.kind,
      item.notes,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase(),
  };
}

export function EquipmentRegistryClient({
  initialEquipment,
  initialStats,
}: {
  initialEquipment: EquipmentRegistrySummary[];
  initialStats: EquipmentRegistryStats;
}) {
  const [equipment, setEquipment] = useState(initialEquipment);
  const [stats, setStats] = useState(initialStats);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialEquipment[0]?.id ?? null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mergeSource, setMergeSource] =
    useState<EquipmentRegistrySummary | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [listPage, setListPage] = useState(1);

  const pagedEquipment = useMemo(
    () => sliceEntityListPage(equipment, listPage),
    [equipment, listPage],
  );

  useEffect(() => {
    setListPage((page) => clampEntityListPage(page, equipment.length));
  }, [equipment.length]);

  const selected = useMemo(
    () => equipment.find((item) => item.id === selectedId) ?? null,
    [equipment, selectedId],
  );

  const mergeCandidates = useMemo(
    () => equipment.map(equipmentToMergeOption),
    [equipment],
  );

  async function refreshData(): Promise<EquipmentRegistrySummary[] | null> {
    const res = await fetch("/api/equipment/registry");
    const json = (await res.json()) as {
      equipment?: EquipmentRegistrySummary[];
      stats?: EquipmentRegistryStats;
      error?: string;
    };
    if (!res.ok) {
      setMessage(json.error ?? "Failed to refresh equipment.");
      return null;
    }
    const next = json.equipment ?? [];
    setEquipment(next);
    if (json.stats) setStats(json.stats);
    setSelectedId((prev) => {
      if (prev && next.some((item) => item.id === prev)) return prev;
      return next[0]?.id ?? null;
    });
    return next;
  }

  function refresh() {
    startTransition(async () => {
      setMessage(null);
      await refreshData();
    });
  }

  function runManualMerge(targetEquipmentId: string) {
    if (!mergeSource) return;
    const source = mergeSource;
    startTransition(async () => {
      setMergeError(null);
      setMessage(null);
      const res = await fetch("/api/equipment/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge",
          sourceEquipmentId: source.id,
          targetEquipmentId,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        survivorId?: string;
        error?: string;
      };
      if (!res.ok) {
        setMergeError(json.error ?? "Merge failed.");
        return;
      }
      setMergeSource(null);
      const targetName =
        equipment.find((item) => item.id === targetEquipmentId)?.displayName ??
        "equipment";
      setMessage(`Merged “${source.displayName}” into “${targetName}”.`);
      await refreshData();
      if (json.survivorId) setSelectedId(json.survivorId);
    });
  }

  return (
    <div>
      <header className="mb-6">
        <dl className="flex flex-wrap gap-6 text-sm text-slate-700">
          <div>
            <dt className="text-slate-500">Equipment</dt>
            <dd className="font-semibold">{stats.equipmentCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Maintenance events</dt>
            <dd className="font-semibold">{stats.eventCount}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-slate-600">
          Canonical equipment assets from email analysis. Use the merge icon to
          fold duplicates into one survivor (events re-point automatically).
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={refresh}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        {message ? (
          <p className="mt-3 text-sm text-slate-600" role="status">
            {message}
          </p>
        ) : null}
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="flex max-h-[70vh] flex-col overflow-hidden border border-slate-200 bg-white">
        <ul className="overflow-y-auto">
          {equipment.length === 0 ? (
            <li className="p-4 text-sm text-slate-500">
              No equipment yet. Run email analysis that extracts equipment /
              maintenance events.
            </li>
          ) : (
            pagedEquipment.map((item) => (
              <li key={item.id}>
                <div
                  className={
                    selectedId === item.id
                      ? "flex items-stretch border-b border-slate-100 bg-amber-50"
                      : "flex items-stretch border-b border-slate-100 hover:bg-slate-50"
                  }
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                  >
                    <span className="block text-sm font-medium text-slate-900">
                      {item.displayName}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {item.category?.trim() || item.kind || "Equipment"}
                      {item.eventCount > 0
                        ? ` · ${item.eventCount} event${item.eventCount === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    title={`Merge ${item.displayName} into another equipment item`}
                    aria-label={`Merge ${item.displayName} into another equipment item`}
                    disabled={pending}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMergeError(null);
                      setMergeSource(item);
                    }}
                    className="shrink-0 self-center px-2.5 py-2 text-slate-400 hover:text-amber-700 disabled:opacity-50"
                  >
                    <MergeIcon className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
          <EntityListPagination
            total={equipment.length}
            page={listPage}
            pending={pending}
            onPageChange={setListPage}
            ariaLabel="Equipment list pagination"
          />
        </div>

        <section className="border border-slate-200 bg-white p-4">
          {!selected ? (
            <p className="text-sm text-slate-500">Select equipment.</p>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-slate-900">
                {selected.displayName}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {selected.eventCount > 0
                  ? `${selected.eventCount} maintenance event${selected.eventCount === 1 ? "" : "s"}`
                  : "No maintenance events linked"}
              </p>

              <dl className="mt-5 space-y-1.5">
                <FieldRow label="Name" value={selected.name} />
                <FieldRow label="Manufacturer" value={selected.manufacturer} />
                <FieldRow label="Category" value={selected.category} />
                <FieldRow label="Location" value={selected.location} />
                <FieldRow label="Kind" value={selected.kind} />
                <FieldRow label="Significance" value={selected.significance} />
                <FieldRow label="Notes" value={selected.notes} />
              </dl>
            </>
          )}
        </section>
      </div>

      <MergeEntityDialog
        open={mergeSource != null}
        entityLabel="equipment"
        sources={mergeSource ? [equipmentToMergeOption(mergeSource)] : []}
        candidates={mergeCandidates}
        searchPlaceholder="Search by name, manufacturer, category, or location…"
        busy={pending}
        error={mergeError}
        onClose={() => {
          if (pending) return;
          setMergeSource(null);
          setMergeError(null);
        }}
        onMerge={runManualMerge}
      />
    </div>
  );
}
