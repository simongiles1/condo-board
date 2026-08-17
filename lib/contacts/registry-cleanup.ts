/**
 * Repair shared / role-mailbox registry contamination:
 * - rename frankenstein given names using last-name-scoped fingerprint votes
 * - coalesce same-identity duplicate people on a mailbox
 * - rebuild email occupancy windows from fingerprint evidence dates
 */

import { eq, inArray, sql } from "drizzle-orm";

import {
  coalesceWeakEmailDuplicatePersons,
  mergePersons,
  refreshEmailIndex,
} from "@/lib/contacts/registry-apply";
import {
  givenNamesConflict,
  isGivenNameInitialExpansion,
  isGivenNameSpellingVariant,
  isNamelessPerson,
  isSamePersonFullName,
  isWeakNameVariantOf,
  lastNamesCompatible,
  normalizeContactRegistryEmail,
  normalizeGivenNameToken,
  preferCompatibleLastName,
  preferPersonGivenName,
  titleCaseGivenName,
} from "@/lib/contacts/registry-shared";
import { getDb } from "@/lib/db";
import {
  contactFingerprintMerges,
  contactHighlightExtractions,
  contactPersonEmails,
  contactPersons,
  emails,
} from "@/lib/db/schema";

type EntityCardLike = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

export type SharedMailboxCleanupReport = {
  dryRun: boolean;
  emailsConsidered: number;
  namesRepaired: number;
  duplicatesMerged: number;
  occupancyRowsUpdated: number;
  openRangesClosed: number;
  details: string[];
};

function parseEntityCardsJson(raw: string | null | undefined): EntityCardLike[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as EntityCardLike[];
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { entity_cards?: unknown }).entity_cards)
    ) {
      return (parsed as { entity_cards: EntityCardLike[] }).entity_cards;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function parseEmailIdsJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && !!v);
  } catch {
    return [];
  }
}

function lastNameFamily(last: string | null | undefined): string {
  const raw = last?.trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  if (!raw) return "";
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function identityKey(
  first: string | null | undefined,
  last: string | null | undefined,
): string | null {
  const f = first?.trim() ? normalizeGivenNameToken(first) : "";
  const l = lastNameFamily(last);
  if (!f && !l) return null;
  return `${f}|${l}`;
}

type EvidenceIdentity = {
  key: string;
  firstName: string;
  lastName: string;
  count: number;
  dateMin: string | null;
  dateMax: string | null;
  dates: string[];
};

type PersonRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  mentionWeight: number;
};

function identitiesCompatible(
  a: { firstName: string | null; lastName: string | null },
  b: { firstName: string | null; lastName: string | null },
): boolean {
  const af = a.firstName?.trim() || null;
  const bf = b.firstName?.trim() || null;
  const al = a.lastName?.trim() || null;
  const bl = b.lastName?.trim() || null;

  if (af && bf) {
    if (
      normalizeGivenNameToken(af) !== normalizeGivenNameToken(bf) &&
      !isGivenNameSpellingVariant(af, bf) &&
      !isGivenNameInitialExpansion(af, bf)
    ) {
      return false;
    }
  }
  if (al && bl && !lastNamesCompatible(al, bl)) return false;
  // Need at least one strong anchor
  if (!af && !al) return false;
  if (!bf && !bl) return false;
  return true;
}

function pickGroupSurvivor(persons: PersonRow[]): PersonRow {
  return [...persons].sort((a, b) => {
    const score = (p: PersonRow) => {
      const first = p.firstName?.trim();
      const last = p.lastName?.trim();
      if (first && last && last.length > 1) return 3;
      if (first && last) return 2;
      if (first || last) return 1;
      return 0;
    };
    const as = score(a);
    const bs = score(b);
    if (bs !== as) return bs - as;
    const aLast = a.lastName?.trim().length ?? 0;
    const bLast = b.lastName?.trim().length ?? 0;
    if (bLast !== aLast) return bLast - aLast;
    return b.mentionWeight - a.mentionWeight;
  })[0]!;
}

