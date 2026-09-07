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
  /** Null when already off-peak. */
  msUntilOffPeak: number | null;
  /** Null when already off-peak. */
  nextOffPeakAtMs: number | null;
};

export function getDeepSeekPricingStatus(atMs = Date.now()): DeepSeekPricingStatus {
  const tier = deepSeekPricingTierAt(atMs);
  if (tier === "off_peak") {
    return { tier, msUntilOffPeak: null, nextOffPeakAtMs: null };
  }

  const date = new Date(atMs);
  const hour = date.getUTCHours();
  const nextOffPeakHour = hour >= 1 && hour < 4 ? 4 : 10;
  const nextOffPeakAtMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    nextOffPeakHour,
    0,
    0,
    0,
  );

  return {
    tier,
    msUntilOffPeak: Math.max(0, nextOffPeakAtMs - atMs),
    nextOffPeakAtMs,
  };
}

export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatUtcHourOnDate(hourUtc: number, dateMs: number): string {
  const date = new Date(dateMs);
  const instant = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hourUtc,
    0,
    0,
    0,
  );
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(instant);
}

function formatLocalHourOnDate(hourUtc: number, dateMs: number): string {
  const date = new Date(dateMs);
  const instant = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hourUtc,
    0,
    0,
    0,
  );
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
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
  const rates = DEEPSEEK_V4_FLASH_OFF_PEAK_RATES;
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
