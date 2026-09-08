/** DeepSeek V4 Flash published USD rates per 1M tokens (non-thinking mode). */

export type DeepSeekPricingTier = "peak" | "off_peak";

export type DeepSeekTokenRates = {
  inputCacheHitPerMillion: number;
  inputCacheMissPerMillion: number;
  outputPerMillion: number;
};

/** Off-peak rates — half of peak. */
export const DEEPSEEK_V4_FLASH_OFF_PEAK_RATES: DeepSeekTokenRates = {
  inputCacheHitPerMillion: 0.007,
  inputCacheMissPerMillion: 0.22,
  outputPerMillion: 0.66,
};

/** Peak rates (Mon–Fri 01:00–04:00 and 06:00–10:00 UTC). */
export const DEEPSEEK_V4_FLASH_PEAK_RATES: DeepSeekTokenRates = {
  inputCacheHitPerMillion: 0.014,
  inputCacheMissPerMillion: 0.44,
  outputPerMillion: 1.32,
};

export function isDeepSeekModelName(modelName: string): boolean {
  return /deepseek/i.test(modelName.trim());
}

/**
 * Peak hours: 01:00–04:00 and 06:00–10:00 UTC, Monday through Friday.
 * All other hours (including weekends) are off-peak.
 */
export function deepSeekPricingTierAt(dateMs: number): DeepSeekPricingTier {
  const date = new Date(dateMs);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return "off_peak";

  const hour = date.getUTCHours();
  const inMorningPeak = hour >= 1 && hour < 4;
  const inDayPeak = hour >= 6 && hour < 10;
  return inMorningPeak || inDayPeak ? "peak" : "off_peak";
}

export function deepSeekRatesForTier(tier: DeepSeekPricingTier): DeepSeekTokenRates {
  return tier === "peak"
    ? DEEPSEEK_V4_FLASH_PEAK_RATES
    : DEEPSEEK_V4_FLASH_OFF_PEAK_RATES;
}

export function deepSeekRatesAt(dateMs: number): DeepSeekTokenRates {
  return deepSeekRatesForTier(deepSeekPricingTierAt(dateMs));
}

export type DeepSeekBillableUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  billedAtMs?: number;
};

export function resolveInputCacheSplit(usage: DeepSeekBillableUsage): {
  cacheHitTokens: number;
  cacheMissTokens: number;
} {
  const inputTokens = Math.max(0, usage.inputTokens);
  const explicitHit = Math.max(0, usage.cacheHitTokens ?? 0);
  const explicitMiss = Math.max(0, usage.cacheMissTokens ?? 0);

  if (explicitHit + explicitMiss > 0) {
    const known = explicitHit + explicitMiss;
    if (known >= inputTokens) {
      return { cacheHitTokens: explicitHit, cacheMissTokens: explicitMiss };
    }
    return {
      cacheHitTokens: explicitHit,
      cacheMissTokens: explicitMiss + (inputTokens - known),
    };
  }

  return { cacheHitTokens: 0, cacheMissTokens: inputTokens };
}

export function estimateDeepSeekCostBreakdown(
  usage: DeepSeekBillableUsage,
  billedAtMs = usage.billedAtMs ?? Date.now(),
): {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  tier: DeepSeekPricingTier;
  rates: DeepSeekTokenRates;
  cacheHitTokens: number;
  cacheMissTokens: number;
} {
  const rates = deepSeekRatesAt(billedAtMs);
  const tier = deepSeekPricingTierAt(billedAtMs);
  const { cacheHitTokens, cacheMissTokens } = resolveInputCacheSplit(usage);
  const outputTokens = Math.max(0, usage.outputTokens);

  const inputCostUsd =
    (cacheHitTokens / 1_000_000) * rates.inputCacheHitPerMillion +
    (cacheMissTokens / 1_000_000) * rates.inputCacheMissPerMillion;
  const outputCostUsd =
    (outputTokens / 1_000_000) * rates.outputPerMillion;

  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
    tier,
    rates,
    cacheHitTokens,
    cacheMissTokens,
  };
}

export function formatDeepSeekPricingTierLabel(tier: DeepSeekPricingTier): string {
  return tier === "peak" ? "Peak" : "Off-peak";
}

/** Peak windows in UTC on weekdays (Mon–Fri). Weekends are always off-peak. */
export const DEEPSEEK_PEAK_WINDOWS_UTC: ReadonlyArray<{
  startHour: number;
  endHour: number;
}> = [
  { startHour: 1, endHour: 4 },
  { startHour: 6, endHour: 10 },
];

