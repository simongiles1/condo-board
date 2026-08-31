/** Multi-value project fields (contractor, location) + name aliases. */

export const PROJECT_MULTI_VALUE_SEP = "\n";

export function splitProjectMultiValue(
  raw: string | null | undefined,
): string[] {
  if (!raw?.trim()) return [];
  const parts = raw
    .split(/[\n|;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    if (part.includes(" · ")) {
      for (const sub of part.split(" · ")) {
        const trimmed = sub.trim();
        if (trimmed) out.push(trimmed);
      }
    } else {
      out.push(part);
    }
  }
  return out;
}

export function joinProjectMultiValue(values: string[]): string | null {
  const cleaned = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  return cleaned.length > 0 ? cleaned.join(PROJECT_MULTI_VALUE_SEP) : null;
}

export function primaryProjectMultiValue(
  raw: string | null | undefined,
): string | null {
  return splitProjectMultiValue(raw)[0] ?? null;
}

function normalizeProjectMultiPart(value: string): string {
  return value.trim().toLowerCase();
}

export function mergeProjectMultiValues(
  ...sources: Array<string | null | undefined>
): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const source of sources) {
    for (const part of splitProjectMultiValue(source)) {
      const key = normalizeProjectMultiPart(part);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
  }
  return joinProjectMultiValue(out);
}

export function removeProjectMultiValue(
  raw: string | null | undefined,
  deniedRaw: string,
): string | null {
  const deniedKey = normalizeProjectMultiPart(deniedRaw);
  if (!deniedKey) return joinProjectMultiValue(splitProjectMultiValue(raw));
  const kept = splitProjectMultiValue(raw).filter(
    (part) => normalizeProjectMultiPart(part) !== deniedKey,
  );
  return joinProjectMultiValue(kept);
}

export function projectMultiValueContains(
  raw: string | null | undefined,
  candidate: string,
): boolean {
  const key = normalizeProjectMultiPart(candidate);
  if (!key) return false;
  return splitProjectMultiValue(raw).some(
    (part) => normalizeProjectMultiPart(part) === key,
  );
}

export function normalizeProjectNameKey(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export {
  normalizeProjectYearHint,
} from "@/lib/projects/project-year-range";

export function parseProjectAliasesJson(
  raw: string | null | undefined,
): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return mergeProjectAliasLists(
      null,
      parsed.filter((item): item is string => typeof item === "string"),
    );
  } catch {
    return [];
  }
}

export function serializeProjectAliasesJson(aliases: string[]): string {
  return JSON.stringify(mergeProjectAliasLists(null, aliases));
}

export function mergeProjectAliasLists(
  primaryName: string | null | undefined,
  ...lists: Array<string[] | null | undefined>
): string[] {
  const primaryKey = normalizeProjectNameKey(primaryName ?? "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const alias of list) {
      const trimmed = alias.trim();
      if (!trimmed) continue;
      const key = normalizeProjectNameKey(trimmed);
      if (!key || (primaryKey && key === primaryKey) || seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

export function foldProjectNames(params: {
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
    normalizeProjectNameKey(preferred) !== normalizeProjectNameKey(other)
      ? [other]
      : [];
  return {
    name,
    aliases: mergeProjectAliasLists(
      name,
      params.preferredAliases,
      params.otherAliases,
      aliasFromOther,
    ),
  };
}
