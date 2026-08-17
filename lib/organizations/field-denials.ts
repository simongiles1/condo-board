/** Persist and apply org metadata negative associations (severed field links). */

import { randomUUID } from "crypto";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { organizationFieldDenials } from "@/lib/db/schema";
import {
  entityCardDisplayName,
  type OrgEntityCard,
} from "@/lib/email-analysis/org-highlight-shared";
import { resolveOrgSurvivorKey } from "@/lib/organizations/manual-merge";
import {
  mergeOrgAliasLists,
  orgMultiValueContains,
  primaryOrgMultiValue,
  removeOrgMultiValue,
} from "@/lib/organizations/org-multi-values";

export const ORG_DENIABLE_FIELDS = [
  "name",
  "organization_role",
  "email",
  "phone",
  "website",
  "name_alias",
] as const;

export type OrgDeniableField = (typeof ORG_DENIABLE_FIELDS)[number];

export type OrgFieldDenial = {
  id: string;
  orgKey: string;
  field: OrgDeniableField;
  deniedValue: string;
  nameKey: string | null;
  createdAt: string;
};

export function isOrgDeniableField(value: string): value is OrgDeniableField {
  return (ORG_DENIABLE_FIELDS as readonly string[]).includes(value);
}

export function normalizeOrgNameKey(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeOrgDeniedValue(
  field: OrgDeniableField,
  value: string,
): string {
  const trimmed = value.trim();
  if (field === "email" || field === "website") {
    return trimmed.toLowerCase();
  }
  if (field === "phone") {
    const digits = trimmed.replace(/\D/g, "");
    return digits || trimmed.toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function orgIdentityKey(card: OrgEntityCard): string {
  const email = primaryOrgMultiValue(card.email)?.toLowerCase();
  if (email) return `email:${email}`;
  const name = card.name?.trim().toLowerCase();
  if (name) return `name:${name}`;
  const website = primaryOrgMultiValue(card.website)?.toLowerCase();
  if (website) return `web:${website}`;
  const phone = primaryOrgMultiValue(card.phone)?.toLowerCase();
  if (phone) return `phone:${phone}`;
  return `empty:${entityCardDisplayName(card)}`;
}

function fieldValueMatchesDenial(
  card: OrgEntityCard,
  denial: OrgFieldDenial,
): boolean {
  if (denial.field === "name_alias") {
    return (card.aliases ?? []).some(
      (alias) =>
        normalizeOrgDeniedValue("name_alias", alias) === denial.deniedValue,
    );
  }
  if (
    denial.field === "email" ||
    denial.field === "phone" ||
    denial.field === "website"
  ) {
    return orgMultiValueContains(
      denial.field,
      card[denial.field],
      denial.deniedValue,
    );
  }
  const raw = card[denial.field];
  if (!raw?.trim()) return false;
  return normalizeOrgDeniedValue(denial.field, raw) === denial.deniedValue;
}

/**
 * Pairwise match: denied value on this org only.
 * Prefer name_key so denying a board-member email does not strip it from
 * unrelated cards that share the same address as identity.
 */
export function orgCardMatchesFieldDenial(
  card: OrgEntityCard,
  denial: OrgFieldDenial,
  mergeMap: Map<string, string>,
): boolean {
  if (!fieldValueMatchesDenial(card, denial)) return false;

  if (denial.nameKey) {
    return normalizeOrgNameKey(card.name) === denial.nameKey;
  }

  const cardKey = orgIdentityKey(card);
  return (
    resolveOrgSurvivorKey(cardKey, mergeMap) ===
    resolveOrgSurvivorKey(denial.orgKey, mergeMap)
  );
}

export function stripDeniedFieldsFromOrgCard(
  card: OrgEntityCard,
  denials: OrgFieldDenial[],
  mergeMap: Map<string, string>,
): OrgEntityCard {
  if (denials.length === 0) return card;
  const next: OrgEntityCard = {
    ...card,
    aliases: [...(card.aliases ?? [])],
  };
  for (const denial of denials) {
    if (!orgCardMatchesFieldDenial(next, denial, mergeMap)) continue;
    if (denial.field === "name_alias") {
      next.aliases = mergeOrgAliasLists(
        next.name,
        (next.aliases ?? []).filter(
          (alias) =>
            normalizeOrgDeniedValue("name_alias", alias) !== denial.deniedValue,
        ),
      );
      continue;
    }
    if (
      denial.field === "email" ||
      denial.field === "phone" ||
      denial.field === "website"
    ) {
      next[denial.field] = removeOrgMultiValue(
        denial.field,
        next[denial.field],
        denial.deniedValue,
      );
      continue;
    }
    next[denial.field] = null;
  }
  return next;
}

export function applyOrgFieldDenialsToCards(
  cards: OrgEntityCard[],
  denials: OrgFieldDenial[],
  mergeMap: Map<string, string> = new Map(),
): OrgEntityCard[] {
  if (denials.length === 0) return cards;
  return cards
    .map((card) => stripDeniedFieldsFromOrgCard(card, denials, mergeMap))
    .filter(
      (card) =>
        Boolean(
          card.name?.trim() ||
            card.organization_role?.trim() ||
            card.email?.trim() ||
            card.phone?.trim() ||
            card.website?.trim(),
        ),
    );
}

export async function loadOrganizationFieldDenials(): Promise<
  OrgFieldDenial[]
> {
  const db = getDb();
  const rows = await db.select().from(organizationFieldDenials);
  const out: OrgFieldDenial[] = [];
  for (const row of rows) {
    if (!isOrgDeniableField(row.field)) continue;
    out.push({
      id: row.id,
      orgKey: row.orgKey,
      field: row.field,
      deniedValue: row.deniedValue,
      nameKey: row.nameKey?.trim() || null,
      createdAt: row.createdAt,
    });
  }
  return out;
}

export async function recordOrganizationFieldDenial(params: {
  organizationId: string;
  field: string;
  value: string;
  organizationName?: string | null;
}): Promise<
  | { ok: true; denial: OrgFieldDenial }
  | { ok: false; error: string }
> {
  const organizationId = params.organizationId.trim();
  const rawValue = params.value.trim();
  if (!organizationId) {
    return { ok: false, error: "organizationId is required." };
  }
  if (!isOrgDeniableField(params.field)) {
    return {
      ok: false,
      error: `Unsupported field. Use one of: ${ORG_DENIABLE_FIELDS.join(", ")}.`,
    };
  }
  if (!rawValue) {
    return { ok: false, error: "Cannot sever an empty value." };
  }

  const field = params.field;
  const deniedValue = normalizeOrgDeniedValue(field, rawValue);
  const nameKey =
    normalizeOrgNameKey(params.organizationName) ||
    (field === "name" ? normalizeOrgNameKey(rawValue) : "") ||
    null;

  const db = getDb();
  const existing = await db
    .select({ id: organizationFieldDenials.id })
    .from(organizationFieldDenials)
    .where(
      and(
        eq(organizationFieldDenials.orgKey, organizationId),
        eq(organizationFieldDenials.field, field),
        eq(organizationFieldDenials.deniedValue, deniedValue),
      ),
    )
    .limit(1);

  const nowIso = new Date().toISOString();
  if (existing[0]) {
    await db
      .update(organizationFieldDenials)
      .set({ nameKey })
      .where(eq(organizationFieldDenials.id, existing[0].id));
    return {
      ok: true,
      denial: {
        id: existing[0].id,
        orgKey: organizationId,
        field,
        deniedValue,
        nameKey,
        createdAt: nowIso,
      },
    };
  }

  const id = randomUUID();
  await db.insert(organizationFieldDenials).values({
    id,
    orgKey: organizationId,
    field,
    deniedValue,
    nameKey,
    createdAt: nowIso,
  });

  return {
    ok: true,
    denial: {
      id,
      orgKey: organizationId,
      field,
      deniedValue,
      nameKey,
      createdAt: nowIso,
    },
  };
}
