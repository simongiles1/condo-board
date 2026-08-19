/** Multi-value contact fields + org name aliases for fingerprint fold/merge. */

/** Internal separator when packing multiple emails/phones/websites into one string. */
export const ORG_MULTI_VALUE_SEP = "\n";

export function splitOrgMultiValue(
  raw: string | null | undefined,
): string[] {
  if (!raw?.trim()) return [];
  const parts = raw
    .split(/[\n|;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  // Also split " · " display joins if any leaked into storage.
  const out: string[] = [];
  for (const part of parts) {
    if (part.includes(" · ")) {
      for (const sub of part.split(" · ")) {
        const trimmed = sub.trim();
        if (trimmed) out.push(trimmed);
      }
    } else if (part.includes(",") && part.includes("@")) {
      // LLM harvest often packs multiple mailboxes into one comma-separated string.
      for (const sub of part.split(",")) {
        const trimmed = sub.trim();
        if (trimmed) out.push(trimmed);
      }
    } else {
      out.push(part);
    }
  }
  return out;
}

export function joinOrgMultiValue(values: string[]): string | null {
  const cleaned = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  return cleaned.length > 0 ? cleaned.join(ORG_MULTI_VALUE_SEP) : null;
}

export function primaryOrgMultiValue(
  raw: string | null | undefined,
): string | null {
  return splitOrgMultiValue(raw)[0] ?? null;
}

function normalizeOrgMultiPart(
  field: "email" | "phone" | "website",
  value: string,
): string {
  const trimmed = value.trim();
  if (field === "email" || field === "website") {
    return trimmed.toLowerCase();
  }
  const digits = trimmed.replace(/\D/g, "");
  return digits || trimmed.toLowerCase();
}

/**
 * Append contact values without overwriting. Dedupes by normalized form while
 * preserving the first-seen display string.
 */
export function mergeOrgMultiValues(
  field: "email" | "phone" | "website",
  ...sources: Array<string | null | undefined>
): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const source of sources) {
    for (const part of splitOrgMultiValue(source)) {
      const key = normalizeOrgMultiPart(field, part);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
  }
  return joinOrgMultiValue(out);
}

export function removeOrgMultiValue(
  field: "email" | "phone" | "website",
  raw: string | null | undefined,
  deniedRaw: string,
): string | null {
  const deniedKey = normalizeOrgMultiPart(field, deniedRaw);
  if (!deniedKey) return joinOrgMultiValue(splitOrgMultiValue(raw));
  const kept = splitOrgMultiValue(raw).filter(
    (part) => normalizeOrgMultiPart(field, part) !== deniedKey,
  );
  return joinOrgMultiValue(kept);
}

export function orgMultiValueContains(
  field: "email" | "phone" | "website",
  raw: string | null | undefined,
  candidate: string,
): boolean {
  const key = normalizeOrgMultiPart(field, candidate);
  if (!key) return false;
  return splitOrgMultiValue(raw).some(
    (part) => normalizeOrgMultiPart(field, part) === key,
  );
}

function normalizeOrgAliasKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Union alias lists; drop blanks and names equal to the primary. */
export function mergeOrgAliasLists(
  primaryName: string | null | undefined,
  ...lists: Array<string[] | null | undefined>
): string[] {
  const primaryKey = normalizeOrgAliasKey(primaryName ?? "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const alias of list) {
      const trimmed = alias.trim();
      if (!trimmed) continue;
      const key = normalizeOrgAliasKey(trimmed);
      if (!key || (primaryKey && key === primaryKey) || seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * When folding two org names, keep `preferred` as the primary name and treat
 * the other distinct name as an alias.
 */
export function foldOrgNames(params: {
  preferredName: string | null;
  otherName: string | null;
  preferredAliases?: string[] | null;
  otherAliases?: string[] | null;
}): { name: string | null; aliases: string[] } {
  const preferred = params.preferredName?.trim() || null;
  const other = params.otherName?.trim() || null;
  const name = preferred || other;
  const aliasFromOther =
    preferred &&
    other &&
    normalizeOrgAliasKey(preferred) !== normalizeOrgAliasKey(other)
      ? [other]
      : [];
  return {
    name,
    aliases: mergeOrgAliasLists(
      name,
      params.preferredAliases,
      params.otherAliases,
      aliasFromOther,
    ),
  };
}
