/**
 * Client-safe organization mention staging helpers.
 * Mentions are per-email observations; organizations are registry rows.
 */

import type { OrgEntityCard } from "@/lib/email-analysis/org-highlight-shared";
import {
  normalizeOrgNameKey,
  primaryOrgMultiValue,
  splitOrgMultiValue,
} from "@/lib/organizations/org-multi-values";
import { extractMailboxEmail } from "@/lib/email/address-display";
import { findCaseInsensitiveRanges } from "@/lib/organizations/registry-evidence-shared";

export const ORG_MENTION_STATUSES = [
  "unresolved",
  "provisional",
  "confirmed",
] as const;

export type OrgMentionResolutionStatus = (typeof ORG_MENTION_STATUSES)[number];

export type OrgMentionCard = {
  raw_name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
};

export function cardToOrgMentionCard(
  card: OrgEntityCard,
): OrgMentionCard | null {
  const rawName = card.name?.trim() || null;
  if (!rawName) return null;
  return {
    raw_name: rawName,
    email: primaryOrgMultiValue(card.email),
    phone: primaryOrgMultiValue(card.phone),
    website: primaryOrgMultiValue(card.website),
  };
}

export function orgMentionHasIdentity(card: OrgMentionCard): boolean {
  return Boolean(card.raw_name.trim());
}

export function orgMentionNameKey(name: string | null | undefined): string | null {
  const key = normalizeOrgNameKey(name);
  return key || null;
}

/**
 * Painted org needles: pass-1/2 names, pass-3 org card names, and project
 * contractors (those remap to the organization harvest group).
 */
export function collectPaintedOrgMentionSurfaces(params: {
  orgNames?: readonly string[];
  orgCardNames?: readonly (string | null | undefined)[];
  contractors?: readonly string[];
  projectCardContractors?: readonly (string | null | undefined)[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [
    ...(params.orgNames ?? []),
    ...(params.orgCardNames ?? []),
    ...(params.contractors ?? []),
    ...(params.projectCardContractors ?? []),
  ]) {
    const name = raw?.trim() ?? "";
    const key = orgMentionNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Surfaces that do not already have a mention row on this email (by name key). */
export function orgSurfacesMissingMentions(
  surfaces: readonly string[],
  existingNameKeys: readonly (string | null | undefined)[],
): string[] {
  const covered = new Set(
    existingNameKeys
      .map((key) => key?.trim() ?? "")
      .filter(Boolean),
  );
  return collectPaintedOrgMentionSurfaces({ orgNames: [...surfaces] }).filter(
    (name) => {
      const key = orgMentionNameKey(name);
      return Boolean(key) && !covered.has(key!);
    },
  );
}

export type OrgRosterSurface = {
  name: string | null | undefined;
  aliases?: readonly string[] | null;
};

/**
 * True when `surface` is another org’s primary name, a word-prefix of one
 * (Trace vs Trace Fire Group), or an exact alias on a different card.
 * Replaces the old 12-character distinctive-alias gate.
 */
export function orgSurfaceCollidesOnRoster(
  surface: string,
  ownerName: string | null | undefined,
  roster: readonly OrgRosterSurface[],
): boolean {
  const surfaceKey = orgMentionNameKey(surface);
  if (!surfaceKey) return true;
  const ownerKey = orgMentionNameKey(ownerName);
  for (const other of roster) {
    const otherPrimary = orgMentionNameKey(other.name);
    if (!otherPrimary || otherPrimary === ownerKey) continue;
    if (
      otherPrimary === surfaceKey ||
      otherPrimary.startsWith(`${surfaceKey} `)
    ) {
      return true;
    }
    for (const otherAlias of other.aliases ?? []) {
      if (orgMentionNameKey(otherAlias) === surfaceKey) return true;
    }
  }
  return false;
}

/** Stable per-email identity for upsert. Does not include resolution fields. */
export function orgMentionFingerprint(card: OrgMentionCard): string {
  const name = orgMentionNameKey(card.raw_name) ?? "";
  const email = card.email
    ? (extractMailboxEmail(card.email) ?? card.email).trim().toLowerCase()
    : "";
  const website = card.website?.trim().toLowerCase() ?? "";
  const phone = (card.phone ?? "").replace(/\D/g, "");
  return [name, email, website, phone].join("|");
}

export function parseJsonIdList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  } catch {
    return [];
  }
}

export function locateUniqueSurfaceSpan(
  text: string,
  rawName: string,
): { start: number; end: number } | null {
  const ranges = findCaseInsensitiveRanges(text, rawName);
  if (ranges.length !== 1) return null;
  return ranges[0] ?? null;
}

export function orgWebsiteHost(value: string | null | undefined): string | null {
  const raw = value?.trim().toLowerCase();
  if (!raw) return null;
  const withScheme = raw.includes("://") ? raw : `https://${raw}`;
  try {
    const host = new URL(withScheme).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    const host = raw.replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "");
    return host || null;
  }
}

