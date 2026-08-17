/** Deterministic person↔org match signals (shared by propose + matching queue). */

import { normalizeOrgNameKey } from "@/lib/organizations/field-denials";
import {
  extractEmailDomain,
  isCorporateEmailDomain,
  websiteHost,
} from "@/lib/organizations/consumer-domains";
import type { OrganizationEntityRow } from "@/lib/organizations/registry-sync";
import type {
  AffiliationConfidence,
  AffiliationEvidence,
  AffiliationSource,
} from "@/lib/affiliations/shared";

export type OrgMatchTarget = OrganizationEntityRow & {
  /** Fingerprint / merge aliases (optional; thin registry has no alias column). */
  aliases?: string[];
};

export type AffiliationMatchHit = {
  organization: OrgMatchTarget;
  sources: Set<AffiliationSource>;
  confidence: AffiliationConfidence;
  evidence: AffiliationEvidence;
};

function orgDomains(org: OrgMatchTarget): string[] {
  const out = new Set<string>();
  const emailDomain = extractEmailDomain(org.email);
  if (emailDomain && isCorporateEmailDomain(emailDomain)) out.add(emailDomain);
  const host = websiteHost(org.website);
  if (host && isCorporateEmailDomain(host)) out.add(host);
  return [...out];
}

/** Exact corporate domain ↔ org email/website host (incl. subdomain). */
export function domainMatchesOrg(
  domain: string,
  org: OrgMatchTarget,
): boolean {
  if (!domain || !isCorporateEmailDomain(domain)) return false;
  const orgDomainList = orgDomains(org);
  return orgDomainList.some(
    (d) => d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`),
  );
}

/**
 * Substring match of a company / alias string against org primary name + aliases.
 */
export function companyNameMatchesOrg(
  companyName: string,
  org: OrgMatchTarget,
): boolean {
  const companyKey = normalizeOrgNameKey(companyName);
  if (!companyKey) return false;
  const orgNames = [org.name, ...(org.aliases ?? [])].filter(Boolean) as string[];
  for (const name of orgNames) {
    const orgKey = normalizeOrgNameKey(name);
    if (
      orgKey &&
      (orgKey === companyKey ||
        orgKey.includes(companyKey) ||
        companyKey.includes(orgKey))
    ) {
      return true;
    }
  }
  return false;
}

function addDomainHit(
  orgHits: Map<string, AffiliationMatchHit>,
  org: OrgMatchTarget,
  domain: string,
): void {
  const prior = orgHits.get(org.id);
  if (prior) {
    prior.sources.add("domain_prior");
    prior.confidence = "high";
    prior.evidence = {
      ...prior.evidence,
      domain,
    };
    return;
  }
  orgHits.set(org.id, {
    organization: org,
    sources: new Set(["domain_prior"]),
    confidence: "high",
    evidence: { domain, emailIds: [] },
  });
}

function addCooccurrenceHit(
  orgHits: Map<string, AffiliationMatchHit>,
  org: OrgMatchTarget,
  companyName: string,
  matchedEmailIds: string[],
): void {
  const prior = orgHits.get(org.id);
  if (prior) {
    prior.sources.add("cooccurrence");
    const names = new Set([
      ...(prior.evidence.companyNames ?? []),
      companyName,
    ]);
    prior.evidence = {
      ...prior.evidence,
      companyNames: [...names],
      emailIds: [
        ...new Set([...(prior.evidence.emailIds ?? []), ...matchedEmailIds]),
      ],
    };
    return;
  }
  orgHits.set(org.id, {
    organization: org,
    sources: new Set(["cooccurrence"]),
    confidence: "medium",
    evidence: {
      companyNames: [companyName],
      emailIds: matchedEmailIds,
    },
  });
}

/**
 * Deterministic shortlist for one person.
 * Signals: corporate email domain → org host/email; company-name / person-alias
 * co-occurrence against org name + aliases (only when no domain hit).
 */
export function computePersonOrgMatchHits(params: {
  personEmails: string[];
  /** Also-known-as + highlight company names used as soft name signals. */
  nameSignals: string[];
  /** emailId → company names extracted from that email's highlights. */
  companiesByEmailId: Map<string, string[]>;
  evidenceEmailIds: Set<string>;
  organizations: OrgMatchTarget[];
}): AffiliationMatchHit[] {
  const orgHits = new Map<string, AffiliationMatchHit>();

  for (const email of params.personEmails) {
    const domain = extractEmailDomain(email);
    if (!isCorporateEmailDomain(domain)) continue;
    for (const org of params.organizations) {
      if (!domainMatchesOrg(domain, org)) continue;
      addDomainHit(orgHits, org, domain);
    }
  }

  const hasDomainPrior = [...orgHits.values()].some((h) =>
    h.sources.has("domain_prior"),
  );
  if (hasDomainPrior) {
    return finalizeHits(orgHits);
  }

  const companyNames = new Set<string>();
  const matchedEmailIds: string[] = [];
  for (const emailId of params.evidenceEmailIds) {
    const names = params.companiesByEmailId.get(emailId) ?? [];
    if (names.length === 0) continue;
    matchedEmailIds.push(emailId);
    for (const name of names) companyNames.add(name);
  }
  for (const signal of params.nameSignals) {
    const trimmed = signal.trim();
    if (trimmed) companyNames.add(trimmed);
  }

  for (const companyName of companyNames) {
    for (const org of params.organizations) {
      if (!companyNameMatchesOrg(companyName, org)) continue;
      addCooccurrenceHit(orgHits, org, companyName, matchedEmailIds);
    }
  }

  return finalizeHits(orgHits);
}

function finalizeHits(
  orgHits: Map<string, AffiliationMatchHit>,
): AffiliationMatchHit[] {
  const hitList = [...orgHits.values()];
  const candidateIds = hitList.map((h) => h.organization.id);
  for (const hit of hitList) {
    hit.evidence = {
      ...hit.evidence,
      candidateOrganizationIds: candidateIds,
    };
  }
  // Domain-high first, then medium; stable by org name.
  hitList.sort((a, b) => {
    const conf = confidenceRank(b.confidence) - confidenceRank(a.confidence);
    if (conf !== 0) return conf;
    const aName = a.organization.name ?? a.organization.identityKey;
    const bName = b.organization.name ?? b.organization.identityKey;
    return aName.localeCompare(bName, undefined, { sensitivity: "base" });
  });
  return hitList;
}

function confidenceRank(c: AffiliationConfidence): number {
  if (c === "high") return 3;
  if (c === "medium") return 2;
  return 1;
}

export function primarySourceFromHit(
  hit: AffiliationMatchHit,
): AffiliationSource {
  return hit.sources.has("domain_prior") ? "domain_prior" : "cooccurrence";
}
