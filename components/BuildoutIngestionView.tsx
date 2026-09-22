"use client";

import { useMemo, useState } from "react";

import { MarkdownPreview } from "@/components/MarkdownPreview";
import {
  buildIngestionCatalogRows,
  ingestionCoverageLabel,
  type IngestionCatalogRow,
  type IngestionCoverageLevel,
} from "@/lib/buildout/ingestion-catalog";
import {
  BUILDOUT_STATUS_LABEL,
  type BuildoutStatus,
} from "@/lib/buildout/progress";

const COVERAGE_PILL: Record<IngestionCoverageLevel, string> = {
  full: "bg-teal-50 text-teal-900 ring-teal-200",
  partial: "bg-amber-50 text-amber-950 ring-amber-200",
  legacy: "bg-sky-50 text-sky-950 ring-sky-200",
  search_only: "bg-violet-50 text-violet-950 ring-violet-200",
  none: "bg-slate-100 text-slate-600 ring-slate-200",
};

const STATUS_DOT: Record<BuildoutStatus, string> = {
  done: "bg-teal-600",
  in_progress: "bg-amber-500",
  not_started: "bg-slate-400",
  deferred: "bg-violet-500",
};

/**
 * Shared column template for heading + body rows (keeps columns aligned).
 * Below md: one column; md–lg: four; lg+: five (registry).
 */
const INGESTION_ROW_GRID =
  "grid w-full min-w-[32rem] grid-cols-1 gap-x-3 gap-y-2 md:min-w-[36rem] md:grid-cols-[minmax(9rem,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(5.5rem,0.8fr)] md:gap-y-0 lg:grid-cols-[minmax(9rem,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(5.5rem,0.8fr)_minmax(7.5rem,1fr)]";

function CoverageCell({
  level,
  short,
}: {
  level: IngestionCoverageLevel;
  short: string;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${COVERAGE_PILL[level]}`}
      >
        {ingestionCoverageLabel(level)}
      </span>
      <p className="text-[11px] leading-snug text-slate-500">{short}</p>
    </div>
  );
}

export function BuildoutIngestionView() {
  const rows = useMemo(() => buildIngestionCatalogRows(), []);
  const [selectedId, setSelectedId] = useState<string>("harvest-passes");

  const selected: IngestionCatalogRow | undefined = rows.find(
    (row) => row.id === selectedId,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-3 sm:px-5">
        <p className="text-xs text-slate-600 sm:text-sm">
          Entity registries are built from <strong>email body</strong> highlight
          harvests unless noted. Attachment Docling markdown is mostly{" "}
          <strong>search (RAG)</strong> until attachment harvest ships.
        </p>
      </div>

      <div
        className="mx-3 mb-3 mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 sm:mx-5"
        role="table"
        aria-label="Entity ingestion coverage"
      >
        <div
          role="row"
          className={`${INGESTION_ROW_GRID} shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500`}
        >
          <div role="columnheader">Type</div>
          <div role="columnheader">Email body</div>
          <div role="columnheader">Attachments</div>
          <div role="columnheader" className="hidden md:block">Harvest</div>
          <div role="columnheader" className="hidden lg:block">Registry</div>
        </div>

        <div
          role="rowgroup"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-auto"
        >
          {rows.map((row) => {
            const active = row.id === selectedId;
            return (
              <button
                key={row.id}
                type="button"
                role="row"
                onClick={() => setSelectedId(row.id)}
                className={`${INGESTION_ROW_GRID} items-start border-b border-slate-100 px-3 py-2.5 text-left text-sm transition last:border-b-0 ${
                  active
                    ? "bg-amber-50/90 ring-1 ring-inset ring-amber-200"
                    : "hover:bg-slate-50/80"
                }`}
              >
                <span className="flex min-w-0 items-start gap-2">
                  {row.buildoutStatus ? (
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[row.buildoutStatus]}`}
                      title={BUILDOUT_STATUS_LABEL[row.buildoutStatus]}
                    />
                  ) : (
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300"
                      aria-hidden
                    />
                  )}
                  <span className="font-medium text-slate-900">{row.title}</span>
                </span>
                <CoverageCell
                  level={row.emailBody.level}
                  short={row.emailBody.short}
                />
                <CoverageCell
                  level={row.attachments.level}
                  short={row.attachments.short}
                />
                <span className="hidden text-xs text-slate-600 md:block">
                  {row.harvestPasses}
                </span>
                <span className="hidden font-mono text-[11px] leading-snug text-slate-500 lg:block">
                  {row.registry}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-slate-50/80 px-3 py-4 sm:px-5 lg:max-h-[38vh] lg:overflow-y-auto">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {selected ? selected.title : "Details"}
        </p>
        {selected ? (
          <MarkdownPreview>{selected.detailMarkdown}</MarkdownPreview>
        ) : (
          <p className="text-sm text-slate-500">
            Select a row to read ingestion rules and gaps.
          </p>
        )}
      </div>
    </div>
  );
}
