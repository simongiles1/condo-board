/** Server-only catalog of stored people, organizations, equipment, and calendar events for concept links. */

import { isNull } from "drizzle-orm";

import { loadCalendarEvents } from "@/lib/calendar/events";
import {
  isNamelessPerson,
  personDisplayName,
} from "@/lib/contacts/registry-shared";
import { loadContactRegistryPersons } from "@/lib/contacts/registry-load";
import { getDb } from "@/lib/db";
import { equipmentAssets } from "@/lib/db/schema";
import {
  calendarEventConceptAliases,
  isUsableConceptAlias,
  type LinkedConcept,
} from "@/lib/entities/concept-links";
import { loadOrgFingerprintSummaries } from "@/lib/organizations/fingerprint-list";
import { loadActiveOrganizationEntities } from "@/lib/organizations/registry-sync";

function uniqueAliases(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || !isUsableConceptAlias(trimmed)) continue;
    const key = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function personConceptsFromRegistry(
  persons: Awaited<ReturnType<typeof loadContactRegistryPersons>>,
): LinkedConcept[] {
  const out: LinkedConcept[] = [];
  for (const person of persons) {
    if (isNamelessPerson(person)) continue;
    const displayName = personDisplayName(person);
    if (displayName === "Unknown contact") continue;
    const aliases = uniqueAliases([
      displayName,
      [person.firstName, person.lastName].filter(Boolean).join(" "),
      person.firstName,
      ...person.nameAliases,
      ...(person.lastName
        ? person.nameAliases.map((alias) => `${alias} ${person.lastName}`)
        : []),
    ]);
    if (aliases.length === 0) continue;
    out.push({
      id: person.id,
      kind: "person",
      displayName,
      aliases,
      mentionWeight: person.mentionWeight,
      person: {
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.emails[0]?.email ?? null,
        phone: person.phones[0]?.phone ?? null,
        title: person.titles[0]?.title ?? null,
        organizationName: person.currentOrganizationName,
      },
    });
  }
  return out;
}

export async function loadConceptIndex(): Promise<LinkedConcept[]> {
  const db = getDb();
  const [persons, orgEntities, fingerprints, equipmentRows, calendarRows] =
    await Promise.all([
      loadContactRegistryPersons({
        limit: 10000,
        skipVerifiedMentions: true,
      }),
      loadActiveOrganizationEntities(),
      loadOrgFingerprintSummaries({ limit: 2000 }),
      db
        .select({
          id: equipmentAssets.id,
          name: equipmentAssets.name,
          manufacturer: equipmentAssets.manufacturer,
          category: equipmentAssets.category,
          location: equipmentAssets.location,
          kind: equipmentAssets.kind,
          notes: equipmentAssets.notes,
          aliasesJson: equipmentAssets.aliasesJson,
        })
        .from(equipmentAssets)
        .where(isNull(equipmentAssets.canonicalId)),
      loadCalendarEvents(),
    ]);

  const fingerprintByKey = new Map(
    fingerprints.organizations.map((org) => [org.id, org]),
  );
  const orgSeen = new Set<string>();
  const orgConcepts: LinkedConcept[] = [];

  for (const org of orgEntities) {
    const fingerprint = fingerprintByKey.get(org.identityKey);
    orgSeen.add(org.identityKey);
    const name = org.name?.trim() || fingerprint?.name || fingerprint?.displayName || null;
    const aliases = uniqueAliases([
      name,
      fingerprint?.name,
      fingerprint?.displayName,
      ...(fingerprint?.aliases ?? []),
    ]);
    if (aliases.length === 0) continue;
    orgConcepts.push({
      id: org.id,
      kind: "organization",
      displayName: name || fingerprint?.displayName || aliases[0]!,
      aliases,
      mentionWeight: fingerprint?.sourceEmailCount ?? 0,
      organization: {
        name: org.name ?? fingerprint?.name ?? null,
        role: org.organizationRole ?? fingerprint?.organization_role ?? null,
        email: org.email ?? fingerprint?.email ?? null,
        phone: org.phone ?? fingerprint?.phone ?? null,
        website: org.website ?? fingerprint?.website ?? null,
      },
    });
  }

  for (const fingerprint of fingerprints.organizations) {
    if (orgSeen.has(fingerprint.id)) continue;
    const aliases = uniqueAliases([
      fingerprint.name,
      fingerprint.displayName,
      ...fingerprint.aliases,
    ]);
    if (aliases.length === 0) continue;
    orgConcepts.push({
      id: fingerprint.id,
      kind: "organization",
      displayName: fingerprint.displayName,
      aliases,
      mentionWeight: fingerprint.sourceEmailCount,
      organization: {
        name: fingerprint.name,
        role: fingerprint.organization_role,
        email: fingerprint.email,
        phone: fingerprint.phone,
        website: fingerprint.website,
      },
    });
  }

  const equipmentConcepts: LinkedConcept[] = [];
  for (const row of equipmentRows) {
    const aliases = uniqueAliases([
      row.name,
      ...parseJsonStringArray(row.aliasesJson),
    ]);
    if (aliases.length === 0) continue;
    equipmentConcepts.push({
      id: row.id,
      kind: "equipment",
      displayName: row.name,
      aliases,
      equipment: {
        name: row.name,
        manufacturer: row.manufacturer,
        category: row.category,
        location: row.location,
        kind: row.kind,
        notes: row.notes,
      },
    });
  }

  const eventConcepts: LinkedConcept[] = [];
  for (const event of calendarRows) {
    const aliases = uniqueAliases(
      calendarEventConceptAliases(event.title, event.startAt),
    );
    if (aliases.length === 0) continue;
    eventConcepts.push({
      id: event.id,
      kind: "event",
      displayName: event.title,
      aliases,
      event: {
        title: event.title,
        eventType: event.eventType,
        startAt: event.startAt,
        description: event.description,
      },
    });
  }

  return [
    ...personConceptsFromRegistry(persons),
    ...orgConcepts,
    ...equipmentConcepts,
    ...eventConcepts,
  ];
}