/** Prefer the densest contiguous observation cluster when dates span years. */
function densestDateRange(dates: string[]): {
  dateMin: string | null;
  dateMax: string | null;
} {
  const sorted = [...dates].filter(Boolean).sort();
  if (sorted.length === 0) return { dateMin: null, dateMax: null };
  // Small samples: keep full observed range (avoid chopping Margot 2018→2021).
  if (sorted.length < 30) {
    return { dateMin: sorted[0]!, dateMax: sorted[sorted.length - 1]! };
  }

  const spanMs =
    Date.parse(sorted[sorted.length - 1]!) - Date.parse(sorted[0]!);
  if (!(spanMs > 180 * 24 * 60 * 60 * 1000)) {
    return { dateMin: sorted[0]!, dateMax: sorted[sorted.length - 1]! };
  }

  const gapIdx: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = Date.parse(sorted[i]!) - Date.parse(sorted[i - 1]!);
    if (gap > 90 * 24 * 60 * 60 * 1000) gapIdx.push(i);
  }
  if (gapIdx.length === 0) {
    return { dateMin: sorted[0]!, dateMax: sorted[sorted.length - 1]! };
  }

  const cuts = [0, ...gapIdx, sorted.length];
  let bestStart = 0;
  let bestEnd = sorted.length;
  let bestCount = -1;
  for (let c = 0; c < cuts.length - 1; c++) {
    const start = cuts[c]!;
    const end = cuts[c + 1]!;
    const count = end - start;
    if (count > bestCount || (count === bestCount && start > bestStart)) {
      bestCount = count;
      bestStart = start;
      bestEnd = end;
    }
  }

  // Only discard an early prefix when it looks like a minority outlier cluster
  // (bad early "Haider" labels). Keep full range when early evidence is
  // substantial (real early "Margot" years).
  const prefixCount = bestStart;
  const suffixCount = sorted.length - bestEnd;
  const outlierPrefix =
    prefixCount > 0 &&
    prefixCount < Math.max(8, Math.floor(sorted.length * 0.25));
  const outlierSuffix =
    suffixCount > 0 &&
    suffixCount < Math.max(8, Math.floor(sorted.length * 0.25));
  const dateMin = outlierPrefix ? sorted[bestStart]! : sorted[0]!;
  const dateMax = outlierSuffix
    ? sorted[bestEnd - 1]!
    : sorted[sorted.length - 1]!;
  return { dateMin, dateMax };
}

/**
 * Load shared-mailbox occupancy evidence.
 * Prefer per-email third-pass card dates; fingerprint merges add name counts
 * and only contribute dates when a merge has a single named identity on that
 * mailbox (avoids thread-wide Margot/Atif/Mehal/Haider contamination).
 */