export type DeepSeekPricingStatus = {
  tier: DeepSeekPricingTier;
  nextTier: DeepSeekPricingTier;
  msUntilTierChange: number;
  nextTierChangeAtMs: number;
};

export type DeepSeekTimelineSegment = {
  /** Fraction of the local calendar day [0, 1). */
  startFraction: number;
  endFraction: number;
  tier: DeepSeekPricingTier;
};

export type DeepSeekLocalDayTimeline = {
  segments: DeepSeekTimelineSegment[];
  /** Fraction of the local calendar day where `atMs` falls. */
  nowFraction: number;
  /** True when every segment in the local day is off-peak. */
  isAllOffPeakDay: boolean;
};

function collectTierTransitionInstants(startMs: number, endMs: number): number[] {
  const instants = new Set<number>([startMs, endMs]);

  const dayCursor = new Date(startMs);
  dayCursor.setUTCHours(0, 0, 0, 0);
  const lastUtcDay = new Date(endMs);
  lastUtcDay.setUTCHours(0, 0, 0, 0);

  while (dayCursor.getTime() <= lastUtcDay.getTime() + 24 * 60 * 60 * 1000) {
    const utcDayStart = dayCursor.getTime();
    if (utcDayStart > startMs && utcDayStart < endMs) {
      instants.add(utcDayStart);
    }

    for (const { startHour, endHour } of DEEPSEEK_PEAK_WINDOWS_UTC) {
      const peakStart = utcDayStart + startHour * 60 * 60 * 1000;
      const peakEnd = utcDayStart + endHour * 60 * 60 * 1000;
      if (peakStart > startMs && peakStart < endMs) instants.add(peakStart);
      if (peakEnd > startMs && peakEnd < endMs) instants.add(peakEnd);
    }

    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
  }

  return [...instants].sort((a, b) => a - b);
}

function getNextTierChangeAt(atMs: number): { nextTier: DeepSeekPricingTier; atMs: number } {
  const currentTier = deepSeekPricingTierAt(atMs);
  const horizonMs = atMs + 8 * 24 * 60 * 60 * 1000;
  const candidates = collectTierTransitionInstants(atMs, horizonMs).filter((instant) => instant > atMs);

  for (const candidate of candidates) {
    const nextTier = deepSeekPricingTierAt(candidate);
    if (nextTier !== currentTier) {
      return { nextTier, atMs: candidate };
    }
  }

  return {
    nextTier: currentTier === "peak" ? "off_peak" : "peak",
    atMs: atMs + 60 * 60 * 1000,
  };
}

export function getDeepSeekPricingStatus(atMs = Date.now()): DeepSeekPricingStatus {
  const tier = deepSeekPricingTierAt(atMs);
  const nextChange = getNextTierChangeAt(atMs);

  return {
    tier,
    nextTier: nextChange.nextTier,
    msUntilTierChange: Math.max(0, nextChange.atMs - atMs),
    nextTierChangeAtMs: nextChange.atMs,
  };
}

export function getDeepSeekLocalDayTimeline(atMs = Date.now()): DeepSeekLocalDayTimeline {
  const date = new Date(atMs);
  const localDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const localDayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0);
  const startMs = localDayStart.getTime();
  const endMs = localDayEnd.getTime();
  const dayMs = endMs - startMs;

  const instants = collectTierTransitionInstants(startMs, endMs);
  const segments: DeepSeekTimelineSegment[] = [];

  for (let index = 0; index < instants.length - 1; index += 1) {
    const segmentStart = instants[index];
    const segmentEnd = instants[index + 1];
    if (segmentEnd <= segmentStart) continue;

    segments.push({
      startFraction: (segmentStart - startMs) / dayMs,
      endFraction: (segmentEnd - startMs) / dayMs,
      tier: deepSeekPricingTierAt(segmentStart + 1),
    });
  }

  const elapsedMs = atMs - startMs;
  const nowFraction = Math.min(1, Math.max(0, elapsedMs / dayMs));
  const isAllOffPeakDay = segments.every((segment) => segment.tier === "off_peak");

  return { segments, nowFraction, isAllOffPeakDay };
}

export function formatDeepSeekTierCountdown(
  status: DeepSeekPricingStatus,
  style: "remaining" | "until" = "remaining",
): string {
  const duration = formatDurationMs(status.msUntilTierChange);
  const currentLabel = formatDeepSeekPricingTierLabel(status.tier).toLowerCase();
  const nextLabel = formatDeepSeekPricingTierLabel(status.nextTier).toLowerCase();

  if (style === "until") {
    return `${duration} until ${nextLabel}`;
  }

  return `${duration} left in ${currentLabel}`;
}

