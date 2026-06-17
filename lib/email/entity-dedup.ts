/** Smart deduplication for extracted named entities (people, orgs, dates, etc.). */

export type EntityLike = {
  type: string;
  value: string;
  context?: string | null;
};

export type DedupedEntity = {
  type: string;
  value: string;
  contexts: string[];
};

const ORG_SUFFIX_PATTERN =
  /\b(ltd\.?|inc\.?|llc|corp\.?|corporation|limited|co\.?)\b/gi;

function fieldString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeOrgName(name: string): string {
  // Strip legal suffixes; `\b` after `ltd\.?` can match before a trailing ".",
  // leaving punctuation that would split "ICC Property Management" vs "… Ltd.".
  const withoutSuffix = name.replace(ORG_SUFFIX_PATTERN, "");
  return normalizeWhitespace(withoutSuffix.replace(/[.,\s]+$/g, "")).toLowerCase();
}

export function normalizePersonName(name: string): string {
  return normalizeWhitespace(name).toLowerCase();
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function normalizeDate(value: string): string {
  return value.trim();
}

function personNamesMatch(a: string, b: string): boolean {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (na === nb) return true;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;

  if (longer.startsWith(`${shorter} `)) return true;

  const shortFirst = shorter.split(/\s+/)[0];
  const longFirst = longer.split(/\s+/)[0];
  if (shortFirst && shortFirst === longFirst) return true;

  return false;
}

function orgNamesMatch(a: string, b: string): boolean {
  const na = normalizeOrgName(a);
  const nb = normalizeOrgName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.startsWith(nb) || nb.startsWith(na);
}

export function entitiesMatch(a: EntityLike, b: EntityLike): boolean {
  if (a.type !== b.type) return false;

  const av = normalizeWhitespace(a.value);
  const bv = normalizeWhitespace(b.value);
  if (!av || !bv) return false;

  switch (a.type) {
    case "person":
      return personNamesMatch(av, bv);
    case "org":
      return orgNamesMatch(av, bv);
    case "phone":
      return normalizePhone(av) === normalizePhone(bv);
    case "date":
      return normalizeDate(av) === normalizeDate(bv);
    default:
      return av.toLowerCase() === bv.toLowerCase();
  }
}

function pickCanonicalValue(type: string, a: string, b: string): string {
  const av = normalizeWhitespace(a);
  const bv = normalizeWhitespace(b);

  if (type === "person" || type === "org") {
    return av.length >= bv.length ? av : bv;
  }

  return av;
}

function mergeContexts(existing: string[], incoming?: string | null): string[] {
  const merged = new Set(existing);
  const context = fieldString(incoming);
  if (context) merged.add(context);
  return [...merged];
}

/** Collapse near-duplicate entities into one row with merged context snippets. */
export function dedupeEntities(entities: EntityLike[]): DedupedEntity[] {
  const result: DedupedEntity[] = [];

  for (const entity of entities) {
    const value = fieldString(entity.value);
    if (!value) continue;

    const type = fieldString(entity.type) ?? "entity";
    const existingIndex = result.findIndex((entry) =>
      entitiesMatch(entry, { type, value }),
    );

    if (existingIndex >= 0) {
      const existing = result[existingIndex];
      result[existingIndex] = {
        type: existing.type,
        value: pickCanonicalValue(type, existing.value, value),
        contexts: mergeContexts(existing.contexts, entity.context),
      };
      continue;
    }

    result.push({
      type,
      value,
      contexts: mergeContexts([], entity.context),
    });
  }

  return result;
}

export function entityDedupKey(entity: EntityLike): string {
  const type = fieldString(entity.type) ?? "entity";
  const value = fieldString(entity.value) ?? "";

  switch (type) {
    case "person":
      return `${type}:${normalizePersonName(value)}`;
    case "org":
      return `${type}:${normalizeOrgName(value)}`;
    case "phone":
      return `${type}:${normalizePhone(value)}`;
    case "date":
      return `${type}:${normalizeDate(value)}`;
    default:
      return `${type}:${value.toLowerCase()}`;
  }
}

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: "People",
  org: "Organizations",
  unit: "Units",
  date: "Dates",
  phone: "Phone numbers",
  amount: "Amounts",
};

export function entityTypeLabel(type: string): string {
  return ENTITY_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

export function entityTypeBadgeClass(type: string): string {
  switch (type) {
    case "person":
      return "bg-sky-50 text-sky-800 ring-sky-200";
    case "org":
      return "bg-violet-50 text-violet-800 ring-violet-200";
    case "date":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "phone":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "unit":
      return "bg-rose-50 text-rose-800 ring-rose-200";
    case "amount":
      return "bg-lime-50 text-lime-800 ring-lime-200";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}