async function loadEvidenceByEmail(params?: {
  emailFilter?: string | null;
}): Promise<Map<string, EvidenceIdentity[]>> {
  const db = getDb();
  const filter = params?.emailFilter
    ? normalizeContactRegistryEmail(params.emailFilter)
    : null;

  const byEmail = new Map<string, Map<string, EvidenceIdentity>>();

  function note(args: {
    email: string;
    first: string | null;
    last: string | null;
    dateMin: string | null;
    dateMax: string | null;
    count?: number;
    applyDates: boolean;
  }) {
    const key = identityKey(args.first, args.last);
    if (!key) return;
    const perEmail = byEmail.get(args.email) ?? new Map();
    const prev = perEmail.get(key);
    const count = args.count ?? 1;
    if (!prev) {
      const dates: string[] = [];
      if (args.applyDates) {
        if (args.dateMin) dates.push(args.dateMin);
        if (args.dateMax && args.dateMax !== args.dateMin) {
          dates.push(args.dateMax);
        }
      }
      perEmail.set(key, {
        key,
        firstName: args.first ? titleCaseGivenName(args.first) : "",
        lastName: args.last ?? "",
        count,
        dateMin: null,
        dateMax: null,
        dates,
      });
    } else {
      prev.count += count;
      if (!prev.dates) prev.dates = [];
      if (args.first) {
        prev.firstName =
          preferPersonGivenName(prev.firstName || null, args.first, [
            args.email,
          ]) ?? prev.firstName;
      }
      if (args.last) {
        prev.lastName =
          preferCompatibleLastName(prev.lastName || null, args.last) ??
          prev.lastName;
      }
      if (args.applyDates) {
        if (args.dateMin) prev.dates.push(args.dateMin);
        if (args.dateMax && args.dateMax !== args.dateMin) {
          prev.dates.push(args.dateMax);
        }
      }
    }
    byEmail.set(args.email, perEmail);
  }

  const datesByEmailId = new Map<string, string>();
  const chunkSize = 500;

  async function loadDates(ids: string[]) {
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize).filter((id) => !datesByEmailId.has(id));
      if (chunk.length === 0) continue;
      const rows = await db
        .select({ id: emails.id, receivedAt: emails.receivedAt })
        .from(emails)
        .where(inArray(emails.id, chunk));
      for (const row of rows) {
        if (row.receivedAt) datesByEmailId.set(row.id, row.receivedAt);
      }
    }
  }

  const thirdRows = await db
    .select({
      emailId: contactHighlightExtractions.emailId,
      thirdPassExtractionJson:
        contactHighlightExtractions.thirdPassExtractionJson,
    })
    .from(contactHighlightExtractions)
    .where(
      filter
        ? sql`${contactHighlightExtractions.thirdPassExtractionJson} ILIKE ${"%" + filter + "%"}`
        : sql`${contactHighlightExtractions.thirdPassExtractionJson} IS NOT NULL`,
    );

  await loadDates([...new Set(thirdRows.map((r) => r.emailId).filter(Boolean))]);

  for (const row of thirdRows) {
    const receivedAt = datesByEmailId.get(row.emailId) ?? null;
    for (const card of parseEntityCardsJson(row.thirdPassExtractionJson)) {
      const email = normalizeContactRegistryEmail(card.email ?? '');
      if (!email) continue;
      if (filter && email !== filter) continue;
      const first = card.first_name?.trim() || null;
      const last = card.last_name?.trim() || null;
      if (!first && !last) continue;
      note({
        email,
        first,
        last,
        dateMin: receivedAt,
        dateMax: receivedAt,
        applyDates: Boolean(receivedAt),
      });
    }
  }

  const fpRows = await db
    .select({
      entityCardsJson: contactFingerprintMerges.entityCardsJson,
      emailIdsJson: contactFingerprintMerges.emailIdsJson,
    })
    .from(contactFingerprintMerges)
    .where(
      filter
        ? sql`${contactFingerprintMerges.entityCardsJson} ILIKE ${"%" + filter + "%"}`
        : sql`${contactFingerprintMerges.entityCardsJson} ILIKE ${"%@%"}`,
    );

  const parsedMerges: Array<{ cards: EntityCardLike[]; emailIds: string[] }> = [];
  const fpEmailIds = new Set<string>();
  for (const row of fpRows) {
    const cards = parseEntityCardsJson(row.entityCardsJson);
    const emailIds = parseEmailIdsJson(row.emailIdsJson);
    if (cards.length === 0 || emailIds.length === 0) continue;
    parsedMerges.push({ cards, emailIds });
    for (const id of emailIds) fpEmailIds.add(id);
  }
  await loadDates([...fpEmailIds]);

  for (const merge of parsedMerges) {
    const dates = merge.emailIds
      .map((id) => datesByEmailId.get(id))
      .filter((d): d is string => !!d)
      .sort();
    const dateMin = dates[0] ?? null;
    const dateMax = dates[dates.length - 1] ?? null;

    const byMailbox = new Map<string, EntityCardLike[]>();
    for (const card of merge.cards) {
      const email = normalizeContactRegistryEmail(card.email ?? '');
      if (!email) continue;
      if (filter && email !== filter) continue;
      const list = byMailbox.get(email) ?? [];
      list.push(card);
      byMailbox.set(email, list);
    }

    for (const [email, cards] of byMailbox) {
      const named = cards.filter(
        (c) => c.first_name?.trim() || c.last_name?.trim(),
      );
      const keys = new Set(
        named
          .map((c) => identityKey(c.first_name, c.last_name))
          .filter((k): k is string => !!k),
      );
      const applyDates = keys.size <= 1;
      for (const card of named) {
        note({
          email,
          first: card.first_name?.trim() || null,
          last: card.last_name?.trim() || null,
          dateMin,
          dateMax,
          applyDates,
        });
      }
    }
  }

  const out = new Map<string, EvidenceIdentity[]>();
  for (const [email, map] of byEmail) {
    const list = [...map.values()].map((id) => {
      const range = densestDateRange(id.dates ?? []);
      return {
        ...id,
        dateMin: range.dateMin,
        dateMax: range.dateMax,
        dates: [] as string[],
      };
    });
    out.set(
      email,
      list.sort((a, b) => b.count - a.count),
    );
  }
  return out;
}

