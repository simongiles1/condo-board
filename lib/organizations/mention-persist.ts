/**
 * Upsert per-email organization mentions from pass-3 fingerprint cards
 * and other painted org surfaces (extraction names, project contractors).
 * Does not mint organization_entities. Resolution is a separate pass.
 */

import { randomUUID } from "crypto";

import { and, eq } from "drizzle-orm";

import {
  mentionPresenceHaystack,
  textHasNameToken,
  type MentionPresenceEmail,
} from "@/lib/contacts/mention-presence";
import { resolveAuthoredBodiesForEvidence } from "@/lib/contacts/registry-evidence";
import { getDb } from "@/lib/db";
import {
  emails,
  organizationHighlightExtractions,
  organizationMentions,
  projectHighlightExtractions,
} from "@/lib/db/schema";
import { extractMailboxEmail } from "@/lib/email/address-display";
import {
  parseOrgFingerprintJson,
  parseOrgHighlightJson,
  type OrgEntityCard,
} from "@/lib/email-analysis/org-highlight-shared";
import {
  parseProjectFingerprintJson,
  parseProjectHighlightJson,
} from "@/lib/email-analysis/project-highlight-shared";
import { normalizePhone } from "@/lib/email/entity-dedup";
import {
  cardToOrgMentionCard,
  collectPaintedOrgMentionSurfaces,
  locateUniqueSurfaceSpan,
  orgMentionFingerprint,
  orgMentionHasIdentity,
  orgMentionNameKey,
  orgSurfacesMissingMentions,
  type OrgMentionCard,
} from "@/lib/organizations/mention-shared";

export type UpsertOrgMentionsResult = {
  written: number;
  skipped: number;
  skippedNoPresence: number;
  emailMissing: boolean;
};

function orgMentionAppearsInEmail(
  card: OrgMentionCard,
  email: MentionPresenceEmail,
): boolean {
  const haystack = mentionPresenceHaystack(email);
  if (!haystack.trim()) return false;
  if (textHasNameToken(haystack, card.raw_name)) return true;
  const mailbox = card.email
    ? (extractMailboxEmail(card.email) ?? card.email).toLowerCase()
    : "";
  if (mailbox.includes("@") && haystack.toLowerCase().includes(mailbox)) {
    return true;
  }
  if (card.website && haystack.toLowerCase().includes(card.website.toLowerCase())) {
    return true;
  }
  const digits = card.phone ? normalizePhone(card.phone) : "";
  if (digits.length >= 7 && normalizePhone(haystack).includes(digits)) {
    return true;
  }
  return false;
}

async function loadPresence(
  emailId: string,
): Promise<{ presence: MentionPresenceEmail; uniqueBody: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      bodyText: emails.bodyText,
      bodyHtml: emails.bodyHtml,
      bodyTextUnique: emails.bodyTextUnique,
      bodyTextStrictUnique: emails.bodyTextStrictUnique,
      fromAddress: emails.fromAddress,
      toAddresses: emails.toAddresses,
      ccAddresses: emails.ccAddresses,
      receivedAt: emails.receivedAt,
    })
    .from(emails)
    .where(eq(emails.id, emailId))
    .limit(1);
  if (!row) return null;
  const uniqueBodies = await resolveAuthoredBodiesForEvidence([row]);
  const uniqueBody = uniqueBodies.get(row.id) ?? row.bodyTextStrictUnique ?? row.bodyText;
  return {
    uniqueBody,
    presence: {
      subject: row.subject,
      bodyText: row.bodyText,
      bodyTextUnique: row.bodyTextUnique,
      bodyTextStrictUnique: uniqueBody,
      fromAddress: row.fromAddress,
      toAddresses: row.toAddresses,
      ccAddresses: row.ccAddresses,
    },
  };
}

export async function upsertOrgMentionsForEmail(params: {
  sourceEmailId: string;
  entityCards: OrgEntityCard[];
  modelId?: string | null;
  fingerprintMergeId?: string | null;
}): Promise<UpsertOrgMentionsResult> {
  const sourceEmailId = params.sourceEmailId.trim();
  if (!sourceEmailId) {
    return { written: 0, skipped: 0, skippedNoPresence: 0, emailMissing: true };
  }

  const loaded = await loadPresence(sourceEmailId);
  if (!loaded) {
    return {
      written: 0,
      skipped: params.entityCards.length,
      skippedNoPresence: 0,
      emailMissing: true,
    };
  }

  const db = getDb();
  const now = new Date().toISOString();
  let written = 0;
  let skipped = 0;
  let skippedNoPresence = 0;

  for (const raw of params.entityCards) {
    const card = cardToOrgMentionCard(raw);
    if (!card || !orgMentionHasIdentity(card)) {
      skipped += 1;
      continue;
    }
    const fingerprint = orgMentionFingerprint(card);
    if (!fingerprint.replace(/\|/g, "")) {
      skipped += 1;
      continue;
    }
    if (!orgMentionAppearsInEmail(card, loaded.presence)) {
      skipped += 1;
      skippedNoPresence += 1;
      continue;
    }

    const nameKey = orgMentionNameKey(card.raw_name);
    const span = locateUniqueSurfaceSpan(loaded.uniqueBody, card.raw_name);

    const [existing] = await db
      .select({ id: organizationMentions.id })
      .from(organizationMentions)
      .where(
        and(
          eq(organizationMentions.sourceEmailId, sourceEmailId),
          eq(organizationMentions.fingerprint, fingerprint),
        ),
      )
      .limit(1);

    const fields = {
      rawName: card.raw_name,
      nameKey,
      email: card.email,
      phone: card.phone,
      website: card.website,
      modelId: params.modelId ?? null,
      fingerprintMergeId: params.fingerprintMergeId ?? null,
      startOffset: span?.start ?? null,
      endOffset: span?.end ?? null,
      updatedAt: now,
    };

    if (existing) {
      await db
        .update(organizationMentions)
        .set(fields)
        .where(eq(organizationMentions.id, existing.id));
      written += 1;
      continue;
    }

    await db.insert(organizationMentions).values({
      id: randomUUID(),
      sourceEmailId,
      fingerprint,
      resolutionStatus: "unresolved",
      resolvedOrganizationId: null,
      resolutionReason: null,
      candidateOrganizationIdsJson: "[]",
      createdAt: now,
      ...fields,
    });
    written += 1;
  }

  return { written, skipped, skippedNoPresence, emailMissing: false };
}

