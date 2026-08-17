/**
 * Given-name preference helpers shared by registry apply and fingerprint coalesce.
 * Kept free of registry/fingerprint imports to avoid cycles.
 */

/** Local-part of an email address (lowercase), or "" if missing. */
export function emailLocalPart(email: string | null | undefined): string {
  const trimmed = email?.trim() ?? "";
  if (!trimmed) return "";
  // Support `Name <email>` so header-preserving imports don't poison local-part checks.
  const angle = trimmed.match(/<([^>]+)>/);
  const address = (angle?.[1] ?? trimmed).trim();
  const at = address.indexOf("@");
  if (at <= 0) return "";
  return address.slice(0, at).toLowerCase();
}

/** True when `name` equals a polluted mailbox local-part (not a real given name). */
export function isNameMatchingEmailLocalPart(
  name: string | null | undefined,
  emails: Array<string | null | undefined> = [],
): boolean {
  const needle = name?.trim().toLowerCase() ?? "";
  if (!needle) return false;
  for (const email of emails) {
    const local = emailLocalPart(email);
    if (!local || local !== needle) continue;
    // Structured local-parts stored as a "name" are always pollution
    // (adam.n.johnson@, pgartenburg+board@).
    if (
      local.includes(".") ||
      local.includes("+") ||
      local.includes("_") ||
      /\d/.test(local)
    ) {
      return true;
    }
    // Undotted alphabetic local-part equal to the name is only pollution when
    // it looks like a jammed first+last (pgartenburg@). Plain given-name
    // mailboxes (adam@, john@, michael@, jonathan@) must NOT be rejected —
    // length alone is not enough (michael@ is a real given name).
    if (local.length >= 10) return true;
  }
  return false;
}

/**
 * Heuristic for mailbox local-parts used as given names when no email list
 * is available (e.g. "pgartenburg", "jwilson", "bdossantos").
 * Conservative: all-lowercase, no whitespace, length ≥ 7 or contains a digit.
 */
export function looksLikeMailboxLocalPart(
  name: string | null | undefined,
): boolean {
  const n = name?.trim() ?? "";
  if (!n || /\s/.test(n)) return false;
  if (n !== n.toLowerCase()) return false;
  if (/\d/.test(n)) return true;
  return n.length >= 7;
}

/** Normalize a given-name token for spelling-variant checks (strip trailing dots). */
export function normalizeGivenNameToken(name: string): string {
  return name.trim().toLowerCase().replace(/\.+$/g, "");
}

/**
 * True when two given names are the same stem with different spelling length
 * (Ann/Anne, Rob/Robert, Alex/Alexandre). Requires a stem of at least 2 chars
 * so bare initials (J/John, B/Brian) are not treated as variants.
 * False for unrelated names (Paul/Peter, John/James).
 */
export function isGivenNameSpellingVariant(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = a ? normalizeGivenNameToken(a) : "";
  const right = b ? normalizeGivenNameToken(b) : "";
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];
  // Single-letter / initial stems match almost every name — reject them.
  if (shorter.length < 2) return false;
  return longer.startsWith(shorter);
}

/**
 * True when one side is a single-letter initial of the other (M./Michael,
 * J/John). Used to expand abbreviated registry names when fuller evidence
 * arrives — not for unsupervised cross-person merges on initial alone.
 */
export function isGivenNameInitialExpansion(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = a ? normalizeGivenNameToken(a) : "";
  const right = b ? normalizeGivenNameToken(b) : "";
  if (!left || !right || left === right) return false;
  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length !== 1 || longer.length < 2) return false;
  return longer.startsWith(shorter);
}

/** Levenshtein distance for short given-name tokens. */
export function givenNameEditDistance(a: string, b: string): number {
  const left = normalizeGivenNameToken(a);
  const right = normalizeGivenNameToken(b);
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const rows = left.length + 1;
  const cols = right.length + 1;
  const prev = new Array<number>(cols);
  const cur = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    cur[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j < cols; j++) prev[j] = cur[j] ?? 0;
  }
  return prev[right.length] ?? 0;
}

/**
 * Alias worth keeping for a primary given name: stem expansion (Ann/Anne) or
 * near-typo (Shawnna/Shawna, Lawrence/Lawarence). Rejects unrelated people,
 * bare initials, and glitchy concatenations (JJohn).
 */
