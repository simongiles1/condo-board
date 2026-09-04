"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  AnchoredMenuPortal,
  useAnchoredMenuDismiss,
} from "@/components/AnchoredMenuPortal";
import { EntityListPagination } from "@/components/EntityListPagination";
import {
  MergeEntityDialog,
  MergeIcon,
  type MergeEntityOption,
} from "@/components/MergeEntityDialog";
import { ProjectDuplicatesPanel } from "@/components/ProjectDuplicatesPanel";
import { ProjectEvidenceSidePanel } from "@/components/ProjectEvidenceSidePanel";
import { ProjectMentionsPanel } from "@/components/ProjectMentionsPanel";
import { useEntityProfile } from "@/components/EntityProfileProvider";
import {
  projectDuplicatesWaitReason,
  type ProjectDuplicateGroup,
  type ProjectDuplicateGroupMember,
} from "@/lib/projects/duplicate-groups";
import type { IdentityReviewRunRecord } from "@/lib/projects/identity-review-shared";
import {
  BOARD_REPORT_MATCHING_STATUS,
  type BoardReportRunRecord,
  type BoardReportScanReview,
} from "@/lib/projects/board-report-shared";
import type {
  ProjectFingerprintListStats,
  ProjectFingerprintSummary,
} from "@/lib/projects/fingerprint-list";
import type { ProjectDeniableField } from "@/lib/projects/field-denials";
import type { ProjectMentionStats } from "@/lib/projects/mention-queue-shared";
import {
  clampEntityListPage,
  sliceEntityListPage,
} from "@/lib/entities/registry-page";
import {
  PROJECT_SCOPE_LABELS,
  PROJECT_SCOPES,
  preferProjectScope,
  resolveProjectScope,
  type ProjectScope,
} from "@/lib/email-analysis/project-highlight-shared";
import {
  PROJECT_PHASE_LABELS,
  PROJECT_PHASES,
  normalizeProjectPhase,
  preferProjectPhase,
} from "@/lib/projects/project-phase";
import {
  normalizeProjectYearHint,
  preferProjectYearHint,
} from "@/lib/projects/project-year-range";
import type { ProjectEvidenceField } from "@/lib/projects/registry-evidence-shared";
import {
  collectProjectFilterOptions,
  EMPTY_PROJECT_LIST_FILTERS,
  hasActiveProjectListFilters,
  matchesProjectListFilters,
  projectMatchesListSearch,
  type PresenceFilter,
  type ProjectListFilters,
} from "@/lib/projects/project-list-filter";
import {
  sortProjectFingerprintSummaries,
  type ProjectFingerprintListSort,
} from "@/lib/projects/project-list-sort";
import {
  foldProjectNames,
  mergeProjectMultiValues,
  splitProjectMultiValue,
} from "@/lib/projects/project-multi-values";

const PROJECT_LIST_SORT_OPTIONS: Array<{
  value: ProjectFingerprintListSort;
  label: string;
}> = [
  { value: "mentions-desc", label: "Mentions (high → low)" },
  { value: "mentions-asc", label: "Mentions (low → high)" },
  { value: "name-asc", label: "Name (A → Z)" },
  { value: "name-desc", label: "Name (Z → A)" },
  { value: "year-desc", label: "Years (newest)" },
  { value: "year-asc", label: "Years (oldest)" },
  { value: "phase-asc", label: "Phase (lifecycle)" },
  { value: "completeness-asc", label: "Least complete first" },
  { value: "completeness-desc", label: "Most complete first" },
  { value: "board-desc", label: "Board reports (high → low)" },
  { value: "board-asc", label: "Board reports (low → high)" },
];

