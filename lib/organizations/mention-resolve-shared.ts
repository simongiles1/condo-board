/**
 * Organization mention candidate ranking + decision (no DB).
 *
 * Auto-confirm uses this-email signals only:
 *   unique mailbox / website / distinctive name or alias /
 *   unique header domain / unique short alias that is not a prefix collision.
 * Prefix collisions (Trace → Trace Consulting / Fire / Maintenance) stay unresolved.
 */

import { extractMailboxEmail } from "@/lib/email/address-display";
import {
  domainsFromOrgCard,
  mailboxDomain,
  orgMentionNameKey,
  orgWebsiteHost,
} from "@/lib/organizations/mention-shared";
import { canonicalizeOrgNameForFuzzyMatch } from "@/lib/organizations/org-name-fuzzy";
import { splitOrgMultiValue } from "@/lib/organizations/org-multi-values";

export type OrgMentionSearchDocument = {
  id: string;
  name: string | null;
  aliases: string[];
  email: string | null;
  website: string | null;
};

export type OrgMentionResolveDecision = {
  status: "unresolved" | "provisional" | "confirmed";
  organizationId: string | null;
  reason: string;
  candidateOrganizationIds: string[];
};

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function uniqueOrNull(ids: string[]): string | null {
  const unique = uniqueIds(ids);
  return unique.length === 1 ? unique[0]! : null;
}

function orgHasContact(doc: OrgMentionSearchDocument | undefined): boolean {
  return Boolean(doc?.email?.trim() || doc?.website?.trim());
}

/**
 * Fingerprint coalesce can leave two active entity rows with the same legal
 * name (email:… survivor + leftover name:… stub). The registry UI shows one
 * card; mention shortlists must too. Prefer the row that has email/website.
 */
export function collapseOrgIdsByCanonicalName(
  ids: string[],
  documents: readonly OrgMentionSearchDocument[],
): string[] {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const winnerByCanonical = new Map<string, string>();
  for (const id of uniqueIds(ids)) {
    const doc = byId.get(id);
    const canonical = canonicalizeOrgNameForFuzzyMatch(doc?.name) || id;
    const current = winnerByCanonical.get(canonical);
    if (!current) {
      winnerByCanonical.set(canonical, id);
      continue;
    }
    const nextBetter = orgHasContact(doc) && !orgHasContact(byId.get(current));
    if (nextBetter) winnerByCanonical.set(canonical, id);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of uniqueIds(ids)) {
    const doc = byId.get(id);
    const canonical = canonicalizeOrgNameForFuzzyMatch(doc?.name) || id;
    const winner = winnerByCanonical.get(canonical) ?? id;
    if (seen.has(winner)) continue;
    seen.add(winner);
    out.push(winner);
  }
  return out;
}

function mailboxKey(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const mailbox = extractMailboxEmail(value) ?? value.trim();
  const key = mailbox.toLowerCase();
  return key.includes("@") ? key : null;
}

function orgMailboxes(doc: OrgMentionSearchDocument): string[] {
  return splitOrgMultiValue(doc.email)
    .map((value) => mailboxKey(value))
    .filter((value): value is string => Boolean(value));
}

function orgHosts(doc: OrgMentionSearchDocument): string[] {
  return domainsFromOrgCard({ email: doc.email, website: doc.website });
}

export function mentionIsPrefixOfName(
  mentionKey: string,
  name: string | null | undefined,
): boolean {
  const nameKey = orgMentionNameKey(name);
  if (!mentionKey || !nameKey) return false;
  return nameKey === mentionKey || nameKey.startsWith(`${mentionKey} `);
}

