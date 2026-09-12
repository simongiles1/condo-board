"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  formatCostUsd,
  formatTokenCount,
  getLatestGoldStandardValidationRun,
  parseStoredAiUsage,
} from "@/lib/gemini/usage";
import {
  displaySegmentMark,
  findingsForAlignmentColumn,
  scoreCompareDocument,
} from "@/lib/minutes/gold-standard-compare";
import { HOVER_POPOVER_ATTR } from "@/lib/ui/hover-popover-group";
import { useHoverPopover } from "@/lib/ui/use-hover-popover";
import {
  significanceChipClasses,
  significanceLabel,
  validationScoreBadgeClasses,
  validationScoreLabel,
  type CompareAlignment,
  type CompareTextMark,
  type GoldStandardValidationResult,
  type ValidationFinding,
} from "@/lib/minutes/gold-standard-schema";

type ValidationTab = "generatedOnly" | "goldOnly";

export type GoldStandardValidationTab = ValidationTab;

export type GoldStandardMeetingSummary = {
  id?: string;
  title: string;
  meetingDate?: string;
  aiUsageJson?: string | null;
  goldStandardFilePath?: string | null;
};

type Props = {
  meeting: GoldStandardMeetingSummary | null;
  validation: GoldStandardValidationResult | null;
  initialTab?: ValidationTab;
  focusAgendaItemId?: string | null;
  reCompareBusy?: boolean;
  onClose: () => void;
  onReCompare: () => void;
  onUploadDifferent?: () => void;
};

const MARK_CLASSES: Record<CompareTextMark, string> = {
  same: "text-slate-800",
  added: "bg-emerald-100 text-emerald-950",
  omitted: "bg-rose-100 text-rose-950",
  changed: "bg-amber-100 text-amber-950",
  motion: "bg-sky-100 text-sky-950",
  amount: "bg-violet-100 text-violet-950",
};

const MARK_LABELS: Record<CompareTextMark, string> = {
  same: "Same",
  added: "In AI only",
  omitted: "In gold only",
  changed: "Changed",
  motion: "Differing motion",
  amount: "Differing amount",
};

const VIEWPORT_MARGIN = 8;

function formatAnalyzedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function alignmentChip(kind: CompareAlignment["kind"]): string {
  if (kind === "gold_only") return "bg-violet-100 text-violet-900";
  if (kind === "ai_only") return "bg-sky-100 text-sky-900";
  if (kind === "1:n" || kind === "n:1") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}

function alignmentKindLabel(kind: CompareAlignment["kind"]): string {
  if (kind === "gold_only") return "Gold only";
  if (kind === "ai_only") return "AI only";
  if (kind === "1:n") return "Gold merged";
  if (kind === "n:1") return "Gold split";
  return "Paired";
}

function alignmentKindTitle(kind: CompareAlignment["kind"]): string {
  if (kind === "gold_only") {
    return "This concept appears only in the gold-standard minutes.";
  }
  if (kind === "ai_only") {
    return "This concept appears only in the AI minutes.";
  }
  if (kind === "1:n") {
    return "One gold concept covers several AI items. The percent is wording agreement, not whether a pair was found.";
  }
  if (kind === "n:1") {
    return "Several gold concepts fold into one AI item. The percent is wording agreement, not whether a pair was found.";
  }
  return "The same agenda matter exists on both sides. The percent is how closely the wording and facts agree.";
}

function computePopoverPosition(
  triggerRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
  preferBelow: boolean,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const spaceBelow = viewportHeight - triggerRect.bottom - VIEWPORT_MARGIN;
  const showBelow =
    preferBelow && spaceBelow >= popoverHeight * 0.5;

  let top: number;
  if (showBelow) {
    top = triggerRect.bottom + VIEWPORT_MARGIN;
  } else {
    top = Math.max(
      VIEWPORT_MARGIN,
      triggerRect.top - popoverHeight - VIEWPORT_MARGIN,
    );
  }

  let left = triggerRect.left + triggerRect.width / 2 - popoverWidth / 2;
  left = Math.min(
    Math.max(left, VIEWPORT_MARGIN),
    viewportWidth - popoverWidth - VIEWPORT_MARGIN,
  );

  return { position: "fixed", top, left, zIndex: 60 };
}

function CompareLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
      {(Object.keys(MARK_LABELS) as CompareTextMark[]).map((mark) => (
        <span
          key={mark}
          className={`rounded px-1.5 py-0.5 font-medium ${MARK_CLASSES[mark]}`}
        >
          {MARK_LABELS[mark]}
        </span>
      ))}
    </div>
  );
}

function HighlightedProse({
  segments,
  emptyLabel = "No counterpart on this side.",
}: {
  segments: Array<{ text: string; mark: CompareTextMark }>;
  emptyLabel?: string;
}) {
  if (segments.length === 0) {
    return (
      <p className="min-h-[1.25rem] text-sm italic text-slate-400">{emptyLabel}</p>
    );
  }
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {segments.map((segment, index) => {
        const mark = displaySegmentMark(segment.mark, segment.text);
        return (
          <span
            key={`${index}-${segment.mark}`}
            className={`rounded-sm ${MARK_CLASSES[mark]}`}
            title={MARK_LABELS[mark]}
          >
            {segment.text}
          </span>
        );
      })}
    </p>
  );
}

function FindingSignificanceBadge({ finding }: { finding: ValidationFinding }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hover = useHoverPopover({ scanGroup: "gold-compare-finding" });
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 60,
  });

  useLayoutEffect(() => {
    if (!hover.open || !rootRef.current || !popoverRef.current) return;
    const triggerRect = rootRef.current.getBoundingClientRect();
    const popover = popoverRef.current;
    setPopoverStyle({
      ...computePopoverPosition(
        triggerRect,
        popover.offsetWidth,
        popover.offsetHeight,
        true,
      ),
      visibility: "visible",
    });
  }, [hover.open, finding.id]);

  useEffect(() => {
    if (!hover.open) return;
    function update() {
      const triggerRect = rootRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!triggerRect || !popover) return;
      setPopoverStyle({
        ...computePopoverPosition(
          triggerRect,
          popover.offsetWidth,
          popover.offsetHeight,
          true,
        ),
        visibility: "visible",
      });
    }
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [hover.open]);

  return (
    <>
      <span
        ref={rootRef}
        className="inline-flex"
        onMouseEnter={hover.onTriggerEnter}
        onMouseLeave={hover.onTriggerLeave}
      >
        <span
          className={`inline-flex cursor-default rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${significanceChipClasses(finding.significance)}`}
        >
          {significanceLabel(finding.significance)}
        </span>
      </span>
      {hover.open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-72 max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
              {...{ [HOVER_POPOVER_ATTR]: "" }}
              onMouseEnter={hover.onPopoverEnter}
              onMouseLeave={hover.onPopoverLeave}
            >
              <p className="text-xs font-semibold text-slate-900">{finding.topic}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-700">
                {finding.detail}
              </p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function AlignmentKindBadge({
  alignment,
  compact,
}: {
  alignment: CompareAlignment;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full font-semibold ${alignmentChip(alignment.kind)} ${
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[10px]"
      }`}
      title={alignmentKindTitle(alignment.kind)}
    >
      {alignmentKindLabel(alignment.kind)}
    </span>
  );
}

function ConceptTitle({
  alignment,
  className = "",
}: {
  alignment: CompareAlignment;
  className?: string;
}) {
  const inlineKind =
    alignment.kind === "ai_only" || alignment.kind === "gold_only";
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 ${className}`}>
      <span className="truncate">{alignment.label}</span>
      {inlineKind ? <AlignmentKindBadge alignment={alignment} compact /> : null}
    </span>
  );
}

function ConceptMatchCluster({
  alignment,
  findings,
  pairScore,
  compact,
}: {
  alignment: CompareAlignment;
  findings: ValidationFinding[];
  pairScore: number | null;
  compact?: boolean;
}) {
  const goldFindings = findingsForAlignmentColumn(alignment, findings, "gold");
  const aiFindings = findingsForAlignmentColumn(alignment, findings, "ai");
  const showKind =
    alignment.kind !== "ai_only" && alignment.kind !== "gold_only";
  const scoreClass = compact
    ? "min-w-[2.25rem] text-[10px]"
    : "min-w-[2.5rem] text-xs";

  return (
    <div className="flex shrink-0 items-center gap-1">
      {showKind ? <AlignmentKindBadge alignment={alignment} compact /> : null}
      <div className="flex items-center justify-end gap-1">
        {goldFindings.map((finding) => (
          <FindingSignificanceBadge key={finding.id} finding={finding} />
        ))}
      </div>
      <span
        className={`font-mono tabular-nums text-center font-semibold text-slate-600 ${scoreClass}`}
        title="How closely this pair's wording and facts agree (0–100)."
      >
        {pairScore != null ? `${pairScore}%` : "—"}
      </span>
      <div className="flex items-center justify-start gap-1">
        {aiFindings.map((finding) => (
          <FindingSignificanceBadge key={finding.id} finding={finding} />
        ))}
      </div>
    </div>
  );
}

function FindingsList({ findings }: { findings: ValidationFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {findings.map((finding) => (
        <li
          key={finding.id}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-xs font-semibold text-slate-900">{finding.topic}</p>
            <span
              className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${significanceChipClasses(finding.significance)}`}
            >
              {significanceLabel(finding.significance)}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-700">
            {finding.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function GoldStandardValidationSidePanel({
  meeting,
  validation,
  initialTab = "generatedOnly",
  focusAgendaItemId = null,
  reCompareBusy = false,
  onClose,
  onReCompare,
  onUploadDifferent,
}: Props) {
  const [differencesOnly, setDifferencesOnly] = useState(
    initialTab === "generatedOnly" || initialTab === "goldOnly",
  );
  const [activeAlignmentId, setActiveAlignmentId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const skipScrollSpyRef = useRef(false);
  const pendingContentScrollRef = useRef(false);
  const openedForValidationRef = useRef<string | null>(null);

  useEffect(() => {
    if (!meeting || !validation) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [meeting, validation, onClose]);

  const compare = validation?.compare ?? null;
  const pairByAlignmentId = useMemo(() => {
    const map = new Map<string, NonNullable<typeof compare>["pairs"][number]>();
    if (!compare) return map;
    for (const pair of compare.pairs) {
      map.set(pair.alignmentId, pair);
    }
    return map;
  }, [compare]);

  const visibleAlignments = useMemo(() => {
    if (!compare) return [];
    if (!differencesOnly) return compare.alignments;
    return compare.alignments.filter((alignment) => {
      const pair = pairByAlignmentId.get(alignment.id);
      if (!pair) return alignment.kind === "gold_only" || alignment.kind === "ai_only";
      if (pair.findings.length > 0) return true;
      return pair.goldSegments.some((segment) => segment.mark !== "same") ||
        pair.aiSegments.some((segment) => segment.mark !== "same");
    });
  }, [compare, differencesOnly, pairByAlignmentId]);

  const conceptCounts = useMemo(() => {
    if (!compare) {
      return { aiOnly: 0, goldOnly: 0, paired: 0 };
    }
    let aiOnly = 0;
    let goldOnly = 0;
    let paired = 0;
    for (const alignment of compare.alignments) {
      if (alignment.kind === "ai_only") aiOnly += 1;
      else if (alignment.kind === "gold_only") goldOnly += 1;
      else paired += 1;
    }
    return { aiOnly, goldOnly, paired };
  }, [compare]);

  useEffect(() => {
    if (!compare || !validation) return;
    const openKey = `${validation.analyzedAt}:${compare.alignments.length}`;
    if (openedForValidationRef.current === openKey) return;
    openedForValidationRef.current = openKey;

    let nextId: string | null = null;
    let shouldScroll = false;
    if (focusAgendaItemId) {
      const match = compare.alignments.find((alignment) =>
        alignment.aiConceptIds.some((id) =>
          compare.aiConcepts
            .find((concept) => concept.id === id)
            ?.agendaItemIds.includes(focusAgendaItemId),
        ),
      );
      nextId = match?.id ?? null;
      shouldScroll = Boolean(nextId);
    }

    const firstInList =
      visibleAlignments[0]?.id ?? compare.alignments[0]?.id ?? null;
    setActiveAlignmentId(nextId ?? firstInList);
    pendingContentScrollRef.current = shouldScroll;
    skipScrollSpyRef.current = true;

    requestAnimationFrame(() => {
      if (!shouldScroll && scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      window.setTimeout(() => {
        skipScrollSpyRef.current = false;
      }, 100);
    });
  }, [compare, validation, focusAgendaItemId, visibleAlignments]);

  useEffect(() => {
    if (!activeAlignmentId || !scrollRef.current) return;
    if (!pendingContentScrollRef.current) return;
    pendingContentScrollRef.current = false;
    const node = scrollRef.current.querySelector(
      `[data-alignment-id="${activeAlignmentId}"]`,
    );
    if (node instanceof HTMLElement) {
      skipScrollSpyRef.current = true;
      node.scrollIntoView({ block: "start", behavior: "smooth" });
      window.setTimeout(() => {
        skipScrollSpyRef.current = false;
      }, 450);
    }
  }, [activeAlignmentId]);

  useEffect(() => {
    if (!activeAlignmentId || !navRef.current) return;
    const node = navRef.current.querySelector(
      `[data-nav-alignment-id="${activeAlignmentId}"]`,
    );
    if (node instanceof HTMLElement) {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [activeAlignmentId]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !compare) return;

    function syncFromScroll() {
      if (skipScrollSpyRef.current || !root) return;
      const sections = [
        ...root.querySelectorAll<HTMLElement>("[data-alignment-id]"),
      ];
      if (sections.length === 0) return;
      const header = root.querySelector("[data-compare-sticky-header]");
      const headerHeight =
        header instanceof HTMLElement ? header.getBoundingClientRect().height : 56;
      const line = root.getBoundingClientRect().top + headerHeight + 8;
      let current = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) {
          current = section;
        }
      }
      const nextId = current.dataset.alignmentId ?? null;
      if (nextId) {
        setActiveAlignmentId((previous) => (previous === nextId ? previous : nextId));
      }
    }

    root.addEventListener("scroll", syncFromScroll, { passive: true });
    return () => root.removeEventListener("scroll", syncFromScroll);
  }, [compare, visibleAlignments]);

  const compareScore = useMemo(() => {
    if (!compare) return null;
    return scoreCompareDocument(compare);
  }, [compare]);

  const costRun = useMemo(() => {
    if (!meeting?.aiUsageJson) return null;
    const log = parseStoredAiUsage(meeting.aiUsageJson);
    return getLatestGoldStandardValidationRun(log);
  }, [meeting?.aiUsageJson]);

  if (!meeting || !validation) return null;

  const generatedCount = validation.generatedOnly.length;
  const goldCount = validation.goldOnly.length;
  const displayedScore = compareScore?.validationScore ?? validation.validationScore;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 text-lg font-semibold text-slate-900">
              Gold standard compare
            </h2>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ring-1 ${validationScoreBadgeClasses(displayedScore)}`}
              title="Average of the per-concept agreement scores in the list"
            >
              {validationScoreLabel(displayedScore)}
            </span>
            {compare ? (
              <>
                <span
                  className="inline-flex rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-900"
                  title="Concepts present only in the AI minutes"
                >
                  {conceptCounts.aiOnly} AI only
                </span>
                <span
                  className="inline-flex rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-900"
                  title="Concepts present only in the gold-standard minutes"
                >
                  {conceptCounts.goldOnly} Gold only
                </span>
              </>
            ) : null}
          </div>
          <p className="mt-1 text-sm font-medium text-slate-800">{meeting.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Compared {formatAnalyzedAt(validation.analyzedAt)}
            {compare ? ` · ${compare.alignments.length} concepts` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          {compare ? (
            <div className="max-w-[min(28rem,42vw)] pt-0.5">
              <CompareLegend />
            </div>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </header>

      {compare ? (
        <div className="flex min-h-0 flex-1">
          <nav
            ref={navRef}
            className="hidden w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 lg:block"
          >
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={differencesOnly}
                  onChange={(event) => setDifferencesOnly(event.target.checked)}
                />
                Differences only
              </label>
            </div>
            <ul className="p-2">
              {visibleAlignments.map((alignment) => {
                const pair = pairByAlignmentId.get(alignment.id);
                const selected = alignment.id === activeAlignmentId;
                return (
                  <li key={alignment.id}>
                    <button
                      type="button"
                      data-nav-alignment-id={alignment.id}
                      onClick={() => {
                        pendingContentScrollRef.current = true;
                        skipScrollSpyRef.current = true;
                        setActiveAlignmentId(alignment.id);
                      }}
                      className={`mb-1 w-full rounded-lg px-2.5 py-2 text-left transition ${
                        selected
                          ? "bg-white shadow-sm ring-1 ring-slate-200"
                          : "hover:bg-white/70"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <ConceptTitle
                          alignment={alignment}
                          className="min-w-0 flex-1 text-xs font-semibold text-slate-900"
                        />
                        <ConceptMatchCluster
                          alignment={alignment}
                          findings={pair?.findings ?? []}
                          pairScore={pair?.pairScore ?? null}
                          compact
                        />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div
              data-compare-sticky-header
              className="sticky top-0 z-10 border-b border-slate-200 bg-white shadow-sm"
            >
              <div className="grid grid-cols-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <div className="border-r border-slate-200 px-4 py-2">
                  Gold standard
                </div>
                <div className="px-4 py-2">AI minutes</div>
              </div>
            </div>
            {visibleAlignments.map((alignment) => {
              const pair = pairByAlignmentId.get(alignment.id);
              const findings = pair?.findings ?? [];
              return (
                <section
                  key={alignment.id}
                  data-alignment-id={alignment.id}
                  className={`scroll-mt-9 border-t border-slate-200 ${
                    alignment.id === activeAlignmentId ? "bg-teal-50/30" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2">
                    <h3 className="min-w-0 flex-1 text-sm font-semibold text-slate-900">
                      <ConceptTitle alignment={alignment} />
                    </h3>
                    <ConceptMatchCluster
                      alignment={alignment}
                      findings={findings}
                      pairScore={pair?.pairScore ?? null}
                    />
                  </div>
                  <div className="grid grid-cols-2 items-start pb-3 pt-2">
                    <div className="border-r border-slate-100 px-4 pb-1 pt-1">
                      <HighlightedProse segments={pair?.goldSegments ?? []} />
                    </div>
                    <div className="px-4 pb-1 pt-1">
                      <HighlightedProse segments={pair?.aiSegments ?? []} />
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Score rationale
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-800">
              {validation.scoreRationale}
            </p>
          </section>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                In AI only ({generatedCount})
              </h3>
              <FindingsList findings={validation.generatedOnly} />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                In gold only ({goldCount})
              </h3>
              <FindingsList findings={validation.goldOnly} />
            </section>
          </div>
        </div>
      )}

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
        <div className="text-xs text-slate-500">
          {costRun ? (
            <span>
              {formatTokenCount(costRun.inputTokens)} in /{" "}
              {formatTokenCount(costRun.outputTokens)} out · {costRun.modelName} ·{" "}
              <span className="font-semibold text-teal-800">
                {formatCostUsd(costRun.costUsd)}
              </span>
            </span>
          ) : (
            "Cost details are not available for this run."
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {onUploadDifferent ? (
            <button
              type="button"
              onClick={onUploadDifferent}
              disabled={reCompareBusy}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
            >
              Upload different PDF
            </button>
          ) : null}
          <button
            type="button"
            onClick={onReCompare}
            disabled={reCompareBusy}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
          >
            {reCompareBusy ? "Re-comparing…" : "Re-compare"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-800"
          >
            Close
          </button>
        </div>
      </footer>
    </div>
  );
}
