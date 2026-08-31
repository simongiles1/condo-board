/**
 * Unique-match helpers for harvest fingerprint → registry id.
 * Keep this file free of DB imports so tests can run without Postgres.
 */

import {
  lastNamesCompatible,
  normalizeGivenNameToken,
} from "@/lib/contacts/person-name";
import { normalizeContactRegistryEmail } from "@/lib/contacts/registry-shared";
import { normalizeOrgName, normalizePhone } from "@/lib/email/entity-dedup";
import { normalizeProjectNameKey } from "@/lib/projects/project-multi-values";
import { yearsMatch } from "@/lib/projects/project-year-range";

export type PersonResolveCandidate = {
  id: string;
  sparseStub: boolean;
  firstName: string | null;
  lastName: string | null;
  emails: string[];
  phonesNormalized: string[];
};

export type OrgResolveCandidate = {
  id: string;
  name: string | null;
};

export type ProjectResolveCandidate = {
  id: string;
  name: string | null;
  aliases: string[];
  yearHint: string | null;
};

function uniqueId(ids: string[]): string | null {
  const unique = [...new Set(ids.filter(Boolean))];
  return unique.length === 1 ? unique[0]! : null;
}

export function pickUniquePersonId(
  candidates: PersonResolveCandidate[],
  hint: {
    email?: string | null;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  },
): string | null {
  const emailKey = hint.email?.trim()
    ? normalizeContactRegistryEmail(hint.email)
    : "";
  if (emailKey) {
    return uniqueId(
      candidates
        .filter((person) =>
          person.emails.some(
            (email) => normalizeContactRegistryEmail(email) === emailKey,
          ),
        )
        .map((person) => person.id),
    );
  }

  const phoneKey = hint.phone?.trim() ? normalizePhone(hint.phone) : "";
  if (phoneKey.length >= 7) {
    return uniqueId(
      candidates
        .filter((person) => person.phonesNormalized.includes(phoneKey))
        .map((person) => person.id),
    );
  }

  const first = hint.firstName?.trim()
    ? normalizeGivenNameToken(hint.firstName)
    : "";
  const last = hint.lastName?.trim() ?? "";
  if (!first || !last) return null;

  return uniqueId(
    candidates
      .filter((person) => {
        if (person.sparseStub) return false;
        const personFirst = person.firstName?.trim()
          ? normalizeGivenNameToken(person.firstName)
          : "";
        if (!personFirst || personFirst !== first) return false;
        return lastNamesCompatible(person.lastName, last);
      })
      .map((person) => person.id),
  );
}

export function pickUniqueOrgId(
  candidates: OrgResolveCandidate[],
  name: string | null | undefined,
): string | null {
  const needle = name?.trim() ? normalizeOrgName(name) : "";
  if (!needle) return null;
  return uniqueId(
    candidates
      .filter((org) => {
        const orgName = org.name?.trim();
        return orgName ? normalizeOrgName(orgName) === needle : false;
      })
      .map((org) => org.id),
  );
}

function projectNameKeys(candidate: ProjectResolveCandidate): string[] {
  const keys = [
    normalizeProjectNameKey(candidate.name),
    ...candidate.aliases.map((alias) => normalizeProjectNameKey(alias)),
  ];
  return keys.filter(Boolean);
}

export function pickUniqueProjectId(
  candidates: ProjectResolveCandidate[],
  hint: { name?: string | null; yearHint?: string | null },
): string | null {
  const nameKey = normalizeProjectNameKey(hint.name);
  if (!nameKey) return null;

  const byName = candidates.filter((project) =>
    projectNameKeys(project).includes(nameKey),
  );
  const year = hint.yearHint?.trim() ?? "";
  const pool = year
    ? byName.filter(
        (project) =>
          !project.yearHint?.trim() || yearsMatch(project.yearHint, year),
      )
    : byName;

  return uniqueId(pool.map((project) => project.id));
}
