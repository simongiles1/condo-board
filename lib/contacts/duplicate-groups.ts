/**
 * Build contact duplicate clusters for the Entities → Duplicates UI.
 * Groups by shared first name or shared email; no auto-merge decisions.
 */

import {
  normalizeGivenNameToken,
  titleCaseGivenName,
} from "@/lib/contacts/person-name";
import {
  personDisplayName,
  type ContactRegistryPersonSummary,
} from "@/lib/contacts/registry-shared";

export type DuplicateGroupKind = "first_name" | "email";

export type ContactDuplicateGroupMember = ContactRegistryPersonSummary & {
  displayName: string;
  /** True when first+last are both empty (email-only stub). */
  nameless: boolean;
  /** True when first name is set but last name is empty. */
  firstNameOnly: boolean;
};

export type ContactDuplicateGroup = {
  id: string;
  kind: DuplicateGroupKind;
  /** Normalized group key (given-name token or lowercased email). */
  key: string;
  label: string;
  memberCount: number;
  /** Name groups: members with no last name. */
  firstNameOnlyCount: number;
  /** Email groups: members with no first or last name. */
  namelessCount: number;
  members: ContactDuplicateGroupMember[];
};

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function toMember(
  person: ContactRegistryPersonSummary,
): ContactDuplicateGroupMember {
  const first = hasText(person.firstName);
  const last = hasText(person.lastName);
  return {
    ...person,
    displayName: personDisplayName(person),
    nameless: !first && !last,
    firstNameOnly: first && !last,
  };
}

function sortMembers(
  members: ContactDuplicateGroupMember[],
): ContactDuplicateGroupMember[] {
  return [...members].sort((a, b) => {
    // Nameless / first-name-only stubs first — those are the usual merge fodder.
    if (a.nameless !== b.nameless) return a.nameless ? -1 : 1;
    if (a.firstNameOnly !== b.firstNameOnly) return a.firstNameOnly ? -1 : 1;
    const mentionDiff = b.sourceEmailCount - a.sourceEmailCount;
    if (mentionDiff !== 0) return mentionDiff;
    return a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: "base",
    });
  });
}

function pickFirstNameLabel(members: ContactDuplicateGroupMember[]): string {
  const counts = new Map<string, number>();
  for (const member of members) {
    const raw = member.firstName?.trim();
    if (!raw) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = -1;
  for (const [raw, count] of counts) {
    if (count > bestCount) {
      best = raw;
      bestCount = count;
    }
  }
  if (best) return best;
  const key = members[0]?.firstName?.trim();
  return key ? titleCaseGivenName(key) : "Unknown";
}

/**
 * Cluster registry persons into duplicate groups.
 * - first_name: ≥2 persons share the same normalized given name
 * - email: ≥2 persons share the same email address
 * Sorted by memberCount descending, then label.
 */
export function buildContactDuplicateGroups(
  persons: ContactRegistryPersonSummary[],
): ContactDuplicateGroup[] {
  const members = persons.map(toMember);
  const byId = new Map(members.map((m) => [m.id, m]));

  const nameBuckets = new Map<string, Set<string>>();
  for (const member of members) {
    const raw = member.firstName?.trim();
    if (!raw) continue;
    const key = normalizeGivenNameToken(raw);
    if (!key) continue;
    const bucket = nameBuckets.get(key) ?? new Set<string>();
    bucket.add(member.id);
    nameBuckets.set(key, bucket);
  }

  const emailBuckets = new Map<string, Set<string>>();
  for (const member of members) {
    for (const row of member.emails) {
      const email = row.email.trim().toLowerCase();
      if (!email) continue;
      const bucket = emailBuckets.get(email) ?? new Set<string>();
      bucket.add(member.id);
      emailBuckets.set(email, bucket);
    }
  }

  const groups: ContactDuplicateGroup[] = [];

  for (const [key, ids] of nameBuckets) {
    if (ids.size < 2) continue;
    const groupMembers = sortMembers(
      [...ids].map((id) => byId.get(id)!).filter(Boolean),
    );
    groups.push({
      id: `name:${key}`,
      kind: "first_name",
      key,
      label: pickFirstNameLabel(groupMembers),
      memberCount: groupMembers.length,
      firstNameOnlyCount: groupMembers.filter((m) => m.firstNameOnly).length,
      namelessCount: 0,
      members: groupMembers,
    });
  }

  for (const [email, ids] of emailBuckets) {
    if (ids.size < 2) continue;
    const groupMembers = sortMembers(
      [...ids].map((id) => byId.get(id)!).filter(Boolean),
    );
    groups.push({
      id: `email:${email}`,
      kind: "email",
      key: email,
      label: email,
      memberCount: groupMembers.length,
      firstNameOnlyCount: groupMembers.filter((m) => m.firstNameOnly).length,
      namelessCount: groupMembers.filter((m) => m.nameless).length,
      members: groupMembers,
    });
  }

  groups.sort(
    (a, b) =>
      b.memberCount - a.memberCount ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) ||
      a.id.localeCompare(b.id),
  );

  return groups;
}