async function listSharedMailboxEmails(params?: {
  emailFilter?: string | null;
  minOccupants?: number;
}): Promise<string[]> {
  const db = getDb();
  const minOccupants = params?.minOccupants ?? 2;
  const filter = params?.emailFilter
    ? normalizeContactRegistryEmail(params.emailFilter)
    : null;

  const rows = filter
    ? await db
        .select()
        .from(contactPersonEmails)
        .where(eq(contactPersonEmails.email, filter))
    : await db.select().from(contactPersonEmails);

  const byEmail = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = normalizeContactRegistryEmail(row.email);
    const set = byEmail.get(key) ?? new Set();
    set.add(row.personId);
    byEmail.set(key, set);
  }

  return [...byEmail.entries()]
    .filter(([, people]) => people.size >= minOccupants)
    .map(([email]) => email)
    .sort();
}

async function repairNamesFromEvidence(params: {
  evidenceByEmail: Map<string, EvidenceIdentity[]>;
  dryRun: boolean;
  details: string[];
}): Promise<number> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  let repaired = 0;

  for (const [email, identities] of params.evidenceByEmail) {
    if (identities.length === 0) continue;
    const occ = await db
      .select({
        id: contactPersonEmails.id,
        personId: contactPersonEmails.personId,
      })
      .from(contactPersonEmails)
      .where(eq(contactPersonEmails.email, email));
    if (occ.length === 0) continue;

    const personIds = [...new Set(occ.map((r) => r.personId))];
    const persons = await db
      .select({
        id: contactPersons.id,
        firstName: contactPersons.firstName,
        lastName: contactPersons.lastName,
      })
      .from(contactPersons)
      .where(inArray(contactPersons.id, personIds));

    for (const person of persons) {
      const last = person.lastName?.trim() || null;
      const first = person.firstName?.trim() || null;
      if (!last || !first) continue;

      const scoped = identities.filter(
        (id) =>
          id.lastName &&
          lastNamesCompatible(last, id.lastName) &&
          id.firstName,
      );
      if (scoped.length === 0) continue;

      // Majority given name among last-compatible evidence.
      const votes = new Map<string, { name: string; count: number }>();
      for (const id of scoped) {
        const token = normalizeGivenNameToken(id.firstName);
        const prev = votes.get(token);
        votes.set(token, {
          name: id.firstName,
          count: (prev?.count ?? 0) + id.count,
        });
      }
      let best: { name: string; count: number } | null = null;
      for (const v of votes.values()) {
        if (!best || v.count > best.count) best = v;
      }
      if (!best || best.count < 2) continue;

      const currentToken = normalizeGivenNameToken(first);
      const currentCount = votes.get(currentToken)?.count ?? 0;
      if (!givenNamesConflict(first, best.name)) continue;
      if (best.count < Math.max(currentCount * 2, currentCount + 2)) continue;

      const nextFirst = titleCaseGivenName(best.name);
      const nextLast =
        preferCompatibleLastName(
          last,
          scoped.find(
            (s) =>
              normalizeGivenNameToken(s.firstName) ===
              normalizeGivenNameToken(best!.name),
          )?.lastName,
        ) ?? last;

      params.details.push(
        `rename ${person.id}: "${first} ${last}" → "${nextFirst} ${nextLast}" (${email})`,
      );
      repaired += 1;
      if (!params.dryRun) {
        await db
          .update(contactPersons)
          .set({
            firstName: nextFirst,
            lastName: nextLast,
            updatedAt: nowIso,
          })
          .where(eq(contactPersons.id, person.id));
      }
    }
  }

  return repaired;
}