function ProjectListSortMenu({
  value,
  onChange,
}: {
  value: ProjectFingerprintListSort;
  onChange: (next: ProjectFingerprintListSort) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const currentLabel =
    PROJECT_LIST_SORT_OPTIONS.find((option) => option.value === value)?.label ??
    "Sort";

  useAnchoredMenuDismiss(open, () => setOpen(false), triggerRef, menuRef);

  return (
    <div className="shrink-0 border-b border-slate-200 bg-slate-50">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Sort projects: ${currentLabel}`}
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
      <AnchoredMenuPortal
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        matchTriggerWidth
        align="start"
        className="border border-slate-200 bg-white py-1 shadow-lg"
      >
        <div role="menu" aria-label="Project sort options">
          {PROJECT_LIST_SORT_OPTIONS.map((option) => {
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
      </AnchoredMenuPortal>
    </div>
  );
}

function ClearSelectionIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
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

function FilterIcon({ className }: { className?: string }) {
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
        d="M3 4.5h18M6 12h12M10 19.5h4"
      />
    </svg>
  );
}

function LegendIcon({ className }: { className?: string }) {
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
        d="M4 7h16M4 12h10M4 17h6"
      />
      <circle cx="18" cy="12" r="2.25" fill="currentColor" stroke="none" />
      <circle cx="14" cy="17" r="2.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

const PRESENCE_OPTIONS: Array<{ value: PresenceFilter; label: string }> = [
  { value: "any", label: "Any" },
  { value: "set", label: "Has value" },
  { value: "missing", label: "Missing" },
];

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[11px] font-medium uppercase tracking-wide text-slate-500"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-orange-600 focus:outline-none focus:ring-1 focus:ring-orange-600"
      >
        {children}
      </select>
    </div>
  );
}

function ProjectListFilterMenu({
  filters,
  years,
  onChange,
}: {
  filters: ProjectListFilters;
  years: string[];
  onChange: (next: ProjectListFilters) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const active = hasActiveProjectListFilters(filters);

  useAnchoredMenuDismiss(open, () => setOpen(false), triggerRef, menuRef);

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="Filter projects"
        aria-label="Filter projects"
        aria-expanded={open}
        aria-haspopup="menu"
        className={
          open || active
            ? "relative rounded p-1.5 text-orange-700 bg-orange-50"
            : "rounded p-1.5 text-slate-500 hover:bg-orange-50 hover:text-orange-700"
        }
      >
        <FilterIcon className="h-4 w-4" />
        {active ? (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-orange-600"
          />
        ) : null}
      </button>
      <AnchoredMenuPortal
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        width={256}
        align="end"
        className="border border-slate-200 bg-white px-3 py-2 shadow-lg"
      >
        <div role="menu" aria-label="Project filters" className="space-y-2">
          <FilterSelect
            id="project-scope-filter"
            label="Scope"
            value={filters.scope}
            onChange={(value) =>
              onChange({
                ...filters,
                scope: value === "all" ? "all" : (value as ProjectScope),
              })
            }
          >
            <option value="all">All scopes</option>
            {PROJECT_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {PROJECT_SCOPE_LABELS[scope]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="project-completeness-filter"
            label="Metadata"
            value={filters.completeness}
            onChange={(value) =>
              onChange({
                ...filters,
                completeness: value as ProjectListFilters["completeness"],
              })
            }
          >
            <option value="all">All</option>
            <option value="incomplete">Incomplete</option>
            <option value="complete">Complete</option>
          </FilterSelect>
          <FilterSelect
            id="project-year-filter"
            label="Years"
            value={filters.year}
            onChange={(value) => onChange({ ...filters, year: value })}
          >
            <option value="all">All years</option>
            <option value="missing">Missing years</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="project-phase-filter"
            label="Phase"
            value={filters.phase}
            onChange={(value) => onChange({ ...filters, phase: value })}
          >
            <option value="all">All phases</option>
            <option value="missing">Missing phase</option>
            {PROJECT_PHASES.map((phase) => (
              <option key={phase} value={phase}>
                {PROJECT_PHASE_LABELS[phase]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="project-contractor-filter"
            label="Contractor"
            value={filters.contractor}
            onChange={(value) =>
              onChange({ ...filters, contractor: value as PresenceFilter })
            }
          >
            {PRESENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="project-location-filter"
            label="Location"
            value={filters.location}
            onChange={(value) =>
              onChange({ ...filters, location: value as PresenceFilter })
            }
          >
            {PRESENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="project-equipment-filter"
            label="Equipment"
            value={filters.equipment}
            onChange={(value) =>
              onChange({ ...filters, equipment: value as PresenceFilter })
            }
          >
            {PRESENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="project-board-filter"
            label="Board reports"
            value={filters.board}
            onChange={(value) =>
              onChange({
                ...filters,
                board: value as ProjectListFilters["board"],
              })
            }
          >
            <option value="all">All</option>
            <option value="mentioned">In a management report</option>
            <option value="not_mentioned">Not in a report</option>
          </FilterSelect>
          {active ? (
            <button
              type="button"
              onClick={() => onChange(EMPTY_PROJECT_LIST_FILTERS)}
              className="w-full rounded px-2 py-1 text-xs font-medium text-orange-800 hover:bg-orange-50"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </AnchoredMenuPortal>
    </div>
  );
}

function ProjectBadgeLegendSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function ProjectListBadgeLegendMenu({ years }: { years: string[] }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useAnchoredMenuDismiss(open, () => setOpen(false), triggerRef, menuRef);

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="Badge legend"
        aria-label="Badge legend"
        aria-expanded={open}
        aria-haspopup="menu"
        className={
          open
            ? "rounded p-1.5 text-orange-700 bg-orange-50"
            : "rounded p-1.5 text-slate-500 hover:bg-orange-50 hover:text-orange-700"
        }
      >
        <LegendIcon className="h-4 w-4" />
      </button>
      <AnchoredMenuPortal
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        width={288}
        align="end"
        className="border border-slate-200 bg-white px-3 py-2 shadow-lg"
      >
        <div role="menu" aria-label="Project badge legend">
          <p className="text-xs font-medium text-slate-800">Badge legend</p>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
            List rows use color to group scope, phase, years, and board reports.
          </p>
          <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-0.5">
            <ProjectBadgeLegendSection title="Scope">
              {PROJECT_SCOPES.map((scope) => (
                <ProjectScopeBadge key={scope} scope={scope} />
              ))}
            </ProjectBadgeLegendSection>
            <ProjectBadgeLegendSection title="Phase">
              <ProjectPhaseBadge phase={null} />
              {PROJECT_PHASES.map((phase) => (
                <ProjectPhaseBadge key={phase} phase={phase} />
              ))}
            </ProjectBadgeLegendSection>
            <ProjectBadgeLegendSection title="Years">
              {years.length > 0 ? (
                years.map((year) => <ProjectYearBadge key={year} year={year} />)
              ) : (
                <span className="text-[11px] text-slate-400">No years yet</span>
              )}
            </ProjectBadgeLegendSection>
            <ProjectBadgeLegendSection title="Board">
              <ProjectBoardBadge count={3} />
            </ProjectBadgeLegendSection>
          </div>
        </div>
      </AnchoredMenuPortal>
    </div>
  );
}

function SeverIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4L4 12" strokeLinecap="round" />
    </svg>
  );
}

function FieldRow({
  label,
  value,
  disabled,
  onSever,
  onEvidence,
}: {
  label: string;
  value: string | null;
  disabled?: boolean;
  onSever?: () => void;
  onEvidence?: () => void;
}) {
  const hasValue = Boolean(value?.trim());
  return (
    <div className="grid grid-cols-[7rem_1fr_auto] items-start gap-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">
        {hasValue && onEvidence ? (
          <button
            type="button"
            onClick={onEvidence}
            className="text-left text-orange-800 underline-offset-2 hover:underline"
          >
            {value}
          </button>
        ) : hasValue ? (
          value
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </dd>
      {hasValue && onSever ? (
        <button
          type="button"
          title={`Stop associating this ${label.toLowerCase()}`}
          aria-label={`Sever ${label.toLowerCase()} association`}
          disabled={disabled}
          onClick={onSever}
          className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
        >
          <SeverIcon className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="w-4" aria-hidden="true" />
      )}
    </div>
  );
}

function MultiValueField({
  label,
  values,
  disabled,
  onSever,
  onEvidence,
}: {
  label: string;
  values: string[];
  disabled?: boolean;
  onSever: (value: string) => void;
  onEvidence?: (value: string) => void;
}) {
  if (values.length === 0) {
    return <FieldRow label={label} value={null} disabled={disabled} />;
  }
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0">
        <ul className="space-y-1">
          {values.map((value) => (
            <li
              key={`${label}:${value}`}
              className="grid grid-cols-[1fr_auto] items-start gap-2"
            >
              {onEvidence ? (
                <button
                  type="button"
                  onClick={() => onEvidence(value)}
                  className="min-w-0 break-words text-left text-orange-800 underline-offset-2 hover:underline"
                >
                  {value}
                </button>
              ) : (
                <span className="break-words text-slate-900">{value}</span>
              )}
              <button
                type="button"
                title={`Stop associating this ${label.toLowerCase()}`}
                aria-label={`Sever ${label.toLowerCase()} “${value}”`}
                disabled={disabled}
                onClick={() => onSever(value)}
                className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
              >
                <SeverIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function ProjectScopeBadge({ scope }: { scope: ProjectScope | null | undefined }) {
  const label = PROJECT_SCOPE_LABELS[scope ?? "unknown"];
  return (
    <span className="inline-flex rounded bg-sky-50 px-1.5 py-px text-[11px] font-medium text-sky-800 ring-1 ring-sky-200/90">
      {label}
    </span>
  );
}

function ProjectPhaseBadge({ phase }: { phase: string | null | undefined }) {
  const canonical = normalizeProjectPhase(phase);
  const label = canonical ? PROJECT_PHASE_LABELS[canonical] : "No phase";
  return (
    <span className="inline-flex rounded bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-900 ring-1 ring-amber-200/90">
      {label}
    </span>
  );
}

function ProjectYearBadge({ year }: { year: string }) {
  const label = normalizeProjectYearHint(year) ?? year;
  return (
    <span className="inline-flex rounded bg-violet-50 px-1.5 py-px text-[11px] font-medium tabular-nums text-violet-800 ring-1 ring-violet-200/90">
      {label}
    </span>
  );
}

function ProjectBoardBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex rounded bg-emerald-50 px-1.5 py-px text-[11px] font-medium tabular-nums text-emerald-900 ring-1 ring-emerald-200/90">
      Board · {count}
    </span>
  );
}

function formatBoardParseStatus(status: string | null | undefined): string {
  if (!status) return "not converted";
  if (status === "pending") return "pending conversion";
  if (status === "needs_ocr") return "needs OCR";
  if (status === "parsing") return "converting";
  return status.replace(/_/g, " ");
}

function boardScanHeadline(run: BoardReportRunRecord): string {
  if (run.status === "running") {
    if (run.lastError === BOARD_REPORT_MATCHING_STATUS) {
      return "Matching report topics to projects…";
    }
    return `Scanning reports · ${run.reportCompleted} / ${run.reportTotal}`;
  }
  if (run.status === "completed") return "Report scan complete";
  if (run.status === "cancelled") return "Report scan cancelled";
  if (run.status === "failed") {
    return run.lastError
      ? `Report scan failed: ${run.lastError}`
      : "Report scan failed";
  }
  return "Report scan";
}

function projectSubtitle(org: ProjectFingerprintSummary): string {
  const parts: string[] = [];
  const scope = resolveProjectScope(org);
  if (scope) parts.push(PROJECT_SCOPE_LABELS[scope]);
  if (org.year_hint?.trim()) {
    const years = normalizeProjectYearHint(org.year_hint);
    if (years) parts.push(years);
  }
  const phase = normalizeProjectPhase(org.phase);
  if (phase) parts.push(PROJECT_PHASE_LABELS[phase]);
  const contractors = splitProjectMultiValue(org.contractor);
  if (contractors[0]) parts.push(contractors[0]);
  const locations = splitProjectMultiValue(org.location);
  if (locations[0]) parts.push(locations[0]);
  return parts.join(" · ");
}

function projectToMergeOption(org: ProjectFingerprintSummary): MergeEntityOption {
  const searchParts = [
    org.displayName,
    org.name,
    ...(org.aliases ?? []),
    org.year_hint,
    org.phase,
    ...splitProjectMultiValue(org.contractor),
    ...splitProjectMultiValue(org.location),
    ...splitProjectMultiValue(org.equipment_mentions),
  ];
  return {
    id: org.id,
    displayName: org.displayName,
    subtitle: projectSubtitle(org) || null,
    searchText: searchParts
      .filter(Boolean)
      .join("\n")
      .toLowerCase(),
  };
}

/** Local fold so the UI updates before the slow registry reload finishes. */
function foldProjectSummariesLocally(
  target: ProjectFingerprintSummary,
  sources: ProjectFingerprintSummary[],
): ProjectFingerprintSummary {
  let folded = target;
  for (const source of sources) {
    if (source.id === target.id) continue;
    const foldedNames = foldProjectNames({
      preferredName: folded.name,
      otherName: source.name,
      preferredAliases: folded.aliases,
      otherAliases: source.aliases,
    });
    folded = {
      ...folded,
      name: foldedNames.name,
      aliases: foldedNames.aliases,
      year_hint: preferProjectYearHint(folded.year_hint, source.year_hint),
      phase: preferProjectPhase(folded.phase, source.phase),
      contractor: mergeProjectMultiValues(folded.contractor, source.contractor),
      location: mergeProjectMultiValues(folded.location, source.location),
      equipment_mentions: mergeProjectMultiValues(
        folded.equipment_mentions,
        source.equipment_mentions,
      ),
      scope: preferProjectScope(
        resolveProjectScope(folded),
        resolveProjectScope(source),
      ),
      displayName: foldedNames.name?.trim() || folded.displayName,
      sourceMergeCount: folded.sourceMergeCount + source.sourceMergeCount,
      sourceEmailCount: folded.sourceEmailCount + source.sourceEmailCount,
      modelIds: [...new Set([...folded.modelIds, ...source.modelIds])],
      boardReportCount:
        (folded.boardReportCount ?? 0) + (source.boardReportCount ?? 0),
      boardLastReportAt: (() => {
        const left = folded.boardLastReportAt;
        const right = source.boardLastReportAt;
        if (!left) return right ?? null;
        if (!right) return left;
        return right > left ? right : left;
      })(),
    };
  }
  return folded;
}

function applyOptimisticProjectMerge(params: {
  projects: ProjectFingerprintSummary[];
  duplicateGroups: ProjectDuplicateGroup[];
  targetId: string;
  sourceIds: string[];
}): {
  projects: ProjectFingerprintSummary[];
  duplicateGroups: ProjectDuplicateGroup[];
  survivor: ProjectFingerprintSummary | null;
} {
  const sourceIdSet = new Set(
    params.sourceIds.filter((id) => id && id !== params.targetId),
  );
  const targetFromList = params.projects.find(
    (org) => org.id === params.targetId,
  );
  const targetFromGroups = params.duplicateGroups
    .flatMap((g) => g.members)
    .find((m) => m.id === params.targetId);
  const target = targetFromList ?? targetFromGroups ?? null;
  if (!target || sourceIdSet.size === 0) {
    return {
      projects: params.projects,
      duplicateGroups: params.duplicateGroups,
      survivor: target,
    };
  }
  const sources = params.projects.filter((org) => sourceIdSet.has(org.id));
  // Also pull sources that only exist inside duplicate groups.
  const fromGroups: ProjectFingerprintSummary[] = [];
  for (const group of params.duplicateGroups) {
    for (const member of group.members) {
      if (sourceIdSet.has(member.id) && !sources.some((s) => s.id === member.id)) {
        fromGroups.push(member);
      }
    }
  }
  const survivor = foldProjectSummariesLocally(target, [...sources, ...fromGroups]);
  const removedIds = new Set(sourceIdSet);
  const withoutSources = params.projects.filter(
    (org) => !removedIds.has(org.id),
  );
  const projects = withoutSources.some((org) => org.id === survivor.id)
    ? withoutSources.map((org) => (org.id === survivor.id ? survivor : org))
    : [survivor, ...withoutSources];

  const duplicateGroups: ProjectDuplicateGroup[] = [];
  for (const group of params.duplicateGroups) {
    const members = group.members
      .filter((m) => !removedIds.has(m.id))
      .map((m) =>
        m.id === survivor.id
          ? { ...survivor, nameless: !(survivor.name?.trim() || survivor.aliases?.length) }
          : m,
      );
    // Ensure survivor stays in the group if it was a member or absorbed one.
    const groupTouched =
      group.members.some((m) => m.id === survivor.id || removedIds.has(m.id));
    if (groupTouched && !members.some((m) => m.id === survivor.id)) {
      members.push({
        ...survivor,
        nameless: !(survivor.name?.trim() || survivor.aliases?.length),
      });
    }
    if (members.length < 2) continue;
    const sortedIds = [...members.map((m) => m.id)].sort();
    duplicateGroups.push({
      ...group,
      id: groupTouched ? `fuzzy:${sortedIds.join("|")}` : group.id,
      label: groupTouched
        ? (members.find((m) => m.id === survivor.id)?.displayName ??
          group.label)
        : group.label,
      memberCount: members.length,
      members,
    });
  }

  return { projects, duplicateGroups, survivor };
}

type PendingSever = {
  field: ProjectDeniableField;
  label: string;
  value: string;
};

export function ProjectsRegistryClient({
  initialProjects,
  initialStats,
  initialMentionStats = null,
}: {
  initialProjects: ProjectFingerprintSummary[];
  initialStats: ProjectFingerprintListStats;
  initialMentionStats?: ProjectMentionStats | null;
}) {
  const [projects, setProjects] = useState(initialProjects);
  const [stats, setStats] = useState(initialStats);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialProjects[0]?.id ?? null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { openProfile } = useEntityProfile();
  const [mergeSources, setMergeSources] = useState<ProjectFingerprintSummary[]>([]);
  const [mergeCandidatePool, setMergeCandidatePool] = useState<
    ProjectFingerprintSummary[]
  >([]);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [checkedProjectIds, setCheckedProjectIds] = useState<Set<string>>(new Set());
  const [pendingSever, setPendingSever] = useState<PendingSever | null>(null);
  const [severError, setSeverError] = useState<string | null>(null);
  const [evidenceTarget, setEvidenceTarget] = useState<{
    projectId: string;
    projectName: string;
    field: ProjectEvidenceField;
    value: string;
  } | null>(null);
  const [projectSort, setProjectSort] = useState<ProjectFingerprintListSort>("mentions-desc");
  const [listFilters, setListFilters] = useState<ProjectListFilters>(
    EMPTY_PROJECT_LIST_FILTERS,
  );
  const [tab, setTab] = useState<"projects" | "mentions" | "duplicates">(
    "projects",
  );
  const [mentionStats, setMentionStats] = useState({
    mentionUnresolvedCount: initialMentionStats?.unresolved ?? 0,
    mentionProvisionalCount: initialMentionStats?.provisional ?? 0,
    mentionConfirmedCount: initialMentionStats?.confirmed ?? 0,
    mentionTotalCount: initialMentionStats?.total ?? 0,
  });
  const [mentionStatsKnown, setMentionStatsKnown] = useState(
    initialMentionStats != null,
  );
  const duplicatesLoaded = useRef(false);
  const [duplicateGroups, setDuplicateGroups] = useState<ProjectDuplicateGroup[]>(
    [],
  );
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string | null>(null);
  const [reviewStatusLoading, setReviewStatusLoading] = useState(false);
  const [reviewAction, setReviewAction] = useState<"start" | "cancel" | null>(
    null,
  );
  const [reviewRun, setReviewRun] = useState<IdentityReviewRunRecord | null>(
    null,
  );
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [boardScanRun, setBoardScanRun] = useState<BoardReportRunRecord | null>(
    null,
  );
  const [boardScanError, setBoardScanError] = useState<string | null>(null);
  const [boardScanReview, setBoardScanReview] =
    useState<BoardReportScanReview | null>(null);
  const [boardScanPanel, setBoardScanPanel] = useState<
    "unmatched" | "waiting" | null
  >(null);
  const [listSearchOpen, setListSearchOpen] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [listPage, setListPage] = useState(1);
  const listSearchInputRef = useRef<HTMLInputElement>(null);

  const sortedProjects = useMemo(
    () => sortProjectFingerprintSummaries(projects, projectSort),
    [projects, projectSort],
  );

  const filterOptions = useMemo(
    () => collectProjectFilterOptions(projects),
    [projects],
  );

  const filteredProjects = useMemo(() => {
    return sortedProjects.filter((project) => {
      if (!matchesProjectListFilters(project, listFilters)) return false;
      return projectMatchesListSearch(project, listSearch);
    });
  }, [sortedProjects, listSearch, listFilters]);

  const pagedProjects = useMemo(
    () => sliceEntityListPage(filteredProjects, listPage),
    [filteredProjects, listPage],
  );

  useEffect(() => {
    setListPage((page) => clampEntityListPage(page, filteredProjects.length));
  }, [filteredProjects.length]);

  useEffect(() => {
    if (listSearchOpen) listSearchInputRef.current?.focus();
  }, [listSearchOpen]);

  const checkedCount = checkedProjectIds.size;
  const allVisibleSelected =
    pagedProjects.length > 0 &&
    pagedProjects.every((org) => checkedProjectIds.has(org.id));

  const selected = useMemo(
    () => projects.find((org) => org.id === selectedId) ?? null,
    [projects, selectedId],
  );

  const duplicatesWaitReason = useMemo(
    () =>
      projectDuplicatesWaitReason({
        groupsLoading: duplicatesLoading,
        reviewStatusLoading,
        reviewRunning: reviewRun?.status === "running",
        startingReview: reviewAction === "start",
        cancellingReview: reviewAction === "cancel",
        pagePending: pending,
        pageMessage: message,
      }),
    [
      duplicatesLoading,
      reviewStatusLoading,
      reviewRun?.status,
      reviewAction,
      pending,
      message,
    ],
  );

  function toggleProjectChecked(orgId: string, checked: boolean) {
    setCheckedProjectIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orgId);
      else next.delete(orgId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setCheckedProjectIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const org of pagedProjects) next.delete(org.id);
      } else {
        for (const org of pagedProjects) next.add(org.id);
      }
      return next;
    });
  }

  function openBulkMerge() {
    const selectedOrgs = projects.filter((org) => checkedProjectIds.has(org.id));
    if (selectedOrgs.length < 2) return;
    setMergeError(null);
    setMergeSources(selectedOrgs);
    setMergeCandidatePool(projects);
  }

  async function refreshData(): Promise<ProjectFingerprintSummary[] | null> {
    const res = await fetch("/api/projects/registry", {
      cache: "no-store",
    });
    const json = (await res.json()) as {
      projects?: ProjectFingerprintSummary[];
      stats?: ProjectFingerprintListStats;
      mentionStats?: ProjectMentionStats | null;
      error?: string;
    };
    if (!res.ok) {
      setMessage(json.error ?? "Failed to refresh projects.");
      return null;
    }
    const next = json.projects ?? [];
    setProjects(next);
    if (json.stats) setStats(json.stats);
    if (json.mentionStats) {
      setMentionStats({
        mentionUnresolvedCount: json.mentionStats.unresolved,
        mentionProvisionalCount: json.mentionStats.provisional,
        mentionConfirmedCount: json.mentionStats.confirmed,
        mentionTotalCount: json.mentionStats.total,
      });
      setMentionStatsKnown(true);
    }
    setSelectedId((prev) => {
      if (prev && next.some((org) => org.id === prev)) return prev;
      return next[0]?.id ?? null;
    });
    if (!json.mentionStats) await loadMentionStats();
    return next;
  }

  async function loadMentionStats(): Promise<void> {
    try {
      const res = await fetch("/api/projects/registry?view=mention_stats", {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        mentionStats?: {
          unresolved: number;
          provisional: number;
          confirmed: number;
          total: number;
        };
      };
      if (!res.ok || !json.mentionStats) return;
      setMentionStats({
        mentionUnresolvedCount: json.mentionStats.unresolved,
        mentionProvisionalCount: json.mentionStats.provisional,
        mentionConfirmedCount: json.mentionStats.confirmed,
        mentionTotalCount: json.mentionStats.total,
      });
      setMentionStatsKnown(true);
    } catch {
      // Header counts stay at last known values.
    }
  }

  async function loadDuplicates(): Promise<void> {
    setDuplicatesLoading(true);
    setDuplicatesError(null);
    try {
      const res = await fetch("/api/projects/registry?view=duplicates", {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        groups?: ProjectDuplicateGroup[];
        error?: string;
      };
      if (!res.ok) {
        setDuplicatesError(
          json.error ?? "Failed to load duplicate groups.",
        );
        return;
      }
      setDuplicateGroups(json.groups ?? []);
      duplicatesLoaded.current = true;
    } catch {
      setDuplicatesError("Failed to load duplicate groups.");
    } finally {
      setDuplicatesLoading(false);
    }
  }

  async function loadIdentityReview(options?: {
    silent?: boolean;
  }): Promise<IdentityReviewRunRecord | null> {
    if (!options?.silent) setReviewStatusLoading(true);
    try {
      const res = await fetch("/api/projects/identity-review", {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        run?: IdentityReviewRunRecord | null;
        error?: string;
      };
      if (!res.ok) {
        if (!options?.silent) {
          setReviewError(json.error ?? "Could not load identity review status.");
        }
        return null;
      }
      setReviewError(null);
      setReviewRun(json.run ?? null);
      return json.run ?? null;
    } catch {
      setReviewError("Could not load identity review status.");
      return null;
    } finally {
      if (!options?.silent) setReviewStatusLoading(false);
    }
  }

  async function loadBoardScan(options?: {
    details?: boolean;
  }): Promise<BoardReportRunRecord | null> {
    try {
      const qs = options?.details ? "?details=1" : "";
      const res = await fetch(`/api/projects/board-reports${qs}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        run?: BoardReportRunRecord | null;
        unmatchedTopics?: BoardReportScanReview["unmatchedTopics"];
        waitingOnMarkdown?: BoardReportScanReview["waitingOnMarkdown"];
        error?: string;
      };
      if (!res.ok) {
        setBoardScanError(
          json.error ?? "Could not load management-report scan status.",
        );
        return null;
      }
      setBoardScanRun(json.run ?? null);
      if (options?.details) {
        setBoardScanReview({
          unmatchedTopics: json.unmatchedTopics ?? [],
          waitingOnMarkdown: json.waitingOnMarkdown ?? [],
        });
      }
      return json.run ?? null;
    } catch {
      setBoardScanError("Could not load management-report scan status.");
      return null;
    }
  }

  function openMentionsTab() {
    setTab("mentions");
  }

  function openLinkedProject(identityKey: string) {
    const key = identityKey.trim();
    if (!key) return;
    setTab("projects");
    setSelectedId(key);
  }

  function processPendingProjectMerges() {
    startTransition(async () => {
      setMessage("Syncing project registry and resolving mentions…");
      try {
        const res = await fetch("/api/projects/registry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resolve_mentions" }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          scanned?: number;
          confirmed?: number;
          provisional?: number;
          unresolved?: number;
          retracted?: number;
          error?: string;
        };
        if (!res.ok || !json.ok) {
          setMessage(json.error ?? "Could not resolve project mentions.");
          return;
        }
        setMessage(
          `Resolved ${json.scanned ?? 0} mention${json.scanned === 1 ? "" : "s"} → ${json.confirmed ?? 0} confirmed, ${json.provisional ?? 0} provisional, ${json.unresolved ?? 0} still unresolved${json.retracted ? `, ${json.retracted} retracted` : ""}.`,
        );
        await refreshData();
      } catch {
        setMessage("Could not resolve project mentions.");
      }
    });
  }

  function openDuplicatesTab() {
    setTab("duplicates");
    if (!duplicatesLoaded.current) {
      void (async () => {
        await loadDuplicates();
        await loadIdentityReview();
      })();
      return;
    }
    void loadIdentityReview();
  }

  useEffect(() => {
    void loadBoardScan({ details: true });
    void loadMentionStats();
  }, []);

  useEffect(() => {
    if (boardScanRun?.status !== "running") return;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      void (async () => {
        try {
          const next = await loadBoardScan();
          if (next && next.status !== "running") {
            await refreshData();
            await loadBoardScan({ details: true });
          }
        } finally {
          inFlight = false;
        }
      })();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [boardScanRun?.status, boardScanRun?.id]);

  useEffect(() => {
    if (tab !== "duplicates") return;
    if (reviewRun?.status !== "running") return;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      void (async () => {
        try {
          const next = await loadIdentityReview({ silent: true });
          if (next && next.status !== "running") {
            await loadDuplicates();
            await refreshData();
          }
        } finally {
          inFlight = false;
        }
      })();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [tab, reviewRun?.status, reviewRun?.id]);

  function startIdentityReview() {
    setReviewError(null);
    setReviewAction("start");
    void (async () => {
      try {
        const res = await fetch("/api/projects/identity-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
        const json = (await res.json()) as {
          run?: IdentityReviewRunRecord | null;
          error?: string;
        };
        if (!res.ok) {
          setReviewError(json.error ?? "Could not start identity review.");
          return;
        }
        setReviewRun(json.run ?? null);
      } catch {
        setReviewError("Could not start identity review.");
      } finally {
        setReviewAction(null);
      }
    })();
  }

  function cancelIdentityReview() {
    setReviewAction("cancel");
    void (async () => {
      try {
        const res = await fetch("/api/projects/identity-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        });
        const json = (await res.json()) as {
          error?: string;
        };
        if (!res.ok) {
          setReviewError(json.error ?? "Could not cancel identity review.");
          return;
        }
        await loadIdentityReview({ silent: true });
      } catch {
        setReviewError("Could not cancel identity review.");
      } finally {
        setReviewAction(null);
      }
    })();
  }

  const boardScanRunning = boardScanRun?.status === "running";
  const boardScanMatching =
    boardScanRunning &&
    boardScanRun?.lastError === BOARD_REPORT_MATCHING_STATUS;

  function startBoardScan() {
    setBoardScanError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/projects/board-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
        const json = (await res.json()) as {
          run?: BoardReportRunRecord | null;
          error?: string;
        };
        if (!res.ok) {
          setBoardScanError(
            json.error ?? "Could not start management-report scan.",
          );
          return;
        }
        setBoardScanRun(json.run ?? null);
      } catch {
        setBoardScanError("Could not start management-report scan.");
      }
    });
  }

  function cancelBoardScan() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/projects/board-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) {
          setBoardScanError(
            json.error ?? "Could not cancel management-report scan.",
          );
          return;
        }
        await loadBoardScan();
      } catch {
        setBoardScanError("Could not cancel management-report scan.");
      }
    });
  }

  function rematchBoardScan() {
    setBoardScanError(null);
    setBoardScanPanel("unmatched");
    startTransition(async () => {
      try {
        const res = await fetch("/api/projects/board-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rematch" }),
        });
        const json = (await res.json()) as {
          run?: BoardReportRunRecord | null;
          error?: string;
        };
        if (!res.ok) {
          setBoardScanError(
            json.error ?? "Could not re-match management-report topics.",
          );
          return;
        }
        setBoardScanRun(json.run ?? null);
      } catch {
        setBoardScanError("Could not re-match management-report topics.");
      }
    });
  }

  function openBoardScanPanel(panel: "unmatched" | "waiting") {
    setBoardScanPanel((prev) => (prev === panel ? null : panel));
    if (!boardScanReview) {
      void loadBoardScan({ details: true });
    }
  }

  function searchProjectsForTopic(name: string) {
    setTab("projects");
    setListSearchOpen(true);
    setListSearch(name);
    setListPage(1);
  }

  function refresh() {
    startTransition(async () => {
      setMessage(null);
      await refreshData();
      if (tab === "duplicates" || duplicatesLoaded.current) {
        await loadDuplicates();
      }
    });
  }

  function openDuplicateMerge(members: ProjectDuplicateGroupMember[]) {
    if (members.length === 0) return;
    setMergeError(null);
    setMergeSources(members);
    const byId = new Map(projects.map((org) => [org.id, org]));
    for (const member of members) byId.set(member.id, member);
    const group = duplicateGroups.find((g) =>
      members.every((m) => g.members.some((gm) => gm.id === m.id)),
    );
    if (group) {
      for (const member of group.members) byId.set(member.id, member);
    }
    setMergeCandidatePool([...byId.values()]);
  }

  function mergeAllDuplicatesInto(
    target: ProjectDuplicateGroupMember,
    sources: ProjectDuplicateGroupMember[],
  ) {
    if (sources.length === 0) return;
    setMergeError(null);
    runMerge(target.id, sources, target.displayName);
  }

  function changeProjectSort(next: ProjectFingerprintListSort) {
    if (next === projectSort) return;
    setProjectSort(next);
    setCheckedProjectIds(new Set());
    setListPage(1);
  }

  function changeListFilters(next: ProjectListFilters) {
    setListFilters(next);
    setListPage(1);
  }

  function runMerge(
    targetProjectId: string,
    sourceOverride?: ProjectFingerprintSummary[],
    targetDisplayName?: string,
  ) {
    const sources = sourceOverride ?? mergeSources;
    if (sources.length === 0) return;
    const sourceIds = sources.map((org) => org.id);
    const targetNameHint =
      targetDisplayName ??
      projects.find((org) => org.id === targetProjectId)
        ?.displayName ??
      sources.find((org) => org.id === targetProjectId)?.displayName ??
      "project";

    startTransition(async () => {
      setMergeError(null);
      setMessage(null);
      const res = await fetch("/api/projects/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge",
          sourceProjectIds: sourceIds,
          targetProjectId,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        survivorId?: string;
        merged?: number;
        error?: string;
      };
      if (!res.ok) {
        setMergeError(json.error ?? "Merge failed.");
        return;
      }
      setMergeSources([]);
      setMergeCandidatePool([]);
      setCheckedProjectIds(new Set());

      const survivorId = json.survivorId ?? targetProjectId;
      const mergedCount = json.merged ?? sources.length;

      // Instant UI update — don't block on the expensive registry reload.
      const optimistic = applyOptimisticProjectMerge({
        projects,
        duplicateGroups,
        targetId: survivorId,
        sourceIds,
      });
      setProjects(optimistic.projects);
      setDuplicateGroups(optimistic.duplicateGroups);
      setStats((prev) => ({
        ...prev,
        projectCount: optimistic.projects.length,
      }));
      setSelectedId(survivorId);
      setMessage(
        `Merged ${mergedCount} project${mergedCount === 1 ? "" : "s"} into “${
          optimistic.survivor?.displayName ?? targetNameHint
        }”.`,
      );

      // Reconcile with server in the background.
      void (async () => {
        await refreshData();
        if (tab === "duplicates" || duplicatesLoaded.current) {
          await loadDuplicates();
        }
      })();
    });
  }

  function confirmSeverField() {
    if (!selected || !pendingSever) return;
    const org = selected;
    const sever = pendingSever;
    startTransition(async () => {
      setSeverError(null);
      setMessage(null);
      const res = await fetch("/api/projects/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deny_field",
          projectId: org.id,
          field: sever.field,
          value: sever.value,
          projectName: org.name ?? org.displayName,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setSeverError(json.error ?? "Could not sever association.");
        return;
      }
      setPendingSever(null);
      setMessage(
        `Stopped associating ${sever.label.toLowerCase()} “${sever.value}” with “${org.displayName}”.`,
      );
      const next = await refreshData();
      if (next) {
        const byName = next.find(
          (o) =>
            (o.name ?? o.displayName).toLowerCase() ===
            (org.name ?? org.displayName).toLowerCase(),
        );
        if (byName) setSelectedId(byName.id);
      }
    });
  }

  return (
    <div>
      <header className="mb-6">
        <dl className="flex flex-wrap gap-6 text-sm text-slate-700">
          <div>
            <dt className="text-slate-500">Projects</dt>
            <dd className="font-semibold">{stats.projectCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Thread merges</dt>
            <dd className="font-semibold">{stats.mergeCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Source emails</dt>
            <dd className="font-semibold">{stats.emailCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">In board reports</dt>
            <dd className="font-semibold">{stats.boardMentionedCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Mentions unresolved</dt>
            <dd className="font-semibold">
              {mentionStats.mentionUnresolvedCount.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Provisional</dt>
            <dd className="font-semibold">
              {mentionStats.mentionProvisionalCount.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Confirmed</dt>
            <dd className="font-semibold">
              {mentionStats.mentionConfirmedCount.toLocaleString()}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-slate-600">
          Unique projects from extraction pass 4 (thread merges),
          coalesced across threads by name and year. Use the merge icon to
          fold duplicates by hand — the absorbed name is kept as an alias, and
          contractors / locations / equipment mentions are combined. Different
          years stay separate until you merge them or AI review marks a
          capital job as one spanning initiative. Use × on a field to sever a
          wrong association; the system remembers not to reattach it. Check the
          Duplicates tab for AI review and fuzzy name matches. Mentions shows
          unresolved / provisional / confirmed project observations — Process
          pending project merges re-syncs the registry and re-runs the
          matcher. Scan management
          reports to tag the jobs the PM actually briefed the Board on — filter
          “In a management report” for the curated list. Click unmatched topics
          or waiting-on-markdown counts to inspect them; re-match with AI uses
          each card’s name and metadata, not fuzzy spelling.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={processPendingProjectMerges}
            className="rounded-md bg-orange-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-50"
          >
            Process pending project merges
            {mentionStats.mentionUnresolvedCount > 0
              ? ` (${mentionStats.mentionUnresolvedCount.toLocaleString()})`
              : ""}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={refresh}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={pending || boardScanRunning}
            onClick={startBoardScan}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-950 hover:bg-emerald-100 disabled:opacity-50"
          >
            {boardScanMatching
              ? "Matching topics…"
              : boardScanRunning
                ? "Scanning reports…"
                : "Scan management reports"}
          </button>
          {boardScanRun && !boardScanRunning ? (
            <button
              type="button"
              disabled={pending}
              onClick={rematchBoardScan}
              className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-950 hover:bg-emerald-50 disabled:opacity-50"
            >
              Re-match topics with AI
            </button>
          ) : null}
          {boardScanRunning ? (
            <button
              type="button"
              disabled={pending}
              onClick={cancelBoardScan}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel scan
            </button>
          ) : null}
        </div>
        {boardScanRun ? (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <p>
              {boardScanHeadline(boardScanRun)}
              {" · "}
              <span className="tabular-nums">
                {boardScanRun.matchedProjectCount} board-mentioned
              </span>
              {boardScanRun.skippedUnparsed > 0 ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => openBoardScanPanel("waiting")}
                    className={
                      boardScanPanel === "waiting"
                        ? "tabular-nums font-medium text-orange-800 underline"
                        : "tabular-nums text-orange-800 underline decoration-orange-300 hover:decoration-orange-800"
                    }
                  >
                    {boardScanRun.skippedUnparsed} waiting on markdown
                  </button>
                </>
              ) : null}
              {boardScanRun.unmatchedTopicCount > 0 ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => openBoardScanPanel("unmatched")}
                    className={
                      boardScanPanel === "unmatched"
                        ? "tabular-nums font-medium text-orange-800 underline"
                        : "tabular-nums text-orange-800 underline decoration-orange-300 hover:decoration-orange-800"
                    }
                  >
                    {boardScanRun.unmatchedTopicCount} unmatched topics
                  </button>
                </>
              ) : null}
              {boardScanRun.totalCostUsd > 0
                ? ` · ~$${boardScanRun.totalCostUsd.toFixed(3)}`
                : ""}
            </p>
            {boardScanPanel === "waiting" ? (
              <ul className="mt-2 max-h-64 overflow-y-auto border-t border-slate-200 pt-2 text-xs">
                {(boardScanReview?.waitingOnMarkdown ?? []).length === 0 ? (
                  <li className="text-slate-500">
                    Loading skipped packages…
                  </li>
                ) : (
                  (boardScanReview?.waitingOnMarkdown ?? []).map((doc) => (
                    <li
                      key={doc.id}
                      className="border-b border-slate-100 py-1.5 last:border-b-0"
                    >
                      {doc.emailId ? (
                        <a
                          href={`/knowledge/emails/${doc.emailId}`}
                          className="font-medium text-slate-900 hover:text-orange-800"
                        >
                          {doc.filename}
                        </a>
                      ) : (
                        <span className="font-medium text-slate-900">
                          {doc.filename}
                        </span>
                      )}
                      <span className="mt-0.5 block text-slate-500">
                        {doc.kind === "board_package"
                          ? "Board package"
                          : "Management report"}
                        {doc.reportDate ? ` · ${doc.reportDate}` : ""}
                        {doc.pageCount != null
                          ? ` · ${doc.pageCount} pages`
                          : ""}
                        {` · ${formatBoardParseStatus(doc.parseStatus)}`}
                        {doc.error ? ` · ${doc.error}` : ""}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
            {boardScanPanel === "unmatched" ? (
              <ul className="mt-2 max-h-64 overflow-y-auto border-t border-slate-200 pt-2 text-xs">
                {(boardScanReview?.unmatchedTopics ?? []).length === 0 ? (
                  <li className="text-slate-500">
                    Loading unmatched topics… After they load, use Re-match
                    topics with AI to map Maglock / electromagnetic-lock
                    synonyms onto registry cards.
                  </li>
                ) : (
                  (boardScanReview?.unmatchedTopics ?? []).map((topic) => (
                    <li
                      key={topic.canonical}
                      className="border-b border-slate-100 py-1.5 last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => searchProjectsForTopic(topic.name)}
                        className="text-left font-medium text-slate-900 hover:text-orange-800"
                      >
                        {topic.name}
                      </button>
                      <span className="mt-0.5 block text-slate-500">
                        {topic.mentionCount} mention
                        {topic.mentionCount === 1 ? "" : "s"} in{" "}
                        {topic.reportCount} report
                        {topic.reportCount === 1 ? "" : "s"}
                        {topic.section !== "other" ? ` · ${topic.section}` : ""}
                        {topic.yearHint ? ` · ${topic.yearHint}` : ""}
                        {topic.contractor ? ` · ${topic.contractor}` : ""}
                        {topic.reports[0]
                          ? ` · e.g. ${topic.reports[0].filename}`
                          : ""}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        ) : null}
        {boardScanError ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {boardScanError}
          </p>
        ) : null}
        {message ? (
          <p className="mt-3 text-sm text-slate-600" role="status">
            {message}
          </p>
        ) : null}
      </header>

      <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-200 pb-2 text-sm">
        {(
          [
            ["projects", "Projects"],
            ["mentions", "Mentions"],
            ["duplicates", "Duplicates"],
          ] as const
        ).map(([id, label]) => {
          const count =
            id === "projects"
              ? stats.projectCount
              : id === "mentions"
                ? mentionStats.mentionUnresolvedCount
                : duplicateGroups.length;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (id === "duplicates") openDuplicatesTab();
                else if (id === "mentions") openMentionsTab();
                else setTab(id);
              }}
              className={
                tab === id
                  ? "rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white"
                  : "rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100"
              }
            >
              {label}
              {count > 0 ? ` (${count.toLocaleString()})` : ""}
            </button>
          );
        })}
      </div>

      {tab === "duplicates" ? (
        <ProjectDuplicatesPanel
          groups={duplicateGroups}
          loading={duplicatesLoading}
          error={duplicatesError}
          pending={pending}
          waitReason={duplicatesWaitReason}
          reviewRun={reviewRun}
          reviewError={reviewError}
          reviewPending={reviewAction != null}
          onRefresh={() => {
            void (async () => {
              await loadDuplicates();
              await loadIdentityReview();
            })();
          }}
          onOpenMerge={openDuplicateMerge}
          onMergeAllInto={mergeAllDuplicatesInto}
          onStartReview={startIdentityReview}
          onCancelReview={cancelIdentityReview}
        />
      ) : tab === "mentions" ? (
        <ProjectMentionsPanel
          stats={mentionStats}
          statsKnown={mentionStatsKnown}
          pending={pending}
          onStats={(next) => {
            setMentionStats(next);
            setMentionStatsKnown(true);
          }}
          onChanged={() => {
            startTransition(async () => {
              await refreshData();
            });
          }}
          onOpenProject={openLinkedProject}
        />
      ) : (
      <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="flex max-h-[70vh] flex-col overflow-hidden border border-slate-200 bg-white">
          {sortedProjects.length > 0 ? (
            <ProjectListSortMenu value={projectSort} onChange={changeProjectSort} />
          ) : null}
          {sortedProjects.length > 0 ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
              <label className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  disabled={pending}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-orange-700 focus:ring-orange-500"
                />
                <span className="truncate">Select visible</span>
              </label>
              {checkedCount > 0 ? (
                <span className="min-w-0 truncate text-xs text-slate-500">
                  {checkedCount} selected
                </span>
              ) : null}
              <div className="ml-auto flex shrink-0 items-center">
                {checkedCount > 0 ? (
                  <>
                    <button
                      type="button"
                      disabled={pending || checkedCount < 2}
                      onClick={openBulkMerge}
                      title={
                        checkedCount < 2
                          ? "Select at least 2 projects to merge"
                          : `Merge ${checkedCount} selected projects`
                      }
                      aria-label={
                        checkedCount < 2
                          ? "Merge selected (select at least 2)"
                          : `Merge ${checkedCount} selected projects`
                      }
                      className="rounded p-1.5 text-slate-500 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-50"
                    >
                      <MergeIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setCheckedProjectIds(new Set())}
                      title="Clear selection"
                      aria-label="Clear selection"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                    >
                      <ClearSelectionIcon className="h-4 w-4" />
                    </button>
                  </>
                ) : null}
                <ProjectListFilterMenu
                  filters={listFilters}
                  years={filterOptions.years}
                  onChange={changeListFilters}
                />
                <ProjectListBadgeLegendMenu years={filterOptions.years} />
                <button
                  type="button"
                  onClick={() => setListSearchOpen((prev) => !prev)}
                  title="Search projects"
                  aria-label="Search projects"
                  aria-expanded={listSearchOpen}
                  className={
                    listSearchOpen
                      ? "rounded p-1.5 text-orange-700 bg-orange-50"
                      : "rounded p-1.5 text-slate-500 hover:bg-orange-50 hover:text-orange-700"
                  }
                >
                  <ListSearchIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
          {listSearchOpen && sortedProjects.length > 0 ? (
            <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">
              <input
                ref={listSearchInputRef}
                type="search"
                value={listSearch}
                onChange={(event) => {
                  setListSearch(event.target.value);
                  setListPage(1);
                }}
                placeholder="Filter by name, year, phase, contractor…"
                aria-label="Filter projects by name or metadata"
                className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-orange-600 focus:outline-none focus:ring-1 focus:ring-orange-600"
              />
            </div>
          ) : null}
          <ul className="overflow-y-auto">
          {sortedProjects.length === 0 ? (
            <li className="p-4 text-sm text-slate-500">
              No projects yet. Select threads on Emails and run{" "}
              <span className="font-medium text-slate-700">
                Extract Projects
              </span>{" "}
              (all 4 passes).
            </li>
          ) : filteredProjects.length === 0 ? (
            <li className="p-4 text-sm text-slate-500">
              No projects match these filters.
            </li>
          ) : (
            pagedProjects.map((org) => (
              <li key={org.id}>
                <div
                  className={
                    selectedId === org.id
                      ? "flex items-stretch border-b border-slate-100 bg-orange-50"
                      : checkedProjectIds.has(org.id)
                        ? "flex items-stretch border-b border-slate-100 bg-slate-100"
                        : "flex items-stretch border-b border-slate-100 hover:bg-slate-50"
                  }
                >
                  <label className="flex shrink-0 items-center self-stretch pl-3">
                    <input
                      type="checkbox"
                      checked={checkedProjectIds.has(org.id)}
                      disabled={pending}
                      onChange={(e) =>
                        toggleProjectChecked(org.id, e.target.checked)
                      }
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${org.displayName}`}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-orange-700 focus:ring-orange-500"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setSelectedId(org.id)}
                    className="min-w-0 flex-1 px-2 py-2 text-left"
                  >
                    <span className="block text-sm font-medium text-slate-900">
                      {org.displayName}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                      <ProjectScopeBadge scope={resolveProjectScope(org)} />
                      <ProjectPhaseBadge phase={org.phase} />
                      {normalizeProjectYearHint(org.year_hint) ? (
                        <ProjectYearBadge year={org.year_hint!.trim()} />
                      ) : null}
                      <ProjectBoardBadge count={org.boardReportCount ?? 0} />
                      {org.sourceEmailCount > 0 ? (
                        <span>
                          · {org.sourceEmailCount} email
                          {org.sourceEmailCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    title={`Merge ${org.displayName} into another project`}
                    aria-label={`Merge ${org.displayName} into another project`}
                    disabled={pending}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMergeError(null);
                      setMergeSources([org]);
                      setMergeCandidatePool(projects);
                    }}
                    className="shrink-0 self-center px-2.5 py-2 text-slate-400 hover:text-orange-700 disabled:opacity-50"
                  >
                    <MergeIcon className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))
          )}
          </ul>
          <EntityListPagination
            total={filteredProjects.length}
            page={listPage}
            pending={pending}
            onPageChange={setListPage}
            ariaLabel="Projects list pagination"
          />
        </div>

        <section className="border border-slate-200 bg-white p-4">
          {!selected ? (
            <p className="text-sm text-slate-500">Select a project.</p>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  openProfile({
                    kind: "project",
                    id: selected.id,
                    displayName: selected.displayName,
                  })
                }
                className="text-left"
              >
                <h2 className="text-lg font-semibold text-orange-800 underline-offset-2 hover:underline">
                  {selected.displayName}
                </h2>
              </button>
              <p className="mt-1 text-xs text-slate-500">
                {selected.sourceMergeCount > 0
                  ? `${selected.sourceMergeCount} thread merge${selected.sourceMergeCount === 1 ? "" : "s"}`
                  : "From pass-3 fingerprints (no merge yet)"}
                {selected.sourceEmailCount > 0 ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => {
                        setEvidenceTarget({
                          projectId: selected.id,
                          projectName: selected.displayName,
                          field: "source_emails",
                          value: selected.displayName,
                        });
                      }}
                      className="text-orange-800 underline-offset-2 hover:underline"
                    >
                      {selected.sourceEmailCount} source email
                      {selected.sourceEmailCount === 1 ? "" : "s"}
                    </button>
                  </>
                ) : null}
              </p>

              <dl className="mt-5 space-y-1.5">
                <FieldRow
                  label="Name"
                  value={selected.name}
                  disabled={pending}
                  onEvidence={() => {
                    if (!selected.name?.trim()) return;
                    setEvidenceTarget({
                      projectId: selected.id,
                      projectName: selected.displayName,
                      field: "name",
                      value: selected.name.trim(),
                    });
                  }}
                  onSever={() => {
                    if (!selected.name?.trim()) return;
                    setSeverError(null);
                    setPendingSever({
                      field: "name",
                      label: "Name",
                      value: selected.name.trim(),
                    });
                  }}
                />
                <MultiValueField
                  label="Also known as"
                  values={selected.aliases ?? []}
                  disabled={pending}
                  onEvidence={(value) => {
                    setEvidenceTarget({
                      projectId: selected.id,
                      projectName: selected.displayName,
                      field: "name_alias",
                      value,
                    });
                  }}
                  onSever={(value) => {
                    setSeverError(null);
                    setPendingSever({
                      field: "name_alias",
                      label: "Alias",
                      value,
                    });
                  }}
                />
                <FieldRow
                  label="Scope"
                  value={
                    PROJECT_SCOPE_LABELS[resolveProjectScope(selected) ?? "unknown"]
                  }
                />
                <FieldRow
                  label="Years"
                  value={normalizeProjectYearHint(selected.year_hint)}
                  disabled={pending}
                  onEvidence={() => {
                    const years = normalizeProjectYearHint(selected.year_hint);
                    if (!years) return;
                    setEvidenceTarget({
                      projectId: selected.id,
                      projectName: selected.displayName,
                      field: "year_hint",
                      value: years,
                    });
                  }}
                  onSever={() => {
                    const years = normalizeProjectYearHint(selected.year_hint);
                    if (!years) return;
                    setSeverError(null);
                    setPendingSever({
                      field: "year_hint",
                      label: "Years",
                      value: years,
                    });
                  }}
                />
                <FieldRow
                  label="Phase"
                  value={
                    normalizeProjectPhase(selected.phase)
                      ? PROJECT_PHASE_LABELS[normalizeProjectPhase(selected.phase)!]
                      : null
                  }
                  disabled={pending}
                  onEvidence={() => {
                    const phase = normalizeProjectPhase(selected.phase);
                    if (!phase) return;
                    setEvidenceTarget({
                      projectId: selected.id,
                      projectName: selected.displayName,
                      field: "phase",
                      value: phase,
                    });
                  }}
                  onSever={() => {
                    const phase = normalizeProjectPhase(selected.phase);
                    if (!phase) return;
                    setSeverError(null);
                    setPendingSever({
                      field: "phase",
                      label: "Phase",
                      value: phase,
                    });
                  }}
                />
                <MultiValueField
                  label="Contractor"
                  values={splitProjectMultiValue(selected.contractor)}
                  disabled={pending}
                  onEvidence={(value) => {
                    setEvidenceTarget({
                      projectId: selected.id,
                      projectName: selected.displayName,
                      field: "contractor",
                      value,
                    });
                  }}
                  onSever={(value) => {
                    setSeverError(null);
                    setPendingSever({
                      field: "contractor",
                      label: "Contractor",
                      value,
                    });
                  }}
                />
                <MultiValueField
                  label="Location"
                  values={splitProjectMultiValue(selected.location)}
                  disabled={pending}
                  onEvidence={(value) => {
                    setEvidenceTarget({
                      projectId: selected.id,
                      projectName: selected.displayName,
                      field: "location",
                      value,
                    });
                  }}
                  onSever={(value) => {
                    setSeverError(null);
                    setPendingSever({
                      field: "location",
                      label: "Location",
                      value,
                    });
                  }}
                />
                <MultiValueField
                  label="Equipment"
                  values={splitProjectMultiValue(selected.equipment_mentions)}
                  disabled={pending}
                  onEvidence={(value) => {
                    setEvidenceTarget({
                      projectId: selected.id,
                      projectName: selected.displayName,
                      field: "equipment_mentions",
                      value,
                    });
                  }}
                  onSever={(value) => {
                    setSeverError(null);
                    setPendingSever({
                      field: "equipment_mentions",
                      label: "Equipment",
                      value,
                    });
                  }}
                />
              </dl>

              {selected.modelIds.length > 0 ? (
                <p className="mt-5 text-xs text-slate-500">
                  Models: {selected.modelIds.join(", ")}
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
      )}

      <MergeEntityDialog
        open={mergeSources.length > 0}
        entityLabel="project"
        sources={mergeSources.map(projectToMergeOption)}
        candidates={(mergeCandidatePool.length > 0
          ? mergeCandidatePool
          : projects
        ).map(projectToMergeOption)}
        searchPlaceholder="Search by name, year, contractor, or location…"
        busy={pending}
        error={mergeError}
        onClose={() => {
          if (pending) return;
          setMergeSources([]);
          setMergeCandidatePool([]);
          setMergeError(null);
        }}
        onMerge={runMerge}
      />

      <ConfirmDialog
        open={pendingSever != null && selected != null}
        title="Sever association?"
        description={
          pendingSever && selected ? (
            <div className="space-y-2">
              <p>
                Stop associating{" "}
                <span className="font-medium text-slate-800">
                  {pendingSever.label.toLowerCase()} “{pendingSever.value}”
                </span>{" "}
                with{" "}
                <span className="font-medium text-slate-800">
                  {selected.displayName}
                </span>
                ?
              </p>
              <p>
                The system will remember this and will not reattach that value
                to this project on future extractions.
              </p>
              {severError ? (
                <p className="text-sm text-red-600" role="alert">
                  {severError}
                </p>
              ) : null}
            </div>
          ) : null
        }
        confirmLabel="OK"
        cancelLabel="Cancel"
        busy={pending}
        busyLabel="Saving…"
        onConfirm={confirmSeverField}
        onCancel={() => {
          if (pending) return;
          setPendingSever(null);
          setSeverError(null);
        }}
      />

      <ProjectEvidenceSidePanel
        target={evidenceTarget}
        onClose={() => setEvidenceTarget(null)}
      />
    </div>
  );
}