export function mailboxDomain(value: string | null | undefined): string | null {
  const mailbox = value
    ? (extractMailboxEmail(value) ?? value).trim().toLowerCase()
    : "";
  if (!mailbox.includes("@")) return null;
  const domain = mailbox.slice(mailbox.indexOf("@") + 1).replace(/^www\./, "");
  return domain || null;
}

export function domainsFromOrgCard(card: {
  email: string | null;
  website: string | null;
}): string[] {
  const domains = new Set<string>();
  for (const email of splitOrgMultiValue(card.email)) {
    const domain = mailboxDomain(email);
    if (domain) domains.add(domain);
  }
  for (const website of splitOrgMultiValue(card.website)) {
    const host = orgWebsiteHost(website);
    if (host) domains.add(host);
  }
  return [...domains];
}

export type OrgMentionEmailTallyRow = {
  organizationId: string | null;
  nameKey: string | null;
  sourceEmailId: string | null;
};

export type OrgMentionEmailTallies = {
  /** Distinct source emails per resolved organization. */
  byOrganizationId: Map<string, number>;
  /** Distinct source emails per resolved organization + mention nameKey. */
  byOrganizationIdAndNameKey: Map<string, Map<string, number>>;
};

/**
 * Distinct-email tallies for confirmed/provisional mention rows.
 * Org total is a union; alias rows can overlap on the same email.
 */
export function tallyResolvedOrgMentionEmails(
  rows: readonly OrgMentionEmailTallyRow[],
): OrgMentionEmailTallies {
  const emailsByOrg = new Map<string, Set<string>>();
  const emailsByOrgAndKey = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) {
    if (!row.organizationId || !row.sourceEmailId) continue;
    let orgEmails = emailsByOrg.get(row.organizationId);
    if (!orgEmails) {
      orgEmails = new Set();
      emailsByOrg.set(row.organizationId, orgEmails);
    }
    orgEmails.add(row.sourceEmailId);

    const nameKey = row.nameKey?.trim() ?? "";
    if (!nameKey) continue;
    let byKey = emailsByOrgAndKey.get(row.organizationId);
    if (!byKey) {
      byKey = new Map();
      emailsByOrgAndKey.set(row.organizationId, byKey);
    }
    let aliasEmails = byKey.get(nameKey);
    if (!aliasEmails) {
      aliasEmails = new Set();
      byKey.set(nameKey, aliasEmails);
    }
    aliasEmails.add(row.sourceEmailId);
  }

  return {
    byOrganizationId: new Map(
      [...emailsByOrg].map(([id, emails]) => [id, emails.size]),
    ),
    byOrganizationIdAndNameKey: new Map(
      [...emailsByOrgAndKey].map(([id, byKey]) => [
        id,
        new Map([...byKey].map(([key, emails]) => [key, emails.size])),
      ]),
    ),
  };
}

export function mentionEmailCountForAlias(
  countsByNameKey: Record<string, number> | undefined,
  alias: string,
): number {
  const key = orgMentionNameKey(alias);
  if (!key) return 0;
  return countsByNameKey?.[key] ?? 0;
}

export function formatAliasMentionEmailCount(count: number): string {
  if (count <= 0) return "—";
  return `${count} email${count === 1 ? "" : "s"}`;
}