export function collectOrgMentionCandidates(
  rawName: string,
  documents: readonly OrgMentionSearchDocument[],
): {
  distinctiveIds: string[];
  exactSurfaceIds: string[];
  prefixIds: string[];
} {
  const mentionKey = orgMentionNameKey(rawName);
  const distinctiveIds: string[] = [];
  const exactSurfaceIds: string[] = [];
  const prefixIds: string[] = [];
  if (!mentionKey) {
    return { distinctiveIds, exactSurfaceIds, prefixIds };
  }

  for (const doc of documents) {
    const primaryKey = orgMentionNameKey(doc.name);
    if (primaryKey === mentionKey) {
      distinctiveIds.push(doc.id);
      exactSurfaceIds.push(doc.id);
    } else if (primaryKey?.startsWith(`${mentionKey} `)) {
      prefixIds.push(doc.id);
    }

    for (const alias of doc.aliases) {
      const aliasKey = orgMentionNameKey(alias);
      if (!aliasKey || aliasKey !== mentionKey) continue;
      // Aliases are surfaces, not distinctive names. Unique short aliases
      // (TCG) confirm via unique_surface_alias; prefix collisions stay open.
      exactSurfaceIds.push(doc.id);
    }
  }

  return {
    distinctiveIds: collapseOrgIdsByCanonicalName(distinctiveIds, documents),
    exactSurfaceIds: collapseOrgIdsByCanonicalName(exactSurfaceIds, documents),
    prefixIds: collapseOrgIdsByCanonicalName(prefixIds, documents),
  };
}

export function decideOrgMentionResolution(params: {
  rawName: string;
  email?: string | null;
  website?: string | null;
  headerDomains: string[];
  affiliatedOrganizationIds: string[];
  documents: readonly OrgMentionSearchDocument[];
}): OrgMentionResolveDecision {
  const mentionMailbox = mailboxKey(params.email);
  const mentionHost = orgWebsiteHost(params.website) ?? mailboxDomain(params.email);
  const headerDomains = new Set(
    params.headerDomains.map((domain) => domain.trim().toLowerCase()).filter(Boolean),
  );

  const mailboxIds: string[] = [];
  const websiteIds: string[] = [];
  const headerIds: string[] = [];
  for (const doc of params.documents) {
    if (mentionMailbox && orgMailboxes(doc).includes(mentionMailbox)) {
      mailboxIds.push(doc.id);
    }
    const hosts = orgHosts(doc);
    if (mentionHost && hosts.includes(mentionHost)) {
      websiteIds.push(doc.id);
    }
    if ([...headerDomains].some((domain) => hosts.includes(domain))) {
      headerIds.push(doc.id);
    }
  }

  const mailboxId = uniqueOrNull(mailboxIds);
  if (mailboxId) {
    return {
      status: "confirmed",
      organizationId: mailboxId,
      reason: "exact_key_email",
      candidateOrganizationIds: [],
    };
  }

  const websiteId = uniqueOrNull(websiteIds);
  if (websiteId) {
    return {
      status: "confirmed",
      organizationId: websiteId,
      reason: "exact_key_website",
      candidateOrganizationIds: [],
    };
  }

  const { distinctiveIds, exactSurfaceIds, prefixIds } =
    collectOrgMentionCandidates(params.rawName, params.documents);

  const distinctiveId = uniqueOrNull(distinctiveIds);
  if (distinctiveId) {
    return {
      status: "confirmed",
      organizationId: distinctiveId,
      reason: "unique_distinctive_name",
      candidateOrganizationIds: [],
    };
  }

  const prefixCollision = prefixIds.length > 1;
  const uniqueExact = uniqueOrNull(exactSurfaceIds);
  if (uniqueExact && !prefixCollision) {
    return {
      status: "confirmed",
      organizationId: uniqueExact,
      reason: "unique_surface_alias",
      candidateOrganizationIds: [],
    };
  }

  const headerId = uniqueOrNull(headerIds);
  if (headerId) {
    return {
      status: "confirmed",
      organizationId: headerId,
      reason: "unique_header_domain",
      candidateOrganizationIds: [],
    };
  }

  const candidates = collapseOrgIdsByCanonicalName(
    [...exactSurfaceIds, ...prefixIds],
    params.documents,
  );
  const affiliated = uniqueIds(
    params.affiliatedOrganizationIds.filter((id) =>
      candidates.length === 0 ? true : candidates.includes(id),
    ),
  );
  const affiliateId = uniqueOrNull(affiliated);
  if (affiliateId) {
    return {
      status: "provisional",
      organizationId: affiliateId,
      reason: "unique_affiliated_contact",
      candidateOrganizationIds: candidates,
    };
  }

  return {
    status: "unresolved",
    organizationId: null,
    reason:
      candidates.length > 1
        ? "ambiguous_surface"
        : candidates.length === 1
          ? "thin_surface"
          : "insufficient",
    candidateOrganizationIds: candidates,
  };
}
