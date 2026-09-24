"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RectangleProps } from "recharts";

import type {
  TimelineBin,
  TimelineMultiBin,
} from "@/lib/email/timeline-bins";
import type {
  EmailTimelineChartLayout,
  EmailTimelineChartSeries,
} from "@/lib/email/timeline-senders";

type ChartRow = TimelineBin & Record<string, string | number>;

/** Full column width for a single stacked bar (grouped uses half per person). */
const STACKED_CATEGORY_BAR_WIDTH = 40;

function groupedBarWidth(seriesCount: number): number {
  const gap = 2;
  const gaps = gap * Math.max(0, seriesCount - 1);
  return Math.max(
    4,
    Math.floor((STACKED_CATEGORY_BAR_WIDTH - gaps) / seriesCount),
  );
}

function isMultiBin(bin: TimelineBin): bin is TimelineMultiBin {
  return "bySenderId" in bin && bin.bySenderId != null;
}

function toChartRows(
  bins: TimelineBin[],
  series: EmailTimelineChartSeries[],
): ChartRow[] {
  return bins.map((bin) => {
    const row: ChartRow = {
      key: bin.key,
      label: bin.label,
      count: bin.count,
    };
    if (isMultiBin(bin)) {
      for (const entry of series) {
        row[entry.id] = bin.bySenderId[entry.id] ?? 0;
      }
    }
    return row;
  });
}

const STACK_TOP_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

/** Topmost series with a positive value in stack order (bottom → top). */
function topStackedSenderId(
  row: ChartRow,
  orderedSeries: EmailTimelineChartSeries[],
): string | null {
  for (let index = orderedSeries.length - 1; index >= 0; index -= 1) {
    const id = orderedSeries[index]!.id;
    if (Number(row[id] ?? 0) > 0) return id;
  }
  return null;
}

function stackedBarShape(
  seriesId: string,
  orderedSeries: EmailTimelineChartSeries[],
) {
  return function StackedBarShape(
    props: RectangleProps & { payload?: ChartRow },
  ) {
    const payload = props.payload;
    const radius =
      payload && topStackedSenderId(payload, orderedSeries) === seriesId
        ? STACK_TOP_RADIUS
        : 0;
    return <Rectangle {...props} radius={radius} />;
  };
}

function formatChartValue(value: number, asAverage: boolean): string {
  if (!asAverage) return String(Math.round(value));
  const rounded = Math.round(value * 10) / 10;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
}

function ChartTooltip({
  active,
  payload,
  series,
  multi,
  valuesAreAverages,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
  series: EmailTimelineChartSeries[];
  multi: boolean;
  valuesAreAverages: boolean;
}) {
  if (!active || !payload?.length) return null;

  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md">
      <div className="font-medium text-slate-900">{row.label}</div>
      {multi ? (
        <ul className="mt-1 space-y-0.5 text-slate-600">
          {series.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: entry.color }}
                aria-hidden
              />
              <span>
                {entry.label}:{" "}
                {formatChartValue(Number(row[entry.id] ?? 0), valuesAreAverages)}
                {valuesAreAverages ? " avg" : ""}
              </span>
            </li>
          ))}
          <li className="border-t border-slate-100 pt-1 text-slate-800">
            {formatChartValue(Number(row.count), valuesAreAverages)}
            {valuesAreAverages
              ? " avg emails"
              : ` email${row.count === 1 ? "" : "s"} total`}
          </li>
        </ul>
      ) : (
        <div className="mt-0.5 text-slate-600">
          {formatChartValue(Number(row.count), valuesAreAverages)}
          {valuesAreAverages
            ? " avg emails"
            : ` email${row.count === 1 ? "" : "s"}`}
        </div>
      )}
    </div>
  );
}

export function EmailTimelineChart({
  bins,
  series = [],
  layout = "stacked",
  valuesAreAverages = false,
}: {
  bins: TimelineBin[];
  series?: EmailTimelineChartSeries[];
  layout?: EmailTimelineChartLayout;
  valuesAreAverages?: boolean;
}) {
  const multi = series.length > 1;
  const data = toChartRows(bins, series);
  const stackId = layout === "stacked" ? "volume" : undefined;
  const grouped = multi && layout === "grouped";
  const perGroupedBarWidth = grouped ? groupedBarWidth(series.length) : undefined;

  const chartTopMargin = multi ? 28 : 8;
  const xAxisHeight = 72;

  return (
    <div className="h-[18.5rem] w-full overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{
            top: chartTopMargin,
            right: 8,
            left: 0,
            bottom: 12,
          }}
          barCategoryGap="5%"
          barGap={grouped ? 2 : 0}
          maxBarSize={STACKED_CATEGORY_BAR_WIDTH}
          barSize={
            multi && layout === "stacked"
              ? STACKED_CATEGORY_BAR_WIDTH
              : undefined
          }
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="#e2e8f0"
          />
          <XAxis
            dataKey="label"
            tick={{ fill: "#64748b", fontSize: 11 }}
            angle={-35}
            textAnchor="end"
            height={xAxisHeight}
            tickMargin={10}
            interval={bins.length > 18 ? Math.floor(bins.length / 12) : 0}
          />
          <YAxis
            allowDecimals={valuesAreAverages}
            tick={{ fill: "#64748b", fontSize: 12 }}
            width={40}
          />
          <Tooltip
            content={
              <ChartTooltip
                series={series}
                multi={multi}
                valuesAreAverages={valuesAreAverages}
              />
            }
            cursor={{ fill: "#f8fafc" }}
          />
          {multi ? (
            <Legend
              verticalAlign="top"
              align="right"
              height={20}
              iconSize={10}
              wrapperStyle={{ fontSize: 11, lineHeight: "1.25rem", top: 0 }}
            />
          ) : null}
          {multi ? (
            series.map((entry) => (
              <Bar
                key={entry.id}
                dataKey={entry.id}
                name={entry.label}
                fill={entry.color}
                stackId={stackId}
                barSize={perGroupedBarWidth}
                shape={
                  layout === "stacked"
                    ? stackedBarShape(entry.id, series)
                    : undefined
                }
                radius={layout === "grouped" ? STACK_TOP_RADIUS : undefined}
              />
            ))
          ) : (
            <Bar
              dataKey="count"
              fill="#0f766e"
              radius={[4, 4, 0, 0]}
              maxBarSize={STACKED_CATEGORY_BAR_WIDTH}
              barSize={STACKED_CATEGORY_BAR_WIDTH}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
