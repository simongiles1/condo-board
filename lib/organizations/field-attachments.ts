/** Persist and apply org metadata positive associations (moved field links). */

import { randomUUID } from "crypto";

import { and, eq } from "drizzle-orm";

import { attachManualContactField } from "@/lib/contacts/registry-apply";
import {
  deleteContactFieldDenial,
  isContactDeniableField,
} from "@/lib/contacts/field-denials";
import { getDb } from "@/lib/db";
import { organizationFieldAttachments } from "@/lib/db/schema";
import type { OrgEntityCard } from "@/lib/email-analysis/org-highlight-shared";
import {
  deleteOrganizationFieldDenial,
  isOrgDeniableField,
  normalizeOrgDeniedValue,
  normalizeOrgNameKey,
  orgIdentityKey,
  recordOrganizationFieldDenial,
  stripDeniedFieldsFromOrgCard,
  type OrgFieldDenial,
} from "@/lib/organizations/field-denials";
import { resolveOrgSurvivorKey } from "@/lib/organizations/manual-merge";
import {
  mergeOrgAliasLists,
  mergeOrgMultiValues,
} from "@/lib/organizations/org-multi-values";
import {
  applyResidualEmailsFromMovedIdentityBuckets,
  loadOrganizationMergeHarvestCards,
  residualEmailsFromIdentityBucket,
  survivorOrgKeyForName,
} from "@/lib/organizations/identity-email-bucket";

export const ORG_MOVABLE_FIELDS = [
  "email",
  "phone",
  "website",
  "name_alias",
] as const;

export type OrgMovableField = (typeof ORG_MOVABLE_FIELDS)[number];

export type OrgFieldAttachment = {
  id: string;
  orgKey: string;
  field: OrgMovableField;
  attachedValue: string;
  valueKey: string;
  nameKey: string | null;
  createdAt: string;
};

export function isOrgMovableField(value: string): value is OrgMovableField {
  return (ORG_MOVABLE_FIELDS as readonly string[]).includes(value);
}

export function orgCardMatchesAttachmentTarget(
  card: OrgEntityCard,
  attachment: Pick<OrgFieldAttachment, "orgKey" | "nameKey">,
  mergeMap: Map<string, string>,
): boolean {
  if (attachment.nameKey) {
    return normalizeOrgNameKey(card.name) === attachment.nameKey;
  }
  const cardKey = orgIdentityKey(card);
  return (
    resolveOrgSurvivorKey(cardKey, mergeMap) ===
    resolveOrgSurvivorKey(attachment.orgKey, mergeMap)
  );
}

function attachFieldToOrgCard(
  card: OrgEntityCard,
  field: OrgMovableField,
  displayValue: string,
): OrgEntityCard {
  const trimmed = displayValue.trim();
  if (!trimmed) return card;
  if (field === "name_alias") {
    return {
      ...card,
      aliases: mergeOrgAliasLists(card.name, card.aliases, [trimmed]),
    };
  }
  return {
    ...card,
    [field]: mergeOrgMultiValues(field, card[field], trimmed),
  };
}

export function applyOrgFieldAttachmentsToCards(
  cards: OrgEntityCard[],
  attachments: OrgFieldAttachment[],
  mergeMap: Map<string, string> = new Map(),
): OrgEntityCard[] {
  if (attachments.length === 0) return cards;
  return cards.map((card) => {
    let next = card;
    for (const attachment of attachments) {
      if (!orgCardMatchesAttachmentTarget(next, attachment, mergeMap)) continue;
      next = attachFieldToOrgCard(next, attachment.field, attachment.attachedValue);
    }
    return next;
  });
}

/**
 * Apply a single move in memory: deny on source, attach on target.
 * Mirrors persist + reload without touching the database.
 */
export function applyOrgFieldMoveToCards(params: {
  cards: OrgEntityCard[];
  field: OrgMovableField;
  value: string;
  sourceOrgKey: string;
  sourceNameKey?: string | null;
  targetOrgKey: string;
  targetNameKey?: string | null;
  mergeMap?: Map<string, string>;
}): OrgEntityCard[] {
  const mergeMap = params.mergeMap ?? new Map();
  const deniedValue = normalizeOrgDeniedValue(params.field, params.value);
  const denial: OrgFieldDenial = {
    id: "move",
    orgKey: params.sourceOrgKey,
    field: params.field,
    deniedValue,
    nameKey: params.sourceNameKey?.trim() || null,
    createdAt: "",
  };
  const stripped = params.cards.map((card) =>
    stripDeniedFieldsFromOrgCard(card, [denial], mergeMap),
  );
  const attachment: OrgFieldAttachment = {
    id: "move",
    orgKey: params.targetOrgKey,
    field: params.field,
    attachedValue: params.value.trim(),
    valueKey: deniedValue,
    nameKey: params.targetNameKey?.trim() || null,
    createdAt: "",
  };
  return applyOrgFieldAttachmentsToCards(stripped, [attachment], mergeMap);
}

