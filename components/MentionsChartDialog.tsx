"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import type {
  MentionChartKind,
  MentionChartMember,
  MentionChartStat,
} from "@/lib/contacts/mention-chart";
import { fitMentionFrequencyCurve } from "@/lib/contacts/mention-curve-fit";

import styles from "./MentionsChartDialog.module.css";

type EntityKind = "contacts" | "organizations" | "projects";
type FilterKind = "all" | MentionChartKind | "fingerprint";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Prefer matching the Entities page tab when the dialog opens. */
  initialEntity?: EntityKind;
};

const ENTITY_TABS: Array<{ id: EntityKind; label: string }> = [
  { id: "contacts", label: "Contacts" },
  { id: "organizations", label: "Organizations" },
  { id: "projects", label: "Projects" },
];

const CONTACT_FILTERS: Array<{ id: FilterKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "name", label: "Name only" },
  { id: "email", label: "Email only" },
  { id: "fingerprint", label: "Fingerprints" },
];

const ORG_FILTERS: Array<{ id: FilterKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "name", label: "Name only" },
  { id: "email", label: "Email only" },
  { id: "website", label: "Website only" },
  { id: "phone", label: "Phone only" },
  { id: "fingerprint", label: "Fingerprints" },
];

const PROJECT_FILTERS: Array<{ id: FilterKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "name", label: "Name only" },
  { id: "fingerprint", label: "Fingerprints" },
];

/** Cumulative share cutoffs drawn as vertical Pareto lines (left → right). */
const PARETO_MARKERS: Array<{
  fraction: number;
  label: string;
  tone: "80" | "90" | "95";
}> = [
  { fraction: 0.8, label: "80%", tone: "80" },
  { fraction: 0.9, label: "90%", tone: "90" },
  { fraction: 0.95, label: "95%", tone: "95" },
];

/**
 * Smallest 0-based index whose cumulative count (from rank 1) reaches
 * `fraction` of the series total — i.e. the right edge of that bar.
 */
function cumulativeShareIndex(
  counts: readonly number[],
  fraction: number,
): number | null {
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total <= 0 || counts.length === 0) return null;
  const target = total * fraction;
  let cum = 0;
  for (let i = 0; i < counts.length; i++) {
    cum += counts[i]!;
    if (cum >= target) return i;
  }
  return counts.length - 1;
}

const PLOT_W = 760;
const PLOT_H = 420;
const PAD = { top: 16, right: 16, bottom: 88, left: 52 };
const INNER_W = PLOT_W - PAD.left - PAD.right;
const INNER_H = PLOT_H - PAD.top - PAD.bottom;
/** Min px per category before x labels collapse to hover dots. */
const LABEL_MIN_PX = 28;
const MIN_VISIBLE = 8;

const MEMBER_KIND_LABEL: Record<MentionChartKind, string> = {
  name: "name",
  email: "email",
  website: "site",
  phone: "phone",
};

function memberListHasDuplicateLabels(members: MentionChartMember[]): boolean {
  const labels = new Set<string>();
  for (const m of members) {
    const normalized = m.label.toLowerCase();
    if (labels.has(normalized)) return true;
    labels.add(normalized);
  }
  return false;
}

type HoverState = {
  label: string;
  count: number;
  kind: string;
  members?: MentionChartMember[];
  showMemberKinds?: boolean;
  x: number;
  y: number;
};

