"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  buildEmailThreadSearchParams,
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "@/lib/email/thread-filter-params";

const DEBOUNCE_MS = 300;

export function EmailSubjectSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSubject =
    parseEmailThreadFilters(searchParamsToFilterRecord(searchParams)).subject ??
    "";
  const [value, setValue] = useState(urlSubject);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Trimmed subject we last asked the router to apply; skip URL→local sync until it lands
  // so an in-flight navigation cannot wipe characters typed after the debounce fired.
  const pendingSubjectRef = useRef<string | null>(null);
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  useEffect(() => {
    if (pendingSubjectRef.current !== null) {
      if (urlSubject === pendingSubjectRef.current) {
        pendingSubjectRef.current = null;
      }
      return;
    }
    setValue(urlSubject);
  }, [urlSubject]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function applySubject(nextSubject: string | undefined) {
    const activeFilters = parseEmailThreadFilters(
      searchParamsToFilterRecord(searchParamsRef.current),
    );
    const currentSubject = activeFilters.subject ?? "";
    const next = nextSubject ?? "";
    if (next === currentSubject) {
      pendingSubjectRef.current = null;
      return;
    }
    const params = buildEmailThreadSearchParams({
      ...activeFilters,
      subject: nextSubject,
      page: 1,
    });
    const qs = params.toString();
    // replace: typing should not flood browser history with every debounce tick
    router.replace(qs ? `/knowledge/emails?${qs}` : "/knowledge/emails");
  }

  function handleChange(next: string) {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const trimmed = next.trim();
      pendingSubjectRef.current = trimmed;
      applySubject(trimmed || undefined);
    }, DEBOUNCE_MS);
  }

  function handleClear() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingSubjectRef.current = "";
    setValue("");
    applySubject(undefined);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = value.trim();
    pendingSubjectRef.current = trimmed;
    applySubject(trimmed || undefined);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative w-full max-w-md"
      role="search"
      aria-label="Search thread subjects"
    >
      <SearchIcon />
      <input
        type="search"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="Search subjects…"
        aria-label="Search thread subjects"
        className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
      />
      {value ? (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear subject search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <ClearIcon />
        </button>
      ) : null}
    </form>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
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

function ClearIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}