export async function loadOrganizationFieldAttachments(): Promise<
  OrgFieldAttachment[]
> {
  const db = getDb();
  const rows = await db.select().from(organizationFieldAttachments);
  const out: OrgFieldAttachment[] = [];
  for (const row of rows) {
    if (!isOrgMovableField(row.field)) continue;
    out.push({
      id: row.id,
      orgKey: row.orgKey,
      field: row.field,
      attachedValue: row.attachedValue,
      valueKey: row.valueKey,
      nameKey: row.nameKey?.trim() || null,
      createdAt: row.createdAt,
    });
  }
  return out;
}

export async function deleteOrganizationFieldAttachment(params: {
  organizationId: string;
  field: OrgMovableField;
  value: string;
}): Promise<void> {
  const organizationId = params.organizationId.trim();
  const valueKey = normalizeOrgDeniedValue(params.field, params.value);
  if (!organizationId || !valueKey) return;
  const db = getDb();
  await db
    .delete(organizationFieldAttachments)
    .where(
      and(
        eq(organizationFieldAttachments.orgKey, organizationId),
        eq(organizationFieldAttachments.field, params.field),
        eq(organizationFieldAttachments.valueKey, valueKey),
      ),
    );
}

export async function pinOrganizationFieldAttachment(params: {
  organizationId: string;
  field: OrgMovableField;
  value: string;
  organizationName?: string | null;
}): Promise<
  { ok: true; attachment: OrgFieldAttachment } | { ok: false; error: string }
> {
  return recordOrganizationFieldAttachment(params);
}

async function recordOrganizationFieldAttachment(params: {
  organizationId: string;
  field: OrgMovableField;
  value: string;
  organizationName?: string | null;
}): Promise<
  { ok: true; attachment: OrgFieldAttachment } | { ok: false; error: string }
> {
  const organizationId = params.organizationId.trim();
  const attachedValue = params.value.trim();
  if (!organizationId) {
    return { ok: false, error: "organizationId is required." };
  }
  if (!attachedValue) {
    return { ok: false, error: "Cannot attach an empty value." };
  }

  const field = params.field;
  const valueKey = normalizeOrgDeniedValue(field, attachedValue);
  const nameKey = normalizeOrgNameKey(params.organizationName) || null;
  const db = getDb();
  const existing = await db
    .select({ id: organizationFieldAttachments.id })
    .from(organizationFieldAttachments)
    .where(
      and(
        eq(organizationFieldAttachments.orgKey, organizationId),
        eq(organizationFieldAttachments.field, field),
        eq(organizationFieldAttachments.valueKey, valueKey),
      ),
    )
    .limit(1);

  const nowIso = new Date().toISOString();
  if (existing[0]) {
    await db
      .update(organizationFieldAttachments)
      .set({
        attachedValue,
        nameKey,
      })
      .where(eq(organizationFieldAttachments.id, existing[0].id));
    return {
      ok: true,
      attachment: {
        id: existing[0].id,
        orgKey: organizationId,
        field,
        attachedValue,
        valueKey,
        nameKey,
        createdAt: nowIso,
      },
    };
  }

  const id = randomUUID();
  await db.insert(organizationFieldAttachments).values({
    id,
    orgKey: organizationId,
    field,
    attachedValue,
    valueKey,
    nameKey,
    createdAt: nowIso,
  });
  return {
    ok: true,
    attachment: {
      id,
      orgKey: organizationId,
      field,
      attachedValue,
      valueKey,
      nameKey,
      createdAt: nowIso,
    },
  };
}

