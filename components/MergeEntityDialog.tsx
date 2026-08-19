"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FormDialog } from "@/components/FormDialog";
import {
  rankMergeOptions,
  type MergeSearchOption,
} from "@/lib/contacts/merge-search";

export type MergeEntityOption = MergeSearchOption & {
  subtitle?: string | null;
};

type Props = {
  open: boolean;
  entityLabel: string;
  sources: MergeEntityOption[];
  candidates: MergeEntityOption[];
  searchPlaceholder?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onMerge: (targetId: string) => void;
  /** Override merge copy for other actions (e.g. move a field). */
  copy?: {
    title: string;
    description: string;
    submitLabel: string;
    busyLabel?: string;
    intoLabel?: string;
    hideSources?: boolean;
    pickError?: string;
  };
};

export function MergeIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="4" cy="3.5" r="1.75" />
      <circle cx="4" cy="12.5" r="1.75" />
      <circle cx="12" cy="12.5" r="1.75" />
      <path d="M4 5.25v5.5M4 8h4.5a3.5 3.5 0 0 1 3.5 3.5" />
    </svg>
  );
}

type DropdownRect = { top: number; left: number; width: number };

export function MergeEntityDialog({
  open,
  entityLabel,
  sources,
  candidates,
  searchPlaceholder = "Search by name, email, or phone…",
  busy = false,
  error = null,
  onClose,
  onMerge,
  copy,
}: Props) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dropdownRect, setDropdownRect] = useState<DropdownRect | null>(null);
  const [mounted, setMounted] = useState(false);

  const sourceIds = useMemo(
    () => new Set(sources.map((item) => item.id)),
    [sources],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedId(null);
    setHighlightIndex(0);
    setDropdownOpen(false);
    setLocalError(null);
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, sources.map((item) => item.id).join(",")]);

  const filtered = useMemo(() => {
    if (sources.length === 0) return [];
    return rankMergeOptions(
      candidates.filter((item) => !sourceIds.has(item.id)),
      query,
    );
  }, [candidates, query, sourceIds, sources.length]);

  const selected = useMemo(
    () => candidates.find((item) => item.id === selectedId) ?? null,
    [candidates, selectedId],
  );

  const showDropdown = dropdownOpen && Boolean(query.trim());

  function updateDropdownRect() {
    const input = inputRef.current;
    if (!input) {
      setDropdownRect(null);
      return;
    }
    const rect = input.getBoundingClientRect();
    setDropdownRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }

  useLayoutEffect(() => {
    if (!showDropdown) {
      setDropdownRect(null);
      return;
    }
    updateDropdownRect();
    function onReposition() {
      updateDropdownRect();
    }
    window.addEventListener("resize", onReposition);
    // Capture scroll from dialog body / ancestors so the menu stays aligned.
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [showDropdown, query, filtered.length]);

  useEffect(() => {
    setHighlightIndex((prev) =>
      filtered.length === 0 ? 0 : Math.min(prev, filtered.length - 1),
    );
  }, [filtered.length]);

  useEffect(() => {
    if (!showDropdown) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (inputRef.current?.contains(target)) return;
      if (listboxRef.current?.contains(target)) return;
      setDropdownOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showDropdown]);

  function pickOption(option: MergeEntityOption) {
    setSelectedId(option.id);
    setQuery(option.displayName);
    setDropdownOpen(false);
    setLocalError(null);
  }

  if (sources.length === 0) return null;

  const mergeDescription =
    copy?.description ??
    (sources.length === 1
      ? `Merge “${sources[0]!.displayName}” into another ${entityLabel}. The selected ${entityLabel} keeps the combined data; this one is removed.`
      : `Merge ${sources.length} ${entityLabel}s into one. The ${entityLabel} you pick keeps the combined data; the selected ones are removed.`);

  const dialogTitle =
    copy?.title ??
    (sources.length === 1
      ? `Merge ${entityLabel}`
      : `Merge ${sources.length} ${entityLabel}s`);
  const submitLabel =
    copy?.submitLabel ??
    (sources.length === 1 ? "Merge" : `Merge ${sources.length}`);
  const busyLabel = copy?.busyLabel ?? "Merging…";
  const intoLabel = copy?.intoLabel ?? "Merge into";
  const pickError =
    copy?.pickError ??
    `Pick a ${entityLabel} from the search results to merge into.`;
  const hideSources = Boolean(copy?.hideSources);

  const dropdown =
    mounted && showDropdown && dropdownRect
      ? createPortal(
          <ul
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            style={{
              position: "fixed",
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
              maxHeight: 300,
            }}
            className="z-[80] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-500">
                No matching {entityLabel}s
              </li>
            ) : (
              filtered.map((option, index) => (
                <li
                  key={option.id}
                  role="option"
                  aria-selected={index === highlightIndex}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => pickOption(option)}
                    className={
                      index === highlightIndex
                        ? "w-full px-3 py-2 text-left bg-teal-50"
                        : "w-full px-3 py-2 text-left hover:bg-slate-50"
                    }
                  >
                    <span className="block text-sm font-medium text-slate-900">
                      {option.displayName}
                    </span>
                    {option.subtitle ? (
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {option.subtitle}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>,
          document.body,
        )
      : null;

  return (
    <FormDialog
      open={open}
      title={dialogTitle}
      description={mergeDescription}
      busy={busy}
      error={localError ?? error}
      submitLabel={submitLabel}
      busyLabel={busyLabel}
      onClose={onClose}
      onSubmit={() => {
        if (!selectedId) {
          setLocalError(pickError);
          return;
        }
        setLocalError(null);
        onMerge(selectedId);
      }}
    >
      <div className="space-y-4">
        {hideSources ? null : (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Merging away ({sources.length})
          </p>
          <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
            {sources.map((source) => (
              <li key={source.id}>
                <p className="text-sm font-medium text-slate-900">
                  {source.displayName}
                </p>
                {source.subtitle ? (
                  <p className="mt-0.5 text-xs text-slate-500">{source.subtitle}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        )}

        <div>
          <label
            htmlFor="merge-entity-search"
            className="block text-sm font-medium text-slate-800"
          >
            {intoLabel}
          </label>
          <div className="relative mt-1">
            <input
              ref={inputRef}
              id="merge-entity-search"
              type="text"
              role="combobox"
              aria-expanded={showDropdown}
              aria-controls={listboxId}
              aria-autocomplete="list"
              autoComplete="off"
              disabled={busy}
              value={query}
              placeholder={searchPlaceholder}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedId(null);
                setDropdownOpen(true);
                setHighlightIndex(0);
                setLocalError(null);
              }}
              onFocus={() => setDropdownOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setDropdownOpen(true);
                  setHighlightIndex((i) =>
                    filtered.length === 0
                      ? 0
                      : Math.min(i + 1, filtered.length - 1),
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlightIndex((i) => Math.max(i - 1, 0));
                } else if (
                  e.key === "Enter" &&
                  showDropdown &&
                  filtered[highlightIndex]
                ) {
                  e.preventDefault();
                  pickOption(filtered[highlightIndex]);
                } else if (e.key === "Escape" && showDropdown) {
                  e.preventDefault();
                  e.stopPropagation();
                  setDropdownOpen(false);
                }
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
            />
            {dropdown}
          </div>
          {selected ? (
            <p className="mt-2 text-xs text-slate-600">
              Selected:{" "}
              <span className="font-medium text-slate-900">
                {selected.displayName}
              </span>
              {selected.subtitle ? ` · ${selected.subtitle}` : ""}
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              Type to search, then pick a {entityLabel} from the list.
            </p>
          )}
        </div>
      </div>
    </FormDialog>
  );
}