export function isAcceptableNameAlias(
  alias: string | null | undefined,
  kept: string | null | undefined,
): boolean {
  const left = alias?.trim() || "";
  const right = kept?.trim() || "";
  if (!left || !right) return false;
  if (normalizeGivenNameToken(left) === normalizeGivenNameToken(right)) {
    return false;
  }
  if (isGivenNameSpellingVariant(left, right)) return true;
  // One-edit typos only for comparable-length tokens (avoid Studio≈Atif noise).
  const a = normalizeGivenNameToken(left);
  const b = normalizeGivenNameToken(right);
  if (a.length < 3 || b.length < 3) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  // Reject "JJohn" / "JohnJohn" style: shorter appears inside longer but not as prefix.
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.includes(shorter) && !longer.startsWith(shorter)) return false;
  return givenNameEditDistance(a, b) <= 1;
}

/**
 * Prefer a real given name over an email local-part (or jammed local-part lookalike).
 * When both look name-like, prefer the longer spelling only if they share a stem
 * (Ann → Anne). Conflicting names (Paul vs Peter) keep the existing value.
 */
export function preferPersonGivenName(
  a: string | null | undefined,
  b: string | null | undefined,
  emails: Array<string | null | undefined> = [],
): string | null {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (!left) return right;
  if (!right) return left;

  const leftLocal = isNameMatchingEmailLocalPart(left, emails);
  const rightLocal = isNameMatchingEmailLocalPart(right, emails);
  if (leftLocal && !rightLocal) return right;
  if (rightLocal && !leftLocal) return left;

  const leftSuspect = looksLikeMailboxLocalPart(left);
  const rightSuspect = looksLikeMailboxLocalPart(right);
  if (leftSuspect && !rightSuspect) return right;
  if (rightSuspect && !leftSuspect) return left;

  if (normalizeGivenNameToken(left) === normalizeGivenNameToken(right)) {
    return right.length >= left.length ? right : left;
  }
  if (isGivenNameSpellingVariant(left, right)) {
    return right.length > left.length ? right : left;
  }
  // Initial → full given name (M. → Michael) when the fuller form shares the
  // same first letter. Prefer the full name either direction.
  if (isGivenNameInitialExpansion(left, right)) {
    return left.length >= right.length ? left : right;
  }
  // Unrelated given names: keep the existing value (do not flip Paul → Peter).
  return left;
}

/** Drop a given name that is just an email local-part. */
export function sanitizeGivenNameAgainstEmails(
  name: string | null | undefined,
  emails: Array<string | null | undefined> = [],
): string | null {
  const trimmed = name?.trim() || null;
  if (!trimmed) return null;
  if (isNameMatchingEmailLocalPart(trimmed, emails)) return null;
  return trimmed;
}

function normalizeLastNameToken(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * True when last names are the same family (Singh/Singh, S→Singh, J. Kempton /
 * Kempton). Unrelated surnames (Kempton vs Khurshid) are incompatible.
 */
export function lastNamesCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (!left || !right) return true;

  const ln = normalizeLastNameToken(left);
  const rn = normalizeLastNameToken(right);
  if (!ln || !rn) return true;
  if (ln === rn) return true;

  const lCompact = ln.replace(/\s+/g, "");
  const rCompact = rn.replace(/\s+/g, "");
  if (lCompact === rCompact) return true;

  // Initial / truncation: "S" → "Singh", "M" → "Mukadam"
  if (ln.length === 1 && rn.startsWith(ln)) return true;
  if (rn.length === 1 && ln.startsWith(rn)) return true;
  if (rn.startsWith(ln) && ln.length < rn.length) return true;
  if (ln.startsWith(rn) && rn.length < ln.length) return true;

  // Middle initial + surname: "j kempton" ends with "kempton"
  const lParts = ln.split(/\s+/);
  const rParts = rn.split(/\s+/);
  if (lParts.length > 1 && rParts.length === 1 && lParts.at(-1) === rn) {
    return true;
  }
  if (rParts.length > 1 && lParts.length === 1 && rParts.at(-1) === ln) {
    return true;
  }

  return false;
}

/**
 * Prefer a richer compatible last name; never replace with an unrelated surname
 * (avoids Atif + Kempton frankenstein merges).
 */
export function preferCompatibleLastName(
  kept: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const left = kept?.trim() || null;
  const right = incoming?.trim() || null;
  if (!left) return right;
  if (!right) return left;
  if (!lastNamesCompatible(left, right)) return left;

  const lNorm = normalizeLastNameToken(left);
  const rNorm = normalizeLastNameToken(right);
  if (rNorm.length > lNorm.length) return right;
  if (lNorm.length > rNorm.length) return left;
  // Same length family: prefer the one with more punctuation/detail (J. Kempton).
  return right.length >= left.length ? right : left;
}

/** True when both sides have real, non-variant given names that disagree. */
export function givenNamesConflict(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (!left || !right) return false;
  if (normalizeGivenNameToken(left) === normalizeGivenNameToken(right)) {
    return false;
  }
  if (isGivenNameSpellingVariant(left, right)) return false;
  if (isGivenNameInitialExpansion(left, right)) return false;
  return true;
}