export async function moveOrganizationField(params: {
  sourceOrganizationId: string;
  targetOrganizationId: string;
  field: string;
  value: string;
  sourceOrganizationName?: string | null;
  targetOrganizationName?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sourceOrganizationId = params.sourceOrganizationId.trim();
  const targetOrganizationId = params.targetOrganizationId.trim();
  const value = params.value.trim();
  if (!sourceOrganizationId || !targetOrganizationId) {
    return { ok: false, error: "Source and target organization ids are required." };
  }
  if (sourceOrganizationId === targetOrganizationId) {
    return { ok: false, error: "Pick a different organization to move to." };
  }
  if (!isOrgMovableField(params.field)) {
    return {
      ok: false,
      error: `Unsupported field. Use one of: ${ORG_MOVABLE_FIELDS.join(", ")}.`,
    };
  }
  if (!isOrgDeniableField(params.field)) {
    return { ok: false, error: "That field cannot be severed from the source." };
  }
  if (!value) {
    return { ok: false, error: "Cannot move an empty value." };
  }

  const field = params.field;
  const denied = await recordOrganizationFieldDenial({
    organizationId: sourceOrganizationId,
    field,
    value,
    organizationName: params.sourceOrganizationName,
  });
  if (!denied.ok) return denied;

  await deleteOrganizationFieldAttachment({
    organizationId: sourceOrganizationId,
    field,
    value,
  });
  await deleteOrganizationFieldDenial({
    organizationId: targetOrganizationId,
    field,
    value,
  });
  const attached = await recordOrganizationFieldAttachment({
    organizationId: targetOrganizationId,
    field,
    value,
    organizationName: params.targetOrganizationName,
  });
  if (!attached.ok) return attached;

  if (
    field === "email" &&
    sourceOrganizationId.startsWith("email:") &&
    params.sourceOrganizationName?.trim()
  ) {
    const survivorKey = survivorOrgKeyForName(params.sourceOrganizationName);
    if (survivorKey) {
      const harvestCards = await loadOrganizationMergeHarvestCards();
      const residual = residualEmailsFromIdentityBucket({
        identityOrgKey: sourceOrganizationId,
        movedEmailNormalized: normalizeOrgDeniedValue("email", value),
        cards: harvestCards,
      });
      for (const mailbox of residual) {
        await recordOrganizationFieldAttachment({
          organizationId: survivorKey,
          field: "email",
          value: mailbox,
          organizationName: params.sourceOrganizationName,
        });
      }
    }
  }

  return { ok: true };
}

/**
 * Sever a harvested org field and attach it to a person (name alias / email / phone).
 * Website cannot move to a contact.
 */
export async function moveOrganizationFieldToPerson(params: {
  sourceOrganizationId: string;
  targetPersonId: string;
  field: string;
  value: string;
  sourceOrganizationName?: string | null;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const sourceOrganizationId = params.sourceOrganizationId.trim();
  const targetPersonId = params.targetPersonId.trim();
  const value = params.value.trim();
  if (!sourceOrganizationId || !targetPersonId) {
    return { ok: false, error: "Source organization and target person are required." };
  }
  if (!isOrgMovableField(params.field)) {
    return {
      ok: false,
      error: `Unsupported field. Use one of: ${ORG_MOVABLE_FIELDS.join(", ")}.`,
    };
  }
  if (params.field === "website") {
    return { ok: false, error: "Websites cannot be moved onto a contact." };
  }
  if (!isOrgDeniableField(params.field)) {
    return { ok: false, error: "That field cannot be severed from the source." };
  }
  if (!value) {
    return { ok: false, error: "Cannot move an empty value." };
  }
  if (params.field !== "email" && params.field !== "phone" && params.field !== "name_alias") {
    return { ok: false, error: "That field cannot be moved onto a contact." };
  }
  const field = params.field;

  const denied = await recordOrganizationFieldDenial({
    organizationId: sourceOrganizationId,
    field,
    value,
    organizationName: params.sourceOrganizationName,
  });
  if (!denied.ok) return denied;

  await deleteOrganizationFieldAttachment({
    organizationId: sourceOrganizationId,
    field,
    value,
  });

  if (isContactDeniableField(field)) {
    await deleteContactFieldDenial({
      personId: targetPersonId,
      field,
      value,
    });
  }

  const attached = await attachManualContactField({
    personId: targetPersonId,
    field,
    value,
  });
  if (!attached.ok) return attached;

  if (attached.alreadyIdentity) {
    return {
      ok: true,
      message: `Removed “${value}” from the organization; it is already the name of ${attached.displayName}.`,
    };
  }
  return {
    ok: true,
    message: `Moved “${value}” from the organization onto ${attached.displayName}.`,
  };
}
