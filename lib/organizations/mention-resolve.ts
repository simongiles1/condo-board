/**
 * Attach organization_mentions to organization_entities.
 * Confirmed rows are left alone. Does not mint organizations.
 */

import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  contactMentions,
  contactPersons,
  emails,
  organizationEntities,
  organizationMentions,
} from "@/lib/db/schema";
import { extractMailboxEmail, parseStoredFromAddress } from "@/lib/email/address-display";
import {
  invalidateOrgFingerprintSummariesCache,
  loadOrgFingerprintSummaries,
} from "@/lib/organizations/fingerprint-list";
import { mailboxDomain, orgWebsiteHost, parseJsonIdList } from "@/lib/organizations/mention-shared";
import {
  decideOrgMentionResolution,
  type OrgMentionSearchDocument,
} from "@/lib/organizations/mention-resolve-shared";
import { loadActiveOrganizationEntities } from "@/lib/organizations/registry-sync";
import { splitOrgMultiValue } from "@/lib/organizations/org-multi-values";

export type ResolveOrgMentionsResult = {
  scanned: number;
  confirmed: number;
  provisional: number;
  unresolved: number;
  retracted: number;
};

function parseAddressList(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function headerDomainsFromAddresses(addresses: string[]): string[] {
  const domains = new Set<string>();
  for (const line of addresses) {
    const parsed = parseStoredFromAddress(line);
    const mailbox = parsed.email ?? extractMailboxEmail(line);
    const domain = mailboxDomain(mailbox);
    if (domain) domains.add(domain);
    const host = orgWebsiteHost(mailbox);
    if (host) domains.add(host);
  }
  return [...domains];
}

async function loadDocuments(): Promise<OrgMentionSearchDocument[]> {
  const [entities, fingerprints] = await Promise.all([
    loadActiveOrganizationEntities(),
    loadOrgFingerprintSummaries().catch(() => ({ organizations: [] as Array<{
      id: string;
      aliases: string[];
    }> })),
  ]);
  const aliasesByKey = new Map<string, string[]>();
  for (const org of fingerprints.organizations) {
    aliasesByKey.set(org.id, org.aliases ?? []);
  }
  return entities.map((entity) => ({
    id: entity.id,
    name: entity.name,
    aliases: aliasesByKey.get(entity.identityKey) ?? [],
    email: entity.email,
    website: entity.website,
  }));
}

async function loadHeaderDomains(emailId: string): Promise<string[]> {
  const db = getDb();
  const [row] = await db
    .select({
      fromAddress: emails.fromAddress,
      toAddresses: emails.toAddresses,
      ccAddresses: emails.ccAddresses,
    })
    .from(emails)
    .where(eq(emails.id, emailId))
    .limit(1);
  if (!row) return [];
  return headerDomainsFromAddresses([
    row.fromAddress,
    ...parseAddressList(row.toAddresses),
    ...parseAddressList(row.ccAddresses),
  ]);
}

async function loadAffiliatedOrganizationIds(emailId: string): Promise<string[]> {
  const db = getDb();
  const mentionRows = await db
    .select({
      personId: contactMentions.resolvedPersonId,
      organizationId: contactMentions.resolvedOrganizationId,
    })
    .from(contactMentions)
    .where(eq(contactMentions.sourceEmailId, emailId));

  const ids = new Set<string>();
  const personIds = mentionRows
    .map((row) => row.personId)
    .filter((id): id is string => Boolean(id));
  for (const row of mentionRows) {
    if (row.organizationId) ids.add(row.organizationId);
  }
  if (personIds.length > 0) {
    const people = await db
      .select({
        id: contactPersons.id,
        currentOrganizationId: contactPersons.currentOrganizationId,
      })
      .from(contactPersons)
      .where(inArray(contactPersons.id, personIds));
    for (const person of people) {
      if (person.currentOrganizationId) ids.add(person.currentOrganizationId);
    }
  }
  return [...ids];
}

/**
 * Sync is the caller's job when they want a fresh register.
 * Confirmed mentions are not rewritten.
 */
export async function resolveOrgMentions(params?: {
  emailIds?: string[];
  limit?: number;
}): Promise<ResolveOrgMentionsResult> {
  const db = getDb();
  const limit = params?.limit ?? 2000;
  const emailIds = params?.emailIds?.map((id) => id.trim()).filter(Boolean);

  const statusFilter = inArray(organizationMentions.resolutionStatus, [
    "unresolved",
    "provisional",
  ]);
  const mentionRows =
    emailIds && emailIds.length > 0
      ? await db
          .select()
          .from(organizationMentions)
          .where(
            and(
              statusFilter,
              inArray(organizationMentions.sourceEmailId, emailIds),
            ),
          )
          .limit(limit)
      : await db
          .select()
          .from(organizationMentions)
          .where(statusFilter)
          .limit(limit);

  const result: ResolveOrgMentionsResult = {
    scanned: mentionRows.length,
    confirmed: 0,
    provisional: 0,
    unresolved: 0,
    retracted: 0,
  };
  if (mentionRows.length === 0) return result;

  const documents = await loadDocuments();
  const headerCache = new Map<string, string[]>();
  const affiliateCache = new Map<string, string[]>();
  const now = new Date().toISOString();

  for (const mention of mentionRows) {
    const emailId = mention.sourceEmailId;
    if (!emailId) {
      result.unresolved += 1;
      continue;
    }
    if (!headerCache.has(emailId)) {
      headerCache.set(emailId, await loadHeaderDomains(emailId));
    }
    if (!affiliateCache.has(emailId)) {
      affiliateCache.set(emailId, await loadAffiliatedOrganizationIds(emailId));
    }

    const decision = decideOrgMentionResolution({
      rawName: mention.rawName,
      email: mention.email,
      website: mention.website,
      headerDomains: headerCache.get(emailId) ?? [],
      affiliatedOrganizationIds: affiliateCache.get(emailId) ?? [],
      documents,
    });

    const wasProvisional = mention.resolutionStatus === "provisional";
    const nextCandidates = JSON.stringify(decision.candidateOrganizationIds);
    const unchanged =
      mention.resolutionStatus === decision.status &&
      (mention.resolvedOrganizationId ?? null) === decision.organizationId &&
      (mention.resolutionReason ?? null) === decision.reason &&
      mention.candidateOrganizationIdsJson === nextCandidates;
    if (unchanged) {
      if (decision.status === "confirmed") result.confirmed += 1;
      else if (decision.status === "provisional") result.provisional += 1;
      else result.unresolved += 1;
      continue;
    }

    await db
      .update(organizationMentions)
      .set({
        resolutionStatus: decision.status,
        resolvedOrganizationId: decision.organizationId,
        resolutionReason: decision.reason,
        candidateOrganizationIdsJson: nextCandidates,
        updatedAt: now,
      })
      .where(eq(organizationMentions.id, mention.id));

    if (wasProvisional && decision.status === "unresolved") {
      result.retracted += 1;
    }
    if (decision.status === "confirmed") result.confirmed += 1;
    else if (decision.status === "provisional") result.provisional += 1;
    else result.unresolved += 1;
  }

  return result;
}

export async function confirmOrgMention(params: {
  mentionId: string;
  organizationId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const [mention] = await db
    .select({ id: organizationMentions.id })
    .from(organizationMentions)
    .where(eq(organizationMentions.id, params.mentionId))
    .limit(1);
  if (!mention) return { ok: false, error: "Mention not found." };

  const [org] = await db
    .select({ id: organizationEntities.id })
    .from(organizationEntities)
    .where(eq(organizationEntities.id, params.organizationId))
    .limit(1);
  if (!org) return { ok: false, error: "Organization not found." };

  await db
    .update(organizationMentions)
    .set({
      resolutionStatus: "confirmed",
      resolvedOrganizationId: params.organizationId,
      resolutionReason: "manual_attach",
      candidateOrganizationIdsJson: JSON.stringify([params.organizationId]),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(organizationMentions.id, params.mentionId));
  invalidateOrgFingerprintSummariesCache();
  return { ok: true };
}

export { parseJsonIdList };