function nameOnlyOrgCard(name: string): OrgEntityCard {
  return {
    name,
    organization_role: null,
    email: null,
    phone: null,
    website: null,
    aliases: [],
  };
}

async function loadPaintedOrgMentionSurfaces(
  emailId: string,
): Promise<string[]> {
  const db = getDb();
  const [orgRows, projectRows] = await Promise.all([
    db
      .select({
        extractionJson: organizationHighlightExtractions.extractionJson,
        secondPass: organizationHighlightExtractions.secondPassExtractionJson,
        thirdPass: organizationHighlightExtractions.thirdPassExtractionJson,
      })
      .from(organizationHighlightExtractions)
      .where(eq(organizationHighlightExtractions.emailId, emailId)),
    db
      .select({
        extractionJson: projectHighlightExtractions.extractionJson,
        secondPass: projectHighlightExtractions.secondPassExtractionJson,
        thirdPass: projectHighlightExtractions.thirdPassExtractionJson,
      })
      .from(projectHighlightExtractions)
      .where(eq(projectHighlightExtractions.emailId, emailId)),
  ]);

  const orgNames: string[] = [];
  const orgCardNames: Array<string | null> = [];
  for (const row of orgRows) {
    orgNames.push(
      ...parseOrgHighlightJson(row.extractionJson).organization_names,
    );
    if (row.secondPass) {
      orgNames.push(
        ...parseOrgHighlightJson(row.secondPass).organization_names,
      );
    }
    if (row.thirdPass) {
      orgCardNames.push(
        ...parseOrgFingerprintJson(row.thirdPass).entity_cards.map(
          (card) => card.name,
        ),
      );
    }
  }

  const contractors: string[] = [];
  const projectCardContractors: Array<string | null> = [];
  for (const row of projectRows) {
    contractors.push(
      ...parseProjectHighlightJson(row.extractionJson).contractors,
    );
    if (row.secondPass) {
      contractors.push(
        ...parseProjectHighlightJson(row.secondPass).contractors,
      );
    }
    if (row.thirdPass) {
      projectCardContractors.push(
        ...parseProjectFingerprintJson(row.thirdPass).entity_cards.map(
          (card) => card.contractor,
        ),
      );
    }
  }

  return collectPaintedOrgMentionSurfaces({
    orgNames,
    orgCardNames,
    contractors,
    projectCardContractors,
  });
}

/**
 * Persist name-only mentions for harvest-painted org needles that pass-3
 * cards missed (contractor-as-org, extraction names without a fingerprint).
 * Does not resolve. Returns how many rows were written.
 */
export async function upsertPaintedOrgMentionSurfacesForEmail(
  emailId: string,
): Promise<number> {
  const sourceEmailId = emailId.trim();
  if (!sourceEmailId) return 0;

  const surfaces = await loadPaintedOrgMentionSurfaces(sourceEmailId);
  if (surfaces.length === 0) return 0;

  const db = getDb();
  const existing = await db
    .select({ nameKey: organizationMentions.nameKey })
    .from(organizationMentions)
    .where(eq(organizationMentions.sourceEmailId, sourceEmailId));

  const missing = orgSurfacesMissingMentions(
    surfaces,
    existing.map((row) => row.nameKey),
  );
  if (missing.length === 0) return 0;

  const result = await upsertOrgMentionsForEmail({
    sourceEmailId,
    entityCards: missing.map(nameOnlyOrgCard),
  });
  return result.written;
}

/** GET-path self-heal: persist missing painted surfaces and resolve candidates. */
export async function ensurePaintedOrgMentionSurfacesForEmail(
  emailId: string,
): Promise<number> {
  const written = await upsertPaintedOrgMentionSurfacesForEmail(emailId);
  if (written <= 0) return 0;
  const { resolveOrgMentions } = await import(
    "@/lib/organizations/mention-resolve"
  );
  await resolveOrgMentions({ emailIds: [emailId] });
  return written;
}