export function MentionsChartDialog({
  open,
  onClose,
  initialEntity = "contacts",
}: Props) {
  const [entity, setEntity] = useState<EntityKind>(initialEntity);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [surfaceMentions, setSurfaceMentions] = useState<MentionChartStat[]>(
    [],
  );
  const [fingerprintMentions, setFingerprintMentions] = useState<
    MentionChartStat[]
  >([]);
  const [meta, setMeta] = useState<{
    total: number;
    runs: number;
    fallback: boolean;
  } | null>(null);

  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(1);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [dragging, setDragging] = useState(false);

  const dragOriginX = useRef(0);
  const dragOriginStart = useRef(0);
  const dragOriginEnd = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const kindFilters =
    entity === "organizations"
      ? ORG_FILTERS
      : entity === "projects"
        ? PROJECT_FILTERS
        : CONTACT_FILTERS;

  const filtered = useMemo(() => {
    if (filter === "fingerprint") return fingerprintMentions;
    if (filter === "all") return surfaceMentions;
    return surfaceMentions.filter((m) => m.kind === filter);
  }, [filter, fingerprintMentions, surfaceMentions]);

  const n = filtered.length;
  const maxCount = useMemo(
    () => filtered.reduce((m, row) => Math.max(m, row.count), 0) || 1,
    [filtered],
  );
  const visibleSpan = Math.max(MIN_VISIBLE, viewEnd - viewStart);
  const barSlot = n > 0 ? INNER_W / Math.min(n, visibleSpan) : INNER_W;
  const showLabels = barSlot >= LABEL_MIN_PX;
  const seriesTotal = useMemo(
    () => filtered.reduce((sum, row) => sum + row.count, 0),
    [filtered],
  );

  /** Indices where cumulative mentions reach 80% / 90% / 95% of the series. */
  const paretoLines = useMemo(() => {
    if (n === 0 || seriesTotal <= 0) return [];
    const counts = filtered.map((row) => row.count);
    return PARETO_MARKERS.flatMap((marker, labelSlot) => {
      const index = cumulativeShareIndex(counts, marker.fraction);
      if (index === null) return [];
      // Right edge of the last bar included in this cumulative share.
      const x = PAD.left + (index + 1 - viewStart) * barSlot;
      const plotLeft = PAD.left;
      const plotRight = PAD.left + INNER_W;
      if (x < plotLeft - 0.5 || x > plotRight + 0.5) return [];
      return [
        {
          ...marker,
          index,
          x,
          labelY: PAD.top + 10 + labelSlot * 34,
          labelsInShare: index + 1,
          pctOfLabels: n > 0 ? ((index + 1) / n) * 100 : 0,
        },
      ];
    });
  }, [barSlot, filtered, n, seriesTotal, viewStart]);

  /** Re-fit Zipf vs exponential whenever the filtered series changes. */
  const curveFit = useMemo(
    () => fitMentionFrequencyCurve(filtered.map((row) => row.count)),
    [filtered],
  );

  const curvePath = useMemo(() => {
    if (!curveFit || n === 0) return null;
    const start = Math.max(0, Math.floor(viewStart));
    const end = Math.min(n, Math.ceil(viewEnd));
    if (end <= start) return null;

    const points: string[] = [];
    for (let i = start; i < end; i++) {
      const rank = i + 1;
      const predicted = Math.max(0, curveFit.predict(rank));
      const x = PAD.left + (i - viewStart + 0.5) * barSlot;
      const y =
        PAD.top + INNER_H - Math.min(INNER_H, (predicted / maxCount) * INNER_H);
      points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return points.length >= 2 ? `M ${points.join(" L ")}` : null;
  }, [barSlot, curveFit, maxCount, n, viewEnd, viewStart]);

  const visibleRows = useMemo(() => {
    if (n === 0) return [];
    const start = Math.max(0, Math.floor(viewStart));
    const end = Math.min(n, Math.ceil(viewEnd));
    const rows: Array<
      MentionChartStat & { i: number; x: number; barW: number; h: number }
    > = [];
    for (let i = start; i < end; i++) {
      const row = filtered[i]!;
      const x = PAD.left + (i - viewStart) * barSlot;
      const barW = Math.max(1, barSlot * 0.72);
      const h = (row.count / maxCount) * INNER_H;
      rows.push({ ...row, i, x: x + (barSlot - barW) / 2, barW, h });
    }
    return rows;
  }, [barSlot, filtered, maxCount, n, viewEnd, viewStart]);

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const steps = 4;
    for (let s = 0; s <= steps; s++) {
      ticks.push(Math.round((maxCount * s) / steps));
    }
    return [...new Set(ticks)];
  }, [maxCount]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHover(null);
    setMeta(null);
    const endpoint =
      entity === "organizations"
        ? "/api/organizations/mention-stats"
        : entity === "projects"
          ? "/api/projects/mention-stats"
          : "/api/contacts/mention-stats";
    try {
      const res = await fetch(endpoint);
      const data = (await res.json()) as {
        surface?: {
          mentions?: MentionChartStat[];
          total_mentions?: number;
          run_count?: number;
          fallback?: boolean;
        };
        fingerprints?: {
          mentions?: MentionChartStat[];
          run_count?: number;
        };
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load mention stats");
      }
      setSurfaceMentions(data.surface?.mentions ?? []);
      setFingerprintMentions(data.fingerprints?.mentions ?? []);
      setMeta({
        total: data.surface?.total_mentions ?? 0,
        runs: Math.max(
          data.surface?.run_count ?? 0,
          data.fingerprints?.run_count ?? 0,
        ),
        fallback: !!data.surface?.fallback,
      });
    } catch (e) {
      setSurfaceMentions([]);
      setFingerprintMentions([]);
      setMeta(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [entity]);

  useEffect(() => {
    if (!open) return;
    setEntity(initialEntity);
    setFilter("all");
  }, [open, initialEntity]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    setViewStart(0);
    setViewEnd(Math.max(filtered.length, 1));
  }, [filter, entity, surfaceMentions, fingerprintMentions, filtered.length]);

  useEffect(() => {
    const allowed = new Set(kindFilters.map((f) => f.id));
    if (!allowed.has(filter)) setFilter("all");
  }, [kindFilters, filter]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Non-passive wheel so preventDefault can stop page scroll while zooming.
  useEffect(() => {
    const node = svgRef.current;
    if (!open || !node) return;
    const handler = (event: WheelEvent) => {
      if (n <= MIN_VISIBLE) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const mx = event.clientX - rect.left - PAD.left;
      const frac = Math.min(1, Math.max(0, mx / INNER_W));
      const anchor = viewStart + frac * (viewEnd - viewStart);
      const zoomIn = event.deltaY < 0;
      const factor = zoomIn ? 0.85 : 1.18;
      const span = Math.max(MIN_VISIBLE, Math.min(n, (viewEnd - viewStart) * factor));
      clampView(anchor - frac * span, anchor - frac * span + span);
    };
    node.addEventListener("wheel", handler, { passive: false });
    return () => node.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clampView uses n/view state via closure refresh on deps
  }, [open, n, viewStart, viewEnd]);

  function clampView(start: number, end: number) {
    const span = Math.max(MIN_VISIBLE, Math.min(n || 1, end - start));
    let s = start;
    let e = s + span;
    if (e > n) {
      e = n;
      s = Math.max(0, e - span);
    }
    if (s < 0) {
      s = 0;
      e = Math.min(n, s + span);
    }
    setViewStart(s);
    setViewEnd(Math.max(s + MIN_VISIBLE, e));
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (n <= MIN_VISIBLE) return;
    setDragging(true);
    dragOriginX.current = event.clientX;
    dragOriginStart.current = viewStart;
    dragOriginEnd.current = viewEnd;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragging) return;
    const dx = event.clientX - dragOriginX.current;
    const span = dragOriginEnd.current - dragOriginStart.current;
    const deltaIdx = -(dx / INNER_W) * span;
    clampView(
      dragOriginStart.current + deltaIdx,
      dragOriginEnd.current + deltaIdx,
    );
  }

  function onPointerUp() {
    setDragging(false);
  }

  function resetZoom() {
    setViewStart(0);
    setViewEnd(Math.max(n, 1));
  }

  function updateHover(
    row: MentionChartStat,
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
  ) {
    const rect = svg.getBoundingClientRect();
    const members =
      row.members && row.members.length > 1 ? row.members : undefined;
    setHover({
      label: row.label,
      count: row.count,
      kind: row.kind,
      members,
      showMemberKinds: members
        ? memberListHasDuplicateLabels(members)
        : undefined,
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  }

  if (!open) return null;

  const lede =
    entity === "organizations"
      ? filter === "fingerprint"
        ? "One bar per organization (height = max of name / email / website / phone evidence). Scroll to zoom X · drag to pan · hover for member breakdown."
        : "Organization names, emails, websites, and phones by source-email count. Scroll to zoom X · drag to pan · hover for labels."
      : entity === "projects"
        ? filter === "fingerprint"
          ? "One bar per project (height = source-email count). Scroll to zoom X · drag to pan · hover for member breakdown."
          : "Project names, contractors, and locations by source-email count. Scroll to zoom X · drag to pan · hover for labels."
      : filter === "fingerprint"
        ? "Confirmed fingerprint links merge into one bar (height = max member mentions). Unlinked surfaces stay separate. Scroll to zoom X · drag to pan · hover for member breakdown."
        : meta?.fallback
          ? "Cluster canonicals from the registry (surface forms merge into people). Scroll to zoom X · drag to pan · hover for labels."
          : "Registry names and emails by mention count. Scroll to zoom X · drag to pan · hover for labels.";

  return (
    <div className={styles.dialogRoot} role="presentation">
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mentions-chart-title"
      >
        <header className={styles.head}>
          <div>
            <h2 id="mentions-chart-title" className={styles.title}>
              Mention frequency
            </h2>
            <p className={styles.lede}>{lede}</p>
          </div>
          <button type="button" className={styles.ghost} onClick={onClose}>
            Close
          </button>
        </header>

        <div
          className={styles.entityTabs}
          role="tablist"
          aria-label="Entity kind"
        >
          {ENTITY_TABS.map((tab) => {
            const selected = entity === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={selected ? styles.entityTabActive : undefined}
                onClick={() => {
                  setEntity(tab.id);
                  setFilter("all");
                  setHover(null);
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className={styles.toolbar}>
          <div className={styles.filters} role="group" aria-label="Mention kind filter">
            {kindFilters.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={filter === id ? styles.filterActive : undefined}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.toolbarMeta}>
            {meta ? (
              <span className={styles.muted}>
                {filtered.length} label{filtered.length === 1 ? "" : "s"} ·{" "}
                {seriesTotal} mentions · {meta.runs} run
                {meta.runs === 1 ? "" : "s"}
              </span>
            ) : null}
            {curveFit ? (
              <span
                className={styles.fitMeta}
                title={
                  curveFit.model === "zipf"
                    ? "Zipf’s law (power-law rank-frequency) — best of Zipf vs exponential by R²"
                    : "Exponential decay — best of Zipf vs exponential by R²"
                }
              >
                {curveFit.model === "zipf" ? "Zipf" : "Exp"} ·{" "}
                {curveFit.equation} · R²=
                {curveFit.r2.toFixed(2)}
              </span>
            ) : null}
            <button
              type="button"
              className={`${styles.ghost} ${styles.ghostSmall}`}
              onClick={resetZoom}
              disabled={n === 0}
            >
              Reset zoom
            </button>
          </div>
        </div>

        {loading ? (
          <p className={`${styles.muted} ${styles.status}`}>
            Loading mention stats…
          </p>
        ) : error ? (
          <p className={`${styles.err} ${styles.status}`}>{error}</p>
        ) : n === 0 ? (
          <p className={`${styles.muted} ${styles.status}`}>
            No harvested mentions yet.
          </p>
        ) : (
          <div className={styles.chartWrap}>
            <svg
              ref={svgRef}
              className={`${styles.chart}${dragging ? ` ${styles.chartDragging}` : ""}`}
              width={PLOT_W}
              height={PLOT_H}
              viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
              role="img"
              aria-label="Bar chart of mention counts by surface form"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => {
                if (!dragging) setHover(null);
              }}
              onWheel={(e: ReactWheelEvent<SVGSVGElement>) => {
                // Handled by non-passive listener; keep React quiet.
                e.preventDefault();
              }}
            >
              {yTicks.map((tick) => {
                const y = PAD.top + INNER_H - (tick / maxCount) * INNER_H;
                return (
                  <g key={tick}>
                    <line
                      x1={PAD.left}
                      x2={PAD.left + INNER_W}
                      y1={y}
                      y2={y}
                      className={styles.grid}
                    />
                    <text
                      x={PAD.left - 8}
                      y={y + 3}
                      className={styles.tick}
                      textAnchor="end"
                    >
                      {tick}
                    </text>
                  </g>
                );
              })}

              <text
                className={styles.axisTitle}
                x={14}
                y={PAD.top + INNER_H / 2}
                transform={`rotate(-90 14 ${PAD.top + INNER_H / 2})`}
                textAnchor="middle"
              >
                Mentions
              </text>

              {visibleRows.map((row) => {
                const y = PAD.top + INNER_H - row.h;
                const merged = (row.members?.length ?? 0) > 1;
                const barClass = [
                  styles.bar,
                  row.kind === "email" ? styles.barEmail : "",
                  row.kind === "website" ? styles.barWebsite : "",
                  row.kind === "phone" ? styles.barPhone : "",
                  merged ? styles.barMerged : "",
                  merged && row.kind === "email" ? styles.barMergedEmail : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const dotClass = [
                  styles.xdot,
                  row.kind === "email" ? styles.xdotEmail : "",
                  row.kind === "website" ? styles.xdotWebsite : "",
                  row.kind === "phone" ? styles.xdotPhone : "",
                  merged ? styles.xdotMerged : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <g key={`${row.label}:${row.i}`}>
                    <rect
                      className={barClass}
                      role="img"
                      aria-label={`${row.label}: ${row.count} mentions`}
                      x={row.x}
                      y={y}
                      width={row.barW}
                      height={Math.max(1, row.h)}
                      onPointerEnter={(e) =>
                        updateHover(
                          row,
                          e.clientX,
                          e.clientY,
                          e.currentTarget.ownerSVGElement!,
                        )
                      }
                      onPointerMove={(e) =>
                        updateHover(
                          row,
                          e.clientX,
                          e.clientY,
                          e.currentTarget.ownerSVGElement!,
                        )
                      }
                      onPointerLeave={() => {
                        if (!dragging) setHover(null);
                      }}
                    />
                    {showLabels ? (
                      <text
                        className={styles.xlabel}
                        x={row.x + row.barW / 2}
                        y={PAD.top + INNER_H + 10}
                        transform={`rotate(-55 ${row.x + row.barW / 2} ${PAD.top + INNER_H + 10})`}
                        textAnchor="end"
                      >
                        {row.label.length > 28
                          ? `${row.label.slice(0, 26)}…`
                          : row.label}
                      </text>
                    ) : (
                      <circle
                        className={dotClass}
                        role="img"
                        aria-label={`${row.label}: ${row.count} mentions`}
                        cx={row.x + row.barW / 2}
                        cy={PAD.top + INNER_H + 10}
                        r={3.5}
                        onPointerEnter={(e) =>
                          updateHover(
                            row,
                            e.clientX,
                            e.clientY,
                            e.currentTarget.ownerSVGElement!,
                          )
                        }
                        onPointerMove={(e) =>
                          updateHover(
                            row,
                            e.clientX,
                            e.clientY,
                            e.currentTarget.ownerSVGElement!,
                          )
                        }
                        onPointerLeave={() => {
                          if (!dragging) setHover(null);
                        }}
                      />
                    )}
                  </g>
                );
              })}

              {curvePath ? (
                <path
                  className={styles.fitCurve}
                  d={curvePath}
                  fill="none"
                  pointerEvents="none"
                  aria-hidden="true"
                />
              ) : null}

              {paretoLines.map((line) => {
                const toneClass =
                  line.tone === "80"
                    ? styles.pareto80
                    : line.tone === "90"
                      ? styles.pareto90
                      : styles.pareto95;
                const labelX = Math.min(PAD.left + INNER_W - 2, line.x + 4);
                return (
                  <g key={line.label} pointerEvents="none" aria-hidden="true">
                    <line
                      className={`${styles.paretoLine} ${toneClass}`}
                      x1={line.x}
                      x2={line.x}
                      y1={PAD.top}
                      y2={PAD.top + INNER_H}
                    />
                    <text
                      className={`${styles.paretoLabel} ${toneClass}`}
                      x={labelX}
                      y={line.labelY}
                      textAnchor="start"
                    >
                      <tspan x={labelX} dy="0">
                        {line.label}
                      </tspan>
                      <tspan x={labelX} dy="1.15em">
                        {line.labelsInShare}
                      </tspan>
                      <tspan x={labelX} dy="1.15em">
                        {line.pctOfLabels.toFixed(1)}%
                      </tspan>
                    </text>
                  </g>
                );
              })}

              <line
                className={styles.axis}
                x1={PAD.left}
                x2={PAD.left + INNER_W}
                y1={PAD.top + INNER_H}
                y2={PAD.top + INNER_H}
              />
              <line
                className={styles.axis}
                x1={PAD.left}
                x2={PAD.left}
                y1={PAD.top}
                y2={PAD.top + INNER_H}
              />
            </svg>

            {hover ? (
              <div
                className={styles.tip}
                style={{
                  left: Math.min(PLOT_W - 220, Math.max(8, hover.x + 12)),
                  top: Math.max(8, hover.y - 48),
                }}
              >
                <strong>{hover.label}</strong>
                <span>
                  {hover.count} mention{hover.count === 1 ? "" : "s"}
                  {hover.members
                    ? ` · max of ${hover.members.length} linked`
                    : ""}{" "}
                  · {hover.kind}
                </span>
                {hover.members ? (
                  <ul className={styles.tipMembers}>
                    {hover.members.map((m) => (
                      <li key={`${m.kind}:${m.label}`}>
                        <span className={styles.mLabel}>
                          {hover.showMemberKinds ? (
                            <span className={styles.mKind}>
                              {MEMBER_KIND_LABEL[m.kind]}
                            </span>
                          ) : null}
                          {m.label}
                        </span>
                        <span className={styles.mCount}>{m.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
