"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  type EmailAddressField,
  buildEmailThreadSearchParams,
  hasActiveFilters,
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "@/lib/email/thread-filter-params";
import { EmailFromMultiSelect, type EmailFromMultiSelectHandle } from "@/components/EmailFromMultiSelect";

const FIELD_OPTIONS: Array<{ id: EmailAddressField; label: string }> = [
  { id: "from", label: "From" },
  { id: "cc", label: "CC" },
  { id: "both", label: "Both" },
];

function isoToDatetimeLocal(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function datetimeLocalToIso(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function EmailFilterButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rootRef = useRef<HTMLDivElement>(null);
  const fromMultiSelectRef = useRef<EmailFromMultiSelectHandle>(null);

  const activeFilters = parseEmailThreadFilters(
    searchParamsToFilterRecord(searchParams),
  );
  const filtersActive = hasActiveFilters(activeFilters);

  const [menuOpen, setMenuOpen] = useState(false);
  const [fromAddresses, setFromAddresses] = useState<string[]>(
    activeFilters.fromAddresses ?? [],
  );
  const [field, setField] = useState<EmailAddressField>(activeFilters.field);
  const [startedChainOnly, setStartedChainOnly] = useState(
    Boolean(activeFilters.startedChainOnly),
  );
  const [processedOnly, setProcessedOnly] = useState(
    Boolean(activeFilters.processedOnly),
  );
  const [receivedBefore, setReceivedBefore] = useState(
    isoToDatetimeLocal(activeFilters.receivedBefore ?? ""),
  );
  const [receivedAfter, setReceivedAfter] = useState(
    isoToDatetimeLocal(activeFilters.receivedAfter ?? ""),
  );
  const [subject, setSubject] = useState(activeFilters.subject ?? "");

  useEffect(() => {
    setFromAddresses(activeFilters.fromAddresses ?? []);
    setField(activeFilters.field);
    setStartedChainOnly(Boolean(activeFilters.startedChainOnly));
    setProcessedOnly(Boolean(activeFilters.processedOnly));
    setReceivedBefore(isoToDatetimeLocal(activeFilters.receivedBefore ?? ""));
    setReceivedAfter(isoToDatetimeLocal(activeFilters.receivedAfter ?? ""));
    setSubject(activeFilters.subject ?? "");
  }, [searchParams]);

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function applyFilters() {
    const committedFromAddresses =
      fromMultiSelectRef.current?.commitPending() ?? fromAddresses;

    const params = buildEmailThreadSearchParams({
      fromAddresses:
        committedFromAddresses.length > 0 ? committedFromAddresses : undefined,
      field,
      startedChainOnly:
        startedChainOnly && committedFromAddresses.length > 0
          ? true
          : undefined,
      processedOnly: processedOnly ? true : undefined,
      receivedBefore: datetimeLocalToIso(receivedBefore),
      receivedAfter: datetimeLocalToIso(receivedAfter),
      subject: subject.trim() || undefined,
      view: activeFilters.view,
    });

    const qs = params.toString();
    router.push(qs ? `/knowledge/emails?${qs}` : "/knowledge/emails");
    setMenuOpen(false);
  }

  function clearFilters() {
    setFromAddresses([]);
    setField("both");
    setStartedChainOnly(false);
    setProcessedOnly(false);
    setReceivedBefore("");
    setReceivedAfter("");
    setSubject("");
    const params = buildEmailThreadSearchParams({ field: "both", view: activeFilters.view });
    const qs = params.toString();
    router.push(qs ? `/knowledge/emails?${qs}` : "/knowledge/emails");
    setMenuOpen(false);
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label="Filter emails"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        title="Filter emails"
        className={`relative inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-white shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 ${
          filtersActive
            ? "border-teal-600 text-teal-700"
            : "border-slate-200 text-slate-500"
        }`}
      >
        <FilterIcon />
        {filtersActive ? (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-teal-600 ring-2 ring-white"
          />
        ) : null}
      </button>

      {menuOpen ? (
        <div
          role="menu"
          aria-label="Email filters"
          className="absolute right-0 top-[calc(100%+0.375rem)] z-20 w-[34rem] max-w-[calc(100vw-2rem)] overflow-visible rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
        >
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label
                  htmlFor="email-filter-from"
                  className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  From
                </label>
                <div
                  className="inline-flex shrink-0 rounded border border-slate-200 bg-slate-100 p-px"
                  role="group"
                  aria-label="Match in"
                >
                  {FIELD_OPTIONS.map((option) => {
                    const selected = field === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        title={
                          option.id === "from"
                            ? "From only"
                            : option.id === "cc"
                              ? "CC only"
                              : "Both"
                        }
                        onClick={() => setField(option.id)}
                        className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold leading-none transition ${
                          selected
                            ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <EmailFromMultiSelect
                ref={fromMultiSelectRef}
                value={fromAddresses}
                onChange={setFromAddresses}
              />
              <label className="mt-2 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={startedChainOnly}
                  disabled={fromAddresses.length === 0}
                  onChange={(event) => setStartedChainOnly(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span
                  className={`text-sm ${fromAddresses.length === 0 ? "text-slate-400" : "text-slate-700"}`}
                >
                  Selected address started the email chain
                </span>
              </label>
            </div>

            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={processedOnly}
                onChange={(event) => setProcessedOnly(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              />
              <span className="text-sm text-slate-700">Processed emails only</span>
            </label>

            <div>
              <label
                htmlFor="email-filter-subject"
                className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Subject
              </label>
              <input
                id="email-filter-subject"
                type="search"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Contains…"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="email-filter-received-after"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Received after
                </label>
                <input
                  id="email-filter-received-after"
                  type="datetime-local"
                  value={receivedAfter}
                  onChange={(event) => setReceivedAfter(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
                />
              </div>

              <div>
                <label
                  htmlFor="email-filter-received-before"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Received before
                </label>
                <input
                  id="email-filter-received-before"
                  type="datetime-local"
                  value={receivedBefore}
                  onChange={(event) => setReceivedBefore(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={applyFilters}
                className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 4.5h18M6 12h12M10 19.5h4"
      />
    </svg>
  );
}
