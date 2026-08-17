import {
  deadlineExactAnchorKey,
  meetingExactAnchorKey,
  normalizeExactAnchor,
} from "@/lib/email-analysis/calendar-dedup";
import type { EquipmentRole } from "@/lib/email-analysis/schema";
import {
  normalizeEquipmentKind,
  normalizeEquipmentSignificance,
  type EquipmentKind,
  type EquipmentSignificance,
} from "@/lib/equipment/classification";

export type EquipmentAuditMeta = {
  name: string;
  kind: EquipmentKind;
  significance: EquipmentSignificance;
  equipmentRole?: EquipmentRole;
  parentSystem?: string;
  manufacturer?: string;
  category?: string;
};

/** Subset of extraction audit items used by client-side maintenance display. */
export type MaintenanceAuditDisplayItem = {
  fieldKey: string;
  summary: string;
  sourceQuote?: string;
  equipmentMeta?: EquipmentAuditMeta;
};

export type CalendarAuditDisplayItem = {
  fieldKey: string;
  summary: string;
  sourceQuote?: string;
};

const SUMMARY_DATE_PATTERN = /^(.+?)\s+\((\d{4}-\d{2}-\d{2})\)$/;

function parseSummaryDate(summary: string): { text: string; date?: string } {
  const match = summary.match(SUMMARY_DATE_PATTERN);
  if (!match) return { text: summary.trim() };
  return { text: match[1].trim(), date: match[2] };
}

function calendarAuditAnchorKey(item: CalendarAuditDisplayItem): string | null {
  const { text, date } = parseSummaryDate(item.summary);
  if (!date) return null;

  if (item.fieldKey === "deadlines") {
    return deadlineExactAnchorKey({
      description: text,
      date,
      source_quote: item.sourceQuote,
    });
  }

  if (item.fieldKey === "meetings") {
    const type = text.replace(/\s+meeting$/i, "").trim();
    return meetingExactAnchorKey({
      type: type || undefined,
      date,
      source_quote: item.sourceQuote,
    });
  }

  return `${item.fieldKey}|${normalizeExactAnchor(item.summary) ?? item.summary.toLowerCase()}`;
}

function pickPreferredCalendarItem<T extends CalendarAuditDisplayItem>(
  existing: T,
  incoming: T,
): T {
  const existingText = parseSummaryDate(existing.summary).text;
  const incomingText = parseSummaryDate(incoming.summary).text;
  const preferred =
    incomingText.length > existingText.length ? incoming.summary : existing.summary;

  return {
    ...existing,
    summary: preferred,
    sourceQuote: existing.sourceQuote ?? incoming.sourceQuote,
  };
}

/** Tier-1 exact-anchor dedup for calendar audit rows when reconciled DB rows are unavailable. */
export function prepareCalendarAuditItems<T extends CalendarAuditDisplayItem>(
  items: T[],
): T[] {
  const result: T[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    if (
      item.fieldKey !== "deadlines" &&
      item.fieldKey !== "meetings" &&
      item.fieldKey !== "meeting_cancellations" &&
      item.fieldKey !== "meeting_reschedules"
    ) {
      result.push(item);
      continue;
    }

    const key = calendarAuditAnchorKey(item);
    if (!key) {
      result.push(item);
      continue;
    }

    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push(item);
      continue;
    }

    result[existingIndex] = pickPreferredCalendarItem(result[existingIndex], item);
  }

  return result;
}

const EQUIPMENT_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "set",
  "complete",
  "system",
  "package",
  "skid",
  "mounted",
  "pumping",
  "related",
  "including",
  "accordance",
  "existing",
]);

function equipmentTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !EQUIPMENT_STOP_WORDS.has(word)),
  );
}

function isAliasEquipmentName(shorter: string, longer: string): boolean {
  const shortTokens = equipmentTokens(shorter);
  const longTokens = equipmentTokens(longer);
  if (shortTokens.size === 0 || longTokens.size === 0) return false;

  for (const token of shortTokens) {
    if (!longTokens.has(token)) return false;
  }

  return shorter.trim().length < longer.trim().length;
}

function looksLikeBidModelName(name: string): boolean {
  return (
    /\b\d+\s*hp\b/i.test(name) ||
    /\b(model|series|skid)\b/i.test(name) ||
    /^[A-Z0-9][A-Z0-9\s./-]{6,}$/.test(name.trim())
  );
}

function isBidAlternative(meta: EquipmentAuditMeta): boolean {
  return (
    meta.equipmentRole === "bid_alternative" ||
    meta.category?.trim().toLowerCase() === "bid alternative" ||
    Boolean(meta.manufacturer && looksLikeBidModelName(meta.name))
  );
}

function isInstalledSystem(meta: EquipmentAuditMeta): boolean {
  if (isBidAlternative(meta)) return false;
  if (meta.equipmentRole === "installed_system") return true;
  return meta.kind === "equipment" && meta.significance === "major";
}

function parseLegacyEquipmentMeta(
  item: MaintenanceAuditDisplayItem,
): EquipmentAuditMeta | null {
  if (item.fieldKey !== "equipment_mentions") return null;

  const legacyMatch = item.summary.match(/^(.+?)\s+\((\w+)\/(\w+)(?:,\s*(.+))?\)$/);
  if (!legacyMatch) {
    return {
      name: item.summary,
      kind: "equipment",
      significance: "major",
    };
  }

  const [, name, kindRaw, significanceRaw, trailingTag] = legacyMatch;
  const kind = normalizeEquipmentKind(kindRaw);
  if (kind === "manufacturer") return null;

  const significance = normalizeEquipmentSignificance(significanceRaw);
  const trailing = trailingTag?.trim();

  return {
    name: name.trim(),
    kind,
    significance,
    manufacturer:
      kind === "equipment" && trailing && !trailing.includes("/")
        ? trailing
        : undefined,
  };
}