/**
 * Distinct humans (e.g. Margot Kempton vs Atif Khurshid, Mehal vs Atif Singh).
 * Used to force link_email instead of merge on shared role mailboxes.
 */
export function personIdentitiesConflict(
  a: {
    firstName?: string | null;
    lastName?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  },
  b: {
    firstName?: string | null;
    lastName?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  },
): boolean {
  const af = a.firstName?.trim() || a.first_name?.trim() || null;
  const bf = b.firstName?.trim() || b.first_name?.trim() || null;
  const al = a.lastName?.trim() || a.last_name?.trim() || null;
  const bl = b.lastName?.trim() || b.last_name?.trim() || null;

  if (givenNamesConflict(af, bf)) return true;
  if (al && bl && !lastNamesCompatible(al, bl)) return true;
  return false;
}

export function parseNameAliasesJson(
  raw: string | null | undefined,
): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

export function serializeNameAliasesJson(aliases: string[]): string | null {
  const cleaned = [
    ...new Set(aliases.map((a) => a.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  if (cleaned.length === 0) return null;
  return JSON.stringify(cleaned);
}

export function mergeNameAliasLists(
  ...lists: Array<Iterable<string> | null | undefined>
): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const raw of list) {
      const v = raw?.trim();
      if (v) out.add(v);
    }
  }
  return [...out].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/**
 * Names that lost the prefer/sanitize contest and are worth keeping as aliases.
 * Only stem expansions / near-typos of the kept name (Ann when kept is Anne).
 * Skips email local-parts, jammed local-part lookalikes, bare initials, and
 * unrelated names (Peter/Joseph/Haider when kept is Paul/Atif).
 */
export function collectDiscardedNameAliases(params: {
  kept: string | null;
  candidates: Array<string | null | undefined>;
  emails?: Array<string | null | undefined>;
}): string[] {
  const kept = params.kept?.trim() || null;
  const keptNorm = kept ? normalizeGivenNameToken(kept) : "";
  const emails = params.emails ?? [];
  const out: string[] = [];
  for (const raw of params.candidates) {
    const candidate = raw?.trim() || null;
    if (!candidate) continue;
    if (normalizeGivenNameToken(candidate) === keptNorm) continue;
    if (isNameMatchingEmailLocalPart(candidate, emails)) continue;
    if (looksLikeMailboxLocalPart(candidate)) continue;
    if (!kept || !isAcceptableNameAlias(candidate, kept)) continue;
    out.push(candidate);
  }
  return mergeNameAliasLists(out);
}

/**
 * Union alias lists, drop the primary given name, and drop names that are not
 * acceptable aliases of the primary (clears contaminated Also-known-as rows).
 */
export function finalizeNameAliases(params: {
  kept: string | null;
  lists: Array<Iterable<string> | null | undefined>;
}): string[] {
  const kept = params.kept?.trim() || null;
  const merged = mergeNameAliasLists(...params.lists);
  if (!kept) {
    // No primary — drop bare initials / obvious junk; keep nothing unsafe.
    return merged.filter((alias) => normalizeGivenNameToken(alias).length >= 2);
  }
  const keptNorm = normalizeGivenNameToken(kept);
  return merged.filter((alias) => {
    if (normalizeGivenNameToken(alias) === keptNorm) return false;
    return isAcceptableNameAlias(alias, kept);
  });
}

/** Title-case a simple given name token (shawna → Shawna). */
export function titleCaseGivenName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (/[A-Z]/.test(trimmed) && trimmed !== trimmed.toLowerCase()) {
    return trimmed;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/**
 * When last name is known, recover a given name from dotted local-parts like
 * shawna.greenspan or adam.n.johnson. Never invent from jammed local-parts
 * (pgartenburg).
 */
export function guessFirstNameFromDottedLocalPart(
  email: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const last = lastName?.trim() || null;
  if (!last) return null;
  const local = emailLocalPart(email);
  if (!local || !local.includes(".")) return null;

  const parts = local.split(/[._]+/).filter(Boolean);
  if (parts.length < 2) return null;

  const lastSeg = parts[parts.length - 1]!.toLowerCase();
  const lastNorm = last.toLowerCase().replace(/[^a-z]/g, "");
  const lastSegNorm = lastSeg.replace(/[^a-z]/g, "");
  if (!lastNorm || lastSegNorm !== lastNorm) return null;

  const firstSeg = parts[0]!;
  if (firstSeg.length < 2) return null;
  if (isNameMatchingEmailLocalPart(firstSeg, [email])) return null;
  return titleCaseGivenName(firstSeg);
}