async function coalesceIdentityDuplicates(params: {
  emails: string[];
  dryRun: boolean;
  details: string[];
}): Promise<number> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  let merged = 0;
  const touched: string[] = [];

  function canAbsorb(a: PersonRow, b: PersonRow): boolean {
    // Nameless stubs are handled in a dedicated pass so they don't all
    // collapse into the globally highest-mention person (e.g. Bonnie).
    if (isNamelessPerson(a) || isNamelessPerson(b)) return false;
    if (isSamePersonFullName(a, b)) return true;
    if (isWeakNameVariantOf(a, b) || isWeakNameVariantOf(b, a)) return true;
    if (
      a.lastName?.trim() &&
      b.lastName?.trim() &&
      !lastNamesCompatible(a.lastName, b.lastName)
    ) {
      return false;
    }
    if (
      givenNamesConflict(a.firstName, b.firstName) &&
      !isWeakNameVariantOf(a, b) &&
      !isWeakNameVariantOf(b, a)
    ) {
      return false;
    }
    // Same given (or one missing) + compatible last → same person on shared mailbox.
    return identitiesCompatible(a, b) && Boolean(b.firstName?.trim());
  }

  for (const email of params.emails) {
    const occ = await db
      .select({ personId: contactPersonEmails.personId })
      .from(contactPersonEmails)
      .where(eq(contactPersonEmails.email, email));
    const personIds = [...new Set(occ.map((r) => r.personId))];
    if (personIds.length < 2) continue;

    const persons = await db
      .select({
        id: contactPersons.id,
        firstName: contactPersons.firstName,
        lastName: contactPersons.lastName,
        mentionWeight: contactPersons.mentionWeight,
      })
      .from(contactPersons)
      .where(inArray(contactPersons.id, personIds));
    if (persons.length < 2) continue;

    const clusters: PersonRow[][] = [];
    const used = new Set<string>();
    const ordered = [...persons].sort(
      (a, b) => b.mentionWeight - a.mentionWeight,
    );
    for (const seed of ordered) {
      if (used.has(seed.id)) continue;
      const cluster = [seed];
      used.add(seed.id);
      for (const other of ordered) {
        if (used.has(other.id)) continue;
        if (!canAbsorb(other, seed)) continue;
        cluster.push(other);
        used.add(other.id);
      }
      if (cluster.length > 1) clusters.push(cluster);
    }

    for (const cluster of clusters) {
      const survivor = pickGroupSurvivor(cluster);
      for (const person of cluster) {
        if (person.id === survivor.id) continue;
        params.details.push(
          `merge ${person.id} (${person.firstName ?? ""} ${person.lastName ?? ""}) → ${survivor.id} (${survivor.firstName ?? ""} ${survivor.lastName ?? ""}) on ${email}`,
        );
        merged += 1;
        if (!params.dryRun) {
          await mergePersons({
            survivorId: survivor.id,
            absorbedId: person.id,
            nowIso,
          });
        }
      }
      touched.push(email);
    }
  }

  if (!params.dryRun && touched.length > 0) {
    await refreshEmailIndex([...new Set(touched)], nowIso);
  }

  return merged;
}

