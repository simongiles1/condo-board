"use client";

import {
  formatDeepSeekPricingTierLabel,
  formatDeepSeekTierCountdown,
  formatInstantLocal,
  getDeepSeekLocalDayTimeline,
  getDeepSeekPricingStatus,
  getLocalTimeZoneShort,
  type DeepSeekPricingStatus,
} from "@/lib/deepseek/pricing";

type Props = {
  pricingStatus: DeepSeekPricingStatus;
  atMs?: number;
};

const HOUR_MARKS = [0, 6, 12, 18, 24] as const;

function formatHourMark(hour: number): string {
  if (hour === 0 || hour === 24) return "12a";
  if (hour === 12) return "12p";
  if (hour < 12) return `${hour}a`;
  return `${hour - 12}p`;
}

function formatCurrentLocalTime(atMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(atMs);
}

export function DeepSeekPricingTimeline({ pricingStatus, atMs = Date.now() }: Props) {
  const timeline = getDeepSeekLocalDayTimeline(atMs);
  const localTimeZone = getLocalTimeZoneShort(atMs);
  const inPeak = pricingStatus.tier === "peak";

  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        inPeak
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-teal-200 bg-teal-50 text-teal-950"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold">
          DeepSeek pricing: {formatDeepSeekPricingTierLabel(pricingStatus.tier)}
        </p>
        {inPeak ? (
          <span className="text-xs font-medium uppercase tracking-wide opacity-80">
            2× cost now
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-[13px] opacity-90">Now: {formatCurrentLocalTime(atMs)}</p>

      <div className="mt-3">
        <div className="relative h-3 overflow-hidden rounded-full bg-teal-200/80">
          {timeline.segments.map((segment, index) => {
            const widthPercent = (segment.endFraction - segment.startFraction) * 100;
            const leftPercent = segment.startFraction * 100;
            const isPeak = segment.tier === "peak";

            return (
              <div
                key={`${segment.startFraction}-${segment.endFraction}-${index}`}
                className={`absolute inset-y-0 ${
                  isPeak ? "bg-amber-400" : "bg-teal-300/70"
                }`}
                style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                title={`${formatDeepSeekPricingTierLabel(segment.tier)}`}
              />
            );
          })}

          <div
            className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-slate-900 shadow-sm"
            style={{ left: `${timeline.nowFraction * 100}%` }}
            aria-hidden="true"
          />
          <div
            className="absolute -top-1 z-10 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-white bg-slate-900 shadow"
            style={{ left: `${timeline.nowFraction * 100}%` }}
            aria-hidden="true"
          />
        </div>

        <div className="mt-1.5 flex justify-between text-[10px] font-medium uppercase tracking-wide opacity-70">
          {HOUR_MARKS.map((hour) => (
            <span key={hour}>{formatHourMark(hour)}</span>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-amber-400" />
            Peak (2×)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-teal-300/90" />
            Off-peak
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-slate-900" />
            Now
          </span>
        </div>
      </div>

      <div
        className={`mt-3 border-t pt-3 ${
          inPeak ? "border-amber-200/80" : "border-teal-200/80"
        }`}
      >
        <p className="text-[13px] font-medium">
          {formatDeepSeekTierCountdown(pricingStatus, "remaining")}
        </p>
        <p className="mt-0.5 text-[13px] opacity-90">
          {formatDeepSeekTierCountdown(pricingStatus, "until")} ·{" "}
          {formatInstantLocal(pricingStatus.nextTierChangeAtMs)}
        </p>
        <p className="mt-1 text-[11px] opacity-70">
          Peak windows follow UTC weekdays (Mon–Fri) · shown in {localTimeZone}
        </p>
      </div>
    </div>
  );
}
