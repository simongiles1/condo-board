"use client";

import { useEffect, useRef, useState } from "react";

import {
  significanceChipClasses,
  significanceLabel,
  type ValidationFinding,
} from "@/lib/minutes/gold-standard-schema";
import type { ItemGoldStandardFindings } from "@/lib/minutes/gold-standard-item-match";

export type GoldStandardFindingPanelTab = "generatedOnly" | "goldOnly";

type FindingKind = GoldStandardFindingPanelTab;

const KIND_META: Record<
  FindingKind,
  { label: string; badgeClass: string; tooltipTitle: string }
> = {
  generatedOnly: {
    label: "In AI only",
    badgeClass: "border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100",
    tooltipTitle: "Present in AI minutes but missing from gold standard",
  },
  goldOnly: {
    label: "In gold only",
    badgeClass: "border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100",
    tooltipTitle: "Present in gold standard but missing from AI minutes",
  },
};

function FindingsTooltipContent({
  findings,
  kind,
}: {
  findings: ValidationFinding[];
  kind: FindingKind;
}) {
  const meta = KIND_META[kind];

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {meta.tooltipTitle}
      </p>
      <ul className="space-y-2">
        {findings.map((finding) => (
          <li
            key={finding.id}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-900">{finding.topic}</p>
              <span
                className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${significanceChipClasses(finding.significance)}`}
              >
                {significanceLabel(finding.significance)}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-700">{finding.detail}</p>
            {finding.section ? (
              <p className="mt-1 text-[10px] text-slate-500">Section: {finding.section}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-slate-500">Click badge to open full compare panel</p>
    </div>
  );
}

export function GoldStandardItemFindingBadge({
  kind,
  findings,
  onOpenPanel,
}: {
  kind: FindingKind;
  findings: ValidationFinding[];
  onOpenPanel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const meta = KIND_META[kind];

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (findings.length === 0) return null;

  const countSuffix = findings.length > 1 ? ` (${findings.length})` : "";

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenPanel();
        }}
        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${meta.badgeClass}`}
        aria-label={`${meta.label}${countSuffix}. Open gold standard compare panel.`}
      >
        {meta.label}
        {countSuffix}
      </button>

      {open ? (
        <div
          className="absolute left-0 top-full z-40 mt-1.5 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <FindingsTooltipContent findings={findings} kind={kind} />
        </div>
      ) : null}
    </div>
  );
}

export function GoldStandardItemFindingBadgesRow({
  findings,
  onOpenGoldStandardPanel,
}: {
  findings?: ItemGoldStandardFindings;
  onOpenGoldStandardPanel?: (tab: GoldStandardFindingPanelTab) => void;
}) {
  if (!findings || !onOpenGoldStandardPanel) return null;
  if (findings.generatedOnly.length === 0 && findings.goldOnly.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <GoldStandardItemFindingBadge
        kind="generatedOnly"
        findings={findings.generatedOnly}
        onOpenPanel={() => onOpenGoldStandardPanel("generatedOnly")}
      />
      <GoldStandardItemFindingBadge
        kind="goldOnly"
        findings={findings.goldOnly}
        onOpenPanel={() => onOpenGoldStandardPanel("goldOnly")}
      />
    </div>
  );
}