async function rebuildOccupancyFromEvidence(params: {
  emails: string[];
  evidenceByEmail: Map<string, EvidenceIdentity[]>;
  dryRun: boolean;
  details: string[];
}): Promise<{ updated: number; closed: number }> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  let updated = 0;
  let closed = 0;

  for (const email of params.emails) {
    const identities = params.evidenceByEmail.get(email) ?? [];
    const occRows = await db
      .select()
      .from(contactPersonEmails)
      .where(eq(contactPersonEmails.email, email));
    if (occRows.length === 0) continue;

    const personIds = [...new Set(occRows.map((r) => r.personId))];
    const persons = await db
      .select({
        id: contactPersons.id,
        firstName: contactPersons.firstName,
        lastName: contactPersons.lastName,
        mentionWeight: contactPersons.mentionWeight,
      })
      .from(contactPersons)
      .where(inArray(contactPersons.id, personIds));
    const personById = new Map(persons.map((p) => [p.id, p]));

    // Match each occupancy row to best evidence identity.
    type Planned = {
      rowId: string;
      personId: string;
      validFrom: string | null;
      validTo: string | null;
      label: string;
      evidenceMax: string | null;
    };
    const planned: Planned[] = [];

    for (const row of occRows) {
      const person = personById.get(row.personId);
      if (!person) continue;

      let best: EvidenceIdentity | null = null;
      let bestScore = -1;
      for (const id of identities) {
        if (
          !identitiesCompatible(
            { firstName: person.firstName, lastName: person.lastName },
            { firstName: id.firstName || null, lastName: id.lastName || null },
          )
        ) {
          continue;
        }
        // Weight observation count highest so a 1-card "J. Kempton" spelling
        // cannot beat 15-card "Kempton" evidence for dates.
        let score = id.count * 10;
        if (
          person.firstName &&
          id.firstName &&
          normalizeGivenNameToken(person.firstName) ===
            normalizeGivenNameToken(id.firstName)
        ) {
          score += 50;
        }
        if (
          person.lastName &&
          id.lastName &&
          lastNameFamily(person.lastName) === lastNameFamily(id.lastName)
        ) {
          score += 20;
        }
        if (score > bestScore) {
          best = id;
          bestScore = score;
        }
      }

      if (best) {
        planned.push({
          rowId: row.id,
          personId: row.personId,
          validFrom: best.dateMin ?? row.validFrom,
          validTo: best.dateMax, // may reopen to null only for current below
          label: `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim(),
          evidenceMax: best.dateMax,
        });
      } else {
        // No named evidence: keep existing from, close open-ended using existing to or leave for succession pass
        planned.push({
          rowId: row.id,
          personId: row.personId,
          validFrom: row.validFrom,
          validTo: row.validTo,
          label: `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() ||
            "(nameless)",
          evidenceMax: row.validTo,
        });
      }
    }

    // Collapse to one planned occupancy per person (after merges there should
    // already be one row; before/during dry-run there may be many).
    const byPerson = new Map<string, Planned>();
    for (const p of planned) {
      const prev = byPerson.get(p.personId);
      if (!prev) {
        byPerson.set(p.personId, { ...p });
        continue;
      }
      const validFrom =
        [prev.validFrom, p.validFrom].filter(Boolean).sort()[0] ?? null;
      const evidenceMax =
        [prev.evidenceMax, p.evidenceMax].filter(Boolean).sort().at(-1) ??
        null;
      const label =
        (prev.label?.length ?? 0) >= (p.label?.length ?? 0)
          ? prev.label
          : p.label;
      byPerson.set(p.personId, {
        rowId: prev.rowId,
        personId: p.personId,
        validFrom,
        validTo: evidenceMax,
        label,
        evidenceMax,
      });
    }
    const collapsed = [...byPerson.values()];

    // Only the latest evidenceMax occupant may stay open-ended.
    let latestMax: string | null = null;
    for (const p of collapsed) {
      if (p.evidenceMax && (!latestMax || p.evidenceMax > latestMax)) {
        latestMax = p.evidenceMax;
      }
    }

    for (const p of collapsed) {
      let validTo = p.validTo;
      if (latestMax && p.evidenceMax === latestMax) {
        validTo = null;
      } else if (validTo == null && p.evidenceMax) {
        validTo = p.evidenceMax;
      } else if (validTo == null && latestMax) {
        validTo = latestMax;
      }
      p.validTo = validTo;

      const existing = occRows.find((r) => r.id === p.rowId)!;
      if (
        existing.validFrom === p.validFrom &&
        existing.validTo === validTo
      ) {
        continue;
      }

      const wasOpen = existing.validTo == null;
      const nowClosed = validTo != null;
      params.details.push(
        `occupancy ${email} / ${p.label}: ${existing.validFrom ?? "∅"}→${existing.validTo ?? "present"} => ${p.validFrom ?? "∅"}→${validTo ?? "present"}`,
      );
      updated += 1;
      if (wasOpen && nowClosed) closed += 1;

      if (!params.dryRun) {
        await db
          .update(contactPersonEmails)
          .set({
            validFrom: p.validFrom,
            validTo,
            updatedAt: nowIso,
          })
          .where(eq(contactPersonEmails.id, p.rowId));

        // Drop extra occupancy rows for the same person+email after collapse.
        for (const row of occRows) {
          if (row.personId !== p.personId || row.id === p.rowId) continue;
          await db
            .delete(contactPersonEmails)
            .where(eq(contactPersonEmails.id, row.id));
        }
      }
    }

    // No succession-close across people: vacation coverage can legitimately
    // interleave, and using the next person's start was truncating real tenures
    // (e.g. Atif Khurshid → 1 day because John Wilson appeared on the mailbox).
  }

  if (!params.dryRun && params.emails.length > 0) {
    await refreshEmailIndex(params.emails, nowIso);
  }

  return { updated, closed };
}

