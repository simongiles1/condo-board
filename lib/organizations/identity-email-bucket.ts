/** Co-bucketed mailboxes on an identity-keyed org card (email:…). */

import { isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { organizationFingerprintMerges } from "@/lib/db/schema";
import {
  parseOrgFingerprintResult,
  type OrgEntityCard,
} from "@/lib/email-analysis/org-highlight-shared";
import {
  normalizeOrgDeniedValue,
  normalizeOrgNameKey,
  orgIdentityKey,
  type OrgFieldDenial,
} from "@/lib/organizations/field-denials";
import {
  mergeOrgMultiValues,
  splitOrgMultiValue,
} from "@/lib/organizations/org-multi-values";

export type OrgSummaryWithEmail = {
  name: string | null;
  email: string | null;
};

/** Harvest cards from pass-4 thread merges (raw, before field denials). */
export async function loadOrganizationMergeHarvestCards(): Promise<
  OrgEntityCard[]
> {
  const db = getDb();
  const rows = await db
    .select({ entityCardsJson: organizationFingerprintMerges.entityCardsJson })
    .from(organizationFingerprintMerges)
    .where(isNull(organizationFingerprintMerges.error));

  const out: OrgEntityCard[] = [];
  for (const row of rows) {
    let parsed: ReturnType<typeof parseOrgFingerprintResult>;
    try {
      parsed = parseOrgFingerprintResult(
        JSON.parse(row.entityCardsJson) as unknown,
      );
    } catch {
      continue;
    }
    out.push(...parsed.entity_cards);
  }
  return out;
}

/** Mailboxes that shared the old email:… bucket besides the address that was moved. */
export function residualEmailsFromIdentityBucket(params: {
  identityOrgKey: string;
  movedEmailNormalized: string;
  cards: OrgEntityCard[];
}): string[] {
  const movedKey = params.movedEmailNormalized.trim().toLowerCase();
  if (!movedKey || !params.identityOrgKey.startsWith("email:")) return [];
  const bucketEmail = params.identityOrgKey.slice("email:".length).trim();
  if (!bucketEmail) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const card of params.cards) {
    const emails = splitOrgMultiValue(card.email);
    const inBucket =
      orgIdentityKey(card) === params.identityOrgKey ||
      emails.some(
        (part) => normalizeOrgDeniedValue("email", part) === bucketEmail,
      );
    if (!inBucket) continue;
    for (const part of emails) {
      const key = normalizeOrgDeniedValue("email", part);
      if (!key || !key.includes("@") || key === movedKey || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(part);
    }
  }
  return out;
}

export function survivorOrgKeyForName(
  organizationName: string | null | undefined,
): string | null {
  const name = organizationName?.trim();
  if (!name) return null;
  return orgIdentityKey({
    name,
    organization_role: null,
    email: null,
    phone: null,
    website: null,
    aliases: [],
  });
}

export function residualEmailsFromNamedHarvestCards(params: {
  nameKey: string;
  denials: OrgFieldDenial[];
  cards: OrgEntityCard[];
}): string[] {
  const deniedKeys = deniedEmailKeysForNameKey(params.denials, params.nameKey);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const card of params.cards) {
    if (normalizeOrgNameKey(card.name) !== params.nameKey) continue;
    for (const part of splitOrgMultiValue(card.email)) {
      const key = normalizeOrgDeniedValue("email", part);
      if (!key || !key.includes("@") || deniedKeys.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(part);
    }
  }
  return out;
}

function deniedEmailKeysForNameKey(
  denials: OrgFieldDenial[],
  nameKey: string,
): Set<string> {
  const deniedKeys = new Set<string>();
  for (const denial of denials) {
    if (denial.field !== "email" || denial.nameKey !== nameKey) continue;
    deniedKeys.add(denial.deniedValue);
  }
  return deniedKeys;
}

export function applyResidualEmailsFromMovedIdentityBuckets<
  T extends OrgSummaryWithEmail,
>(params: {
  organizations: T[];
  denials: OrgFieldDenial[];
  harvestCards: OrgEntityCard[];
}): T[] {
  if (params.harvestCards.length === 0 || params.denials.length === 0) {
    return params.organizations;
  }

  return params.organizations.map((org) => {
    const nameKey = normalizeOrgNameKey(org.name);
    if (!nameKey) return org;

    const deniedEmailKeys = deniedEmailKeysForNameKey(params.denials, nameKey);
    const residual: string[] = [];
    for (const denial of params.denials) {
      if (
        denial.field !== "email" ||
        denial.nameKey !== nameKey ||
        !denial.orgKey.startsWith("email:")
      ) {
        continue;
      }
      for (const part of residualEmailsFromIdentityBucket({
        identityOrgKey: denial.orgKey,
        movedEmailNormalized: denial.deniedValue,
        cards: params.harvestCards,
      })) {
        const key = normalizeOrgDeniedValue("email", part);
        if (!key || deniedEmailKeys.has(key)) continue;
        residual.push(part);
      }
    }
    residual.push(
      ...residualEmailsFromNamedHarvestCards({
        nameKey,
        denials: params.denials,
        cards: params.harvestCards,
      }),
    );

    if (residual.length === 0) return org;
    return {
      ...org,
      email: mergeOrgMultiValues("email", org.email, ...residual),
    };
  });
}
