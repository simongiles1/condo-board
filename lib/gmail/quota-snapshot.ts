/** Client-safe Gmail quota snapshot parsing and display (no Node builtins). */

/** Google docs (updated 2026-05-01): per minute per user per project. */
export const GMAIL_UNITS_PER_USER_PER_MINUTE = 6_000;

export type GmailQuotaMethodRow = {
  method: string;
  calls: number;
  units: number;
};

export type GmailQuotaSnapshot = {
  calls: number;
  units: number;
  durationMs: number;
  peakUnitsIn60s: number;
  limitUnitsPerUserPerMinute: number;
  percentOfLimit: number;
  byMethod: GmailQuotaMethodRow[];
};

export function parseGmailQuotaSnapshot(
  value: unknown,
): GmailQuotaSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<GmailQuotaSnapshot>;
  if (typeof row.calls !== "number" || typeof row.units !== "number") {
    return null;
  }
  const byMethod = Array.isArray(row.byMethod)
    ? row.byMethod.filter(
        (item): item is GmailQuotaMethodRow =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof item.method === "string" &&
          typeof item.calls === "number" &&
          typeof item.units === "number",
      )
    : [];
  const peak =
    typeof row.peakUnitsIn60s === "number" ? row.peakUnitsIn60s : row.units;
  const limit =
    typeof row.limitUnitsPerUserPerMinute === "number"
      ? row.limitUnitsPerUserPerMinute
      : GMAIL_UNITS_PER_USER_PER_MINUTE;
  return {
    calls: row.calls,
    units: row.units,
    durationMs: typeof row.durationMs === "number" ? row.durationMs : 0,
    peakUnitsIn60s: peak,
    limitUnitsPerUserPerMinute: limit,
    percentOfLimit:
      typeof row.percentOfLimit === "number"
        ? row.percentOfLimit
        : Math.round((peak / limit) * 100),
    byMethod,
  };
}

export function formatGmailQuotaDetail(usage: GmailQuotaSnapshot): string {
  const seconds = Math.max(1, Math.round(usage.durationMs / 1000));
  const methods =
    usage.byMethod.length === 0
      ? "no methods recorded"
      : usage.byMethod
          .map(
            (row) =>
              `${row.method} ×${row.calls.toLocaleString()} = ${row.units.toLocaleString()}`,
          )
          .join("; ");
  return `${usage.calls.toLocaleString()} calls · ${usage.units.toLocaleString()} units in ${seconds}s. Peak ${usage.peakUnitsIn60s.toLocaleString()} units in any 60s (${usage.percentOfLimit}% of the ${usage.limitUnitsPerUserPerMinute.toLocaleString()} units/user/min cap). ${methods}.`;
}