/**
 * Full shared-mailbox cleanup pass.
 */
export async function cleanupSharedMailboxRegistry(params?: {
  dryRun?: boolean;
  emailFilter?: string | null;
}): Promise<SharedMailboxCleanupReport> {
  const dryRun = params?.dryRun === true;
  const details: string[] = [];

  const evidenceByEmail = await loadEvidenceByEmail({
    emailFilter: params?.emailFilter,
  });

  const emailsList = params?.emailFilter
    ? [normalizeContactRegistryEmail(params.emailFilter)]
    : await listSharedMailboxEmails({ minOccupants: 2 });

  // Always include filter email even if only one occupant (still repair dates).
  const emailSet = new Set(emailsList);
  if (params?.emailFilter) {
    emailSet.add(normalizeContactRegistryEmail(params.emailFilter));
  }
  // Also include any email that has evidence identities with 2+ people.
  for (const [email, ids] of evidenceByEmail) {
    if (ids.length >= 2) emailSet.add(email);
  }
  const emailsConsidered = [...emailSet].sort();

  const namesRepaired = await repairNamesFromEvidence({
    evidenceByEmail,
    dryRun,
    details,
  });

  let duplicatesMerged = 0;
  if (!dryRun) {
    // Baseline coalesce (nameless / weak / same full name).
    const base = await coalesceWeakEmailDuplicatePersons();
    duplicatesMerged += base.merged;
    details.push(
      `coalesceWeakEmailDuplicatePersons: merged=${base.merged}, corrected=${base.firstNamesCorrected}`,
    );
  }

  duplicatesMerged += await coalesceIdentityDuplicates({
    emails: emailsConsidered,
    dryRun,
    details,
  });

  // Refresh evidence matching after merges (person ids changed).
  const occupancy = await rebuildOccupancyFromEvidence({
    emails: emailsConsidered,
    evidenceByEmail,
    dryRun,
    details,
  });

  return {
    dryRun,
    emailsConsidered: emailsConsidered.length,
    namesRepaired,
    duplicatesMerged,
    occupancyRowsUpdated: occupancy.updated,
    openRangesClosed: occupancy.closed,
    details,
  };
}