export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function utcInstantOnDate(hourUtc: number, dateMs: number): number {
  const date = new Date(dateMs);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hourUtc,
    0,
    0,
    0,
  );
}

function formatUtcHourOnDate(hourUtc: number, dateMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(utcInstantOnDate(hourUtc, dateMs));
}

function formatLocalHourOnDate(hourUtc: number, dateMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(utcInstantOnDate(hourUtc, dateMs));
}

function formatUtcHourCompact(hourUtc: number, dateMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(utcInstantOnDate(hourUtc, dateMs));
}

function formatLocalHourCompact(hourUtc: number, dateMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(utcInstantOnDate(hourUtc, dateMs));
}

export type DeepSeekPeakWindowRow = {
  utcRange: string;
  localRange: string;
};

export function getDeepSeekPeakWindowRows(atMs = Date.now()): DeepSeekPeakWindowRow[] {
  return DEEPSEEK_PEAK_WINDOWS_UTC.map(({ startHour, endHour }) => ({
    utcRange: `${formatUtcHourCompact(startHour, atMs)}–${formatUtcHourCompact(endHour, atMs)}`,
    localRange: `${formatLocalHourCompact(startHour, atMs)}–${formatLocalHourCompact(endHour, atMs)}`,
  }));
}

export function getLocalTimeZoneShort(atMs = Date.now()): string {
  const part = new Intl.DateTimeFormat(undefined, {
    timeZoneName: "short",
  })
    .formatToParts(atMs)
    .find((segment) => segment.type === "timeZoneName");
  return part?.value ?? "local";
}

export function formatDeepSeekPeakHoursUtc(atMs = Date.now()): string {
  const windows = DEEPSEEK_PEAK_WINDOWS_UTC.map(
    ({ startHour, endHour }) =>
      `${formatUtcHourOnDate(startHour, atMs)}–${formatUtcHourOnDate(endHour, atMs)}`,
  );
  return `${windows.join(" and ")}, Monday–Friday`;
}

export function formatDeepSeekPeakHoursLocal(atMs = Date.now()): string {
  const windows = DEEPSEEK_PEAK_WINDOWS_UTC.map(
    ({ startHour, endHour }) =>
      `${formatLocalHourOnDate(startHour, atMs)}–${formatLocalHourOnDate(endHour, atMs)}`,
  );
  return `${windows.join(" and ")}, Monday–Friday`;
}

export function formatInstantLocal(atMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(atMs);
}

export function formatInstantUtc(atMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(atMs);
}

/** Hypothetical cost if every DeepSeek call ran off-peak at published cache-hit/miss rates. */
export function estimateDeepSeekOffPeakOptimizedBreakdown(usage: {
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
}): {
  inputCacheHitCostUsd: number;
  inputCacheMissCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
} {
  return estimateDeepSeekTierOptimizedBreakdown(
    usage,
    DEEPSEEK_V4_FLASH_OFF_PEAK_RATES,
  );
}

/** Hypothetical cost if every DeepSeek call ran during peak at published cache-hit/miss rates. */
export function estimateDeepSeekPeakOptimizedBreakdown(usage: {
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
}): {
  inputCacheHitCostUsd: number;
  inputCacheMissCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
} {
  return estimateDeepSeekTierOptimizedBreakdown(
    usage,
    DEEPSEEK_V4_FLASH_PEAK_RATES,
  );
}

function estimateDeepSeekTierOptimizedBreakdown(
  usage: {
    cacheHitTokens: number;
    cacheMissTokens: number;
    outputTokens: number;
  },
  rates: DeepSeekTokenRates,
): {
  inputCacheHitCostUsd: number;
  inputCacheMissCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
} {
  const cacheHitTokens = Math.max(0, usage.cacheHitTokens);
  const cacheMissTokens = Math.max(0, usage.cacheMissTokens);
  const outputTokens = Math.max(0, usage.outputTokens);

  const inputCacheHitCostUsd =
    (cacheHitTokens / 1_000_000) * rates.inputCacheHitPerMillion;
  const inputCacheMissCostUsd =
    (cacheMissTokens / 1_000_000) * rates.inputCacheMissPerMillion;
  const outputCostUsd =
    (outputTokens / 1_000_000) * rates.outputPerMillion;

  return {
    inputCacheHitCostUsd,
    inputCacheMissCostUsd,
    outputCostUsd,
    totalCostUsd:
      inputCacheHitCostUsd + inputCacheMissCostUsd + outputCostUsd,
  };
}