export function resolveEquipmentAuditMeta(
  item: MaintenanceAuditDisplayItem,
): EquipmentAuditMeta | null {
  if (item.fieldKey !== "equipment_mentions") return null;
  if (item.equipmentMeta) return item.equipmentMeta;
  return parseLegacyEquipmentMeta(item);
}

function equipmentAuditDedupKey(item: MaintenanceAuditDisplayItem): string | null {
  const meta = resolveEquipmentAuditMeta(item);
  if (!meta) return null;
  return `${meta.name.toLowerCase()}|${meta.kind}|${meta.significance}|${meta.equipmentRole ?? ""}`;
}

function mergeAliasEquipmentItems<T extends MaintenanceAuditDisplayItem>(
  items: T[],
): T[] {
  const equipmentItems = items.filter((item) => item.fieldKey === "equipment_mentions");
  const otherItems = items.filter((item) => item.fieldKey !== "equipment_mentions");

  const resolved = equipmentItems
    .map((item) => ({ item, meta: resolveEquipmentAuditMeta(item) }))
    .filter(
      (entry): entry is { item: T; meta: EquipmentAuditMeta } => entry.meta != null,
    );

  resolved.sort((a, b) => b.meta.name.length - a.meta.name.length);

  const kept: Array<{ item: T; meta: EquipmentAuditMeta }> = [];
  for (const candidate of resolved) {
    if (isBidAlternative(candidate.meta)) {
      kept.push(candidate);
      continue;
    }

    const duplicate = kept.some((existing) => {
      if (isBidAlternative(existing.meta)) return false;
      if (existing.meta.name.trim().toLowerCase() === candidate.meta.name.trim().toLowerCase()) {
        return true;
      }
      return (
        isAliasEquipmentName(candidate.meta.name, existing.meta.name) ||
        isAliasEquipmentName(existing.meta.name, candidate.meta.name)
      );
    });

    if (!duplicate) kept.push(candidate);
  }

  return [...otherItems, ...kept.map((entry) => entry.item)];
}

/** Filters manufacturer rows and dedupes equipment mentions for panel display. */
export function prepareMaintenanceAuditItems<T extends MaintenanceAuditDisplayItem>(
  items: T[],
): T[] {
  const seenEquipment = new Set<string>();
  const seenEvents = new Set<string>();
  const prepared: T[] = [];

  for (const item of items) {
    if (item.fieldKey === "equipment_mentions") {
      const meta = resolveEquipmentAuditMeta(item);
      if (!meta) continue;

      const key = equipmentAuditDedupKey(item);
      if (!key || seenEquipment.has(key)) continue;
      seenEquipment.add(key);

      prepared.push({
        ...item,
        summary: meta.name,
        equipmentMeta: meta,
      });
      continue;
    }

    if (item.fieldKey === "maintenance_events") {
      const key = item.summary.toLowerCase();
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
    }

    prepared.push(item);
  }

  return mergeAliasEquipmentItems(prepared);
}

export function isMaintenanceInstalledSystemItem(
  item: MaintenanceAuditDisplayItem,
): boolean {
  const meta = resolveEquipmentAuditMeta(item);
  return item.fieldKey === "equipment_mentions" && meta != null && isInstalledSystem(meta);
}

export function isMaintenanceBidAlternativeItem(
  item: MaintenanceAuditDisplayItem,
): boolean {
  const meta = resolveEquipmentAuditMeta(item);
  return item.fieldKey === "equipment_mentions" && meta != null && isBidAlternative(meta);
}

export function isMaintenanceMinorItem(item: MaintenanceAuditDisplayItem): boolean {
  const meta = resolveEquipmentAuditMeta(item);
  if (item.fieldKey !== "equipment_mentions" || !meta) return false;
  if (isBidAlternative(meta)) return false;
  return (
    meta.kind === "component" ||
    (meta.kind === "equipment" && meta.significance === "minor")
  );
}

export function groupBidAlternativesUnderSystems<T extends MaintenanceAuditDisplayItem>(
  systemItems: T[],
  bidItems: T[],
): Array<{ system: T; bids: T[] }> {
  const grouped = systemItems.map((system) => {
    const systemMeta = resolveEquipmentAuditMeta(system);
    const systemName = systemMeta?.name.trim().toLowerCase() ?? system.summary.trim().toLowerCase();

    const bids = bidItems.filter((bid) => {
      const bidMeta = resolveEquipmentAuditMeta(bid);
      const parent = bidMeta?.parentSystem?.trim().toLowerCase();
      if (parent) {
        return parent === systemName || parent.includes(systemName) || systemName.includes(parent);
      }
      return false;
    });

    return { system, bids };
  });

  const assignedBidKeys = new Set(
    grouped.flatMap((entry) => entry.bids.map((bid) => bid.summary.trim().toLowerCase())),
  );

  const orphanBids = bidItems.filter(
    (bid) => !assignedBidKeys.has(bid.summary.trim().toLowerCase()),
  );

  if (orphanBids.length > 0) {
    if (grouped.length === 1) {
      grouped[0].bids.push(...orphanBids);
    } else {
      grouped.push({
        system: {
          fieldKey: "equipment_mentions",
          summary: "Bid alternatives",
          equipmentMeta: {
            name: "Bid alternatives",
            kind: "equipment",
            significance: "minor",
            equipmentRole: "installed_system",
          },
        } as T,
        bids: orphanBids,
      });
    }
  }

  return grouped;
}
