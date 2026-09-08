"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

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
import { useEntityProfile } from "@/components/EntityProfileProvider";
import {
  sortEquipmentRegistrySummaries,
  type EquipmentRegistryListSort,
} from "@/lib/equipment/equipment-list-sort";
import { equipmentMatchesListSearch } from "@/lib/equipment/equipment-list-search";
import type {
  EquipmentRegistryStats,
  EquipmentRegistrySummary,
} from "@/lib/equipment/registry";

const EQUIPMENT_LIST_SORT_OPTIONS: Array<{
  value: EquipmentRegistryListSort;
  label: string;
}> = [
  { value: "mentions-desc", label: "Mentions (high → low)" },
  { value: "mentions-asc", label: "Mentions (low → high)" },
  { value: "name-asc", label: "Name (A → Z)" },
  { value: "name-desc", label: "Name (Z → A)" },
];

function EquipmentListSortMenu({
  value,
  onChange,
}: {
  value: EquipmentRegistryListSort;
  onChange: (next: EquipmentRegistryListSort) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const currentLabel =
    EQUIPMENT_LIST_SORT_OPTIONS.find((option) => option.value === value)
      ?.label ?? "Sort";

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0 border-b border-slate-200 bg-slate-50"
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Sort equipment: ${currentLabel}`}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100"
      >
        <span className="truncate">Sort: {currentLabel}</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Equipment sort options"
          className="absolute left-0 right-0 top-full z-20 border border-slate-200 bg-white py-1 shadow-lg"
        >
          {EQUIPMENT_LIST_SORT_OPTIONS.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={
                  selected
                    ? "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-teal-900 bg-teal-50"
                    : "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                }
              >
                <span>{option.label}</span>
                {selected ? (
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-teal-700"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      d="M3.5 8.5l3 3 6-7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ListSearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}

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
  parts.push(item.id);
  if (item.category?.trim()) parts.push(item.category.trim());
  if (item.location?.trim()) parts.push(item.location.trim());
  if (item.mentionCount > 0) {
    parts.push(
      `${item.mentionCount} mention${item.mentionCount === 1 ? "" : "s"}`,
    );
  } else if (item.eventCount > 0) {
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
    displayName: `${item.id}: ${item.displayName}`,
    subtitle: equipmentSubtitle(item) || null,
    searchText: [
      item.id,
      item.displayName,
      item.name,
      item.manufacturer,
      item.category,
      item.location,
      item.status,
      ...item.aliases,
      ...item.componentKeywords,
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
  const { openProfile } = useEntityProfile();
  const [mergeSource, setMergeSource] =
    useState<EquipmentRegistrySummary | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [listPage, setListPage] = useState(1);
  const [equipmentSort, setEquipmentSort] =
    useState<EquipmentRegistryListSort>("mentions-desc");
  const [listSearchOpen, setListSearchOpen] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const listSearchInputRef = useRef<HTMLInputElement>(null);

  const sortedEquipment = useMemo(
    () => sortEquipmentRegistrySummaries(equipment, equipmentSort),
    [equipment, equipmentSort],
  );

  const filteredEquipment = useMemo(() => {
    return sortedEquipment.filter((item) =>
      equipmentMatchesListSearch(item, listSearch),
    );
  }, [sortedEquipment, listSearch]);

  const pagedEquipment = useMemo(
    () => sliceEntityListPage(filteredEquipment, listPage),
    [filteredEquipment, listPage],
  );

  useEffect(() => {
    setListPage((page) => clampEntityListPage(page, filteredEquipment.length));
  }, [filteredEquipment.length]);

  useEffect(() => {
    if (listSearchOpen) listSearchInputRef.current?.focus();
  }, [listSearchOpen]);

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

  function changeEquipmentSort(next: EquipmentRegistryListSort) {
    if (next === equipmentSort) return;
    setEquipmentSort(next);
    setListPage(1);
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

  function runSeedCanonical() {
    startTransition(async () => {
      setMessage("Loading canonical equipment register…");
      const res = await fetch("/api/equipment/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed_canonical" }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        insertedOrUpdated?: number;
        total?: number;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? "Could not load canonical register.");
        return;
      }
      setMessage(
        `Loaded ${json.insertedOrUpdated ?? 0} canonical equipment assets (${json.total ?? 0} in seed).`,
      );
      await refreshData();
    });
  }

  function runHarvestMentions() {
    startTransition(async () => {
      setMessage("Harvesting equipment mentions from email corpus…");
      const res = await fetch("/api/equipment/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "harvest_mentions", limit: 10000 }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        scanned?: number;
        staged?: number;
        confirmed?: number;
        provisional?: number;
        unresolved?: number;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? "Equipment harvest failed.");
        return;
      }
      setMessage(
        `Harvested ${json.scanned ?? 0} mention${json.scanned === 1 ? "" : "s"} → ${json.staged ?? 0} staged (${json.confirmed ?? 0} confirmed, ${json.provisional ?? 0} provisional, ${json.unresolved ?? 0} unresolved).`,
      );
      await refreshData();
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
          {stats.provisionalCount > 0 ? (
            <div>
              <dt className="text-amber-600">Provisional</dt>
              <dd className="font-semibold text-amber-700">{stats.provisionalCount}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-slate-500">Mentions</dt>
            <dd className="font-semibold">{stats.mentionCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Maintenance events</dt>
            <dd className="font-semibold">{stats.eventCount}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-slate-600">
          Canonical equipment register with stable IDs, true name aliases, and component keywords.
          Use the merge icon to fold provisional or duplicate equipment into a canonical survivor.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {stats.equipmentCount === 0 ? (
            <button
              type="button"
              disabled={pending}
              onClick={runSeedCanonical}
              className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
            >
              Load canonical register
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={runHarvestMentions}
            className="rounded-md bg-orange-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-50"
          >
            Harvest equipment mentions
          </button>
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
        {equipment.length > 0 ? (
          <EquipmentListSortMenu
            value={equipmentSort}
            onChange={changeEquipmentSort}
          />
        ) : null}
        {sortedEquipment.length > 0 ? (
          <div className="flex shrink-0 items-center justify-end border-b border-slate-200 bg-white px-3 py-2">
            <button
              type="button"
              onClick={() => setListSearchOpen((prev) => !prev)}
              title="Search equipment"
              aria-label="Search equipment"
              aria-expanded={listSearchOpen}
              className={
                listSearchOpen
                  ? "rounded p-1.5 text-amber-700 bg-amber-50"
                  : "rounded p-1.5 text-slate-500 hover:bg-amber-50 hover:text-amber-700"
              }
            >
              <ListSearchIcon className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {listSearchOpen && sortedEquipment.length > 0 ? (
          <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">
            <input
              ref={listSearchInputRef}
              type="search"
              value={listSearch}
              onChange={(event) => {
                setListSearch(event.target.value);
                setListPage(1);
              }}
              placeholder="Filter by name, ID, manufacturer, category, location…"
              aria-label="Filter equipment by name or metadata"
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
            />
          </div>
        ) : null}
        <ul className="overflow-y-auto">
          {equipment.length === 0 ? (
            <li className="p-4 text-sm text-slate-500">
              No equipment yet. Run email analysis that extracts equipment /
              maintenance events.
            </li>
          ) : filteredEquipment.length === 0 ? (
            <li className="p-4 text-sm text-slate-500">
              No equipment matches your search.
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
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                        {item.id}
                      </span>
                      {item.status === "provisional" ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          Provisional
                        </span>
                      ) : null}
                    </div>
                    <span className="block text-sm font-medium text-slate-900 mt-1">
                      {item.displayName}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {item.category?.trim() || "Equipment"}
                      {item.location ? ` · ${item.location}` : ""}
                      {item.mentionCount > 0
                        ? ` · ${item.mentionCount} mention${item.mentionCount === 1 ? "" : "s"}`
                        : item.eventCount > 0
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
            total={filteredEquipment.length}
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
              <button
                type="button"
                onClick={() =>
                  openProfile({
                    kind: "equipment",
                    id: selected.id,
                    displayName: selected.displayName,
                  })
                }
                className="text-left"
              >
                <h2 className="text-lg font-semibold text-amber-800 underline-offset-2 hover:underline">
                  {selected.displayName}
                </h2>
              </button>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  {selected.id}
                </span>
                <span
                  className={
                    selected.status === "provisional"
                      ? "rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                      : "rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
                  }
                >
                  {selected.status === "provisional" ? "Provisional" : "Active"}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {selected.mentionCount > 0
                  ? `${selected.mentionCount} mention${selected.mentionCount === 1 ? "" : "s"}`
                  : "No staged mentions linked"}
                {" · "}
                {selected.eventCount > 0
                  ? `${selected.eventCount} maintenance event${selected.eventCount === 1 ? "" : "s"}`
                  : "No maintenance events linked"}
              </p>

              <dl className="mt-5 space-y-1.5">
                <FieldRow label="Name" value={selected.name} />
                <FieldRow label="Manufacturer" value={selected.manufacturer} />
                <FieldRow label="Model" value={selected.model} />
                <FieldRow label="Category" value={selected.category} />
                <FieldRow
                  label="Floor"
                  value={
                    selected.floor != null
                      ? selected.floor < 0
                        ? `P${-selected.floor}`
                        : String(selected.floor)
                      : null
                  }
                />
                <FieldRow label="Location" value={selected.location} />
                <FieldRow label="Drawing Ref" value={selected.drawingReference} />
                <FieldRow label="Notes / Specs" value={selected.notes} />
              </dl>

              {selected.aliases.length > 0 ? (
                <div className="mt-5 border-t border-slate-100 pt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    True Name Aliases ({selected.aliases.length})
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.aliases.map((alias) => (
                      <span
                        key={alias}
                        className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 border border-slate-200"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {selected.componentKeywords.length > 0 ? (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Component Keywords ({selected.componentKeywords.length})
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.componentKeywords.map((comp) => (
                      <span
                        key={comp}
                        className="rounded bg-sky-50 px-2 py-0.5 text-xs text-sky-800 border border-sky-200"
                      >
                        {comp}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
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
