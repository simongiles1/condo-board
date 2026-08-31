/**
 * Ingest a thread pass-4 fingerprint merge into the global contact registry.
 * Strong-identity cards are adjudicated into people. Weak first-name cards
 * are written as contact_mentions and resolved after ingest.
 */

import { randomUUID } from "crypto";

import { eq, inArray } from "drizzle-orm";

import { adjudicateContactRegistryBatch } from "@/lib/contacts/registry-adjudicate";
import { applyAdjudicationDecisions } from "@/lib/contacts/registry-apply";
import {
  contactHoldReason,
  rewriteSharedMailboxDecision,
} from "@/lib/contacts/registry-hold";
import { loadContactRegistryPersons } from "@/lib/contacts/registry-load";
import { shortlistAgainstRegistry } from "@/lib/contacts/registry-shortlist";
import {
  filterEmailIdsWhereMentionAppears,
  loadPass3EntityCardsByEmailId,
} from "@/lib/contacts/mention-persist";
import { sourceEmailIdsForMergedCard } from "@/lib/contacts/mention-presence";
import { resolveContactMentionsForStrongCards } from "@/lib/contacts/mention-resolve";
import {
  buildBlockingKeys,
  hasStrongIdentity,
  scoreMentionWeight,
  type ContactRegistryIncomingCard,
} from "@/lib/contacts/registry-shared";
import { getDb } from "@/lib/db";
import {
  contactFingerprintMerges,
  contactRegistryIngests,
  emails,
} from "@/lib/db/schema";
import type { ContactEntityCard } from "@/lib/email-analysis/contact-highlight-shared";
import { parseContactFingerprintResult } from "@/lib/email-analysis/contact-highlight-shared";
import { isTelegramHitlReady } from "@/lib/telegram/recipients";
import { insertContactReviewItem } from "@/lib/telegram/store";
import { compactContactCandidates } from "@/lib/telegram/types";

const ADJUDICATE_BATCH_SIZE = 20;

export type RegistryIngestResult = {
  ingestId: string;
  status: "completed" | "failed" | "skipped";
  personsCreated: number;
  decisionsApplied: number;
  error: string | null;
};

function buildIncomingCards(params: {
  entityCards: ContactEntityCard[];
  datesByEmailId: Map<string, string>;
  sourceEmailIdsByIndex: string[][];
}): ContactRegistryIncomingCard[] {
  return params.entityCards.map((card, index) => {
    const sourceEmailIds = params.sourceEmailIdsByIndex[index] ?? [];
    const dateValues = sourceEmailIds
      .map((id) => params.datesByEmailId.get(id))
      .filter((value): value is string => Boolean(value))
      .sort();
    return {
      ...card,
      tempId: randomUUID(),
      sourceEmailIds,
      dateMin: dateValues[0] ?? null,
      dateMax: dateValues[dateValues.length - 1] ?? null,
      mentionWeight: scoreMentionWeight({
        sourceEmailCount: Math.max(1, sourceEmailIds.length),
        card,
      }),
      blockingKeys: buildBlockingKeys(card),
    };
  });
}

async function sourceEmailIdsForIngestCard(params: {
  card: ContactEntityCard;
  threadEmailIds: string[];
  cardsByEmailId: Map<string, ContactEntityCard[]>;
}): Promise<string[]> {
  const { attributed, missingPass3 } = sourceEmailIdsForMergedCard({
    merged: params.card,
    threadEmailIds: params.threadEmailIds,
    cardsByEmailId: params.cardsByEmailId,
  });
  if (missingPass3.length === 0) return attributed;
  const extra = await filterEmailIdsWhereMentionAppears(
    missingPass3,
    params.card,
  );
  return [...new Set([...attributed, ...extra])];
}

/**
 * Process one fingerprint merge row into the global registry (idempotent).
 */
export async function ingestFingerprintMergeIntoRegistry(params: {
  fingerprintMergeId: string;
  modelId: string;
  entityCards?: ContactEntityCard[];
  emailIds?: string[];
}): Promise<RegistryIngestResult> {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = await db
    .select()
    .from(contactRegistryIngests)
    .where(
      eq(
        contactRegistryIngests.fingerprintMergeId,
        params.fingerprintMergeId,
      ),
    )
    .limit(1);

  if (existing[0]?.status === "completed") {
    return {
      ingestId: existing[0].id,
      status: "skipped",
      personsCreated: existing[0].personsCreated,
      decisionsApplied: existing[0].decisionsApplied,
      error: null,
    };
  }

  let ingestId = existing[0]?.id ?? randomUUID();
  if (!existing[0]) {
    await db.insert(contactRegistryIngests).values({
      id: ingestId,
      fingerprintMergeId: params.fingerprintMergeId,
      modelId: params.modelId,
      status: "pending",
      personsCreated: 0,
      decisionsApplied: 0,
      error: null,
      createdAt: now,
      completedAt: null,
    });
  } else {
    await db
      .update(contactRegistryIngests)
      .set({ status: "pending", error: null })
      .where(eq(contactRegistryIngests.id, ingestId));
  }

  try {
    let entityCards = params.entityCards;
    let emailIds = params.emailIds;

    if (!entityCards || !emailIds) {
      const [mergeRow] = await db
        .select()
        .from(contactFingerprintMerges)
        .where(eq(contactFingerprintMerges.id, params.fingerprintMergeId))
        .limit(1);
      if (!mergeRow) {
        throw new Error("Fingerprint merge row not found.");
      }
      try {
        entityCards = parseContactFingerprintResult(
          JSON.parse(mergeRow.entityCardsJson),
        ).entity_cards;
      } catch {
        entityCards = [];
      }
      try {
        const parsed = JSON.parse(mergeRow.emailIdsJson) as unknown;
        emailIds = Array.isArray(parsed)
          ? parsed.filter((id): id is string => typeof id === "string")
          : [];
      } catch {
        emailIds = [];
      }
    }

    const datesByEmailId = new Map<string, string>();
    if (emailIds.length > 0) {
      const emailRows = await db
        .select({ id: emails.id, receivedAt: emails.receivedAt })
        .from(emails)
        .where(inArray(emails.id, emailIds));
      for (const row of emailRows) {
        datesByEmailId.set(row.id, row.receivedAt);
      }
    }

    const threadEmailIds = emailIds ?? [];
    const cardsByEmailId = await loadPass3EntityCardsByEmailId({
      emailIds: threadEmailIds,
      modelId: params.modelId,
    });
    const sourceEmailIdsByIndex = await Promise.all(
      (entityCards ?? []).map((card) =>
        sourceEmailIdsForIngestCard({
          card,
          threadEmailIds,
          cardsByEmailId,
        }),
      ),
    );

    const incoming = buildIncomingCards({
      entityCards: entityCards ?? [],
      datesByEmailId,
      sourceEmailIdsByIndex,
    });

    const toAdjudicate: ContactRegistryIncomingCard[] = [];
    for (const card of incoming) {
      if (hasStrongIdentity(card)) {
        toAdjudicate.push(card);
      }
    }

    toAdjudicate.sort((a, b) => b.mentionWeight - a.mentionWeight);

    let personsCreated = 0;
    let decisionsApplied = 0;

    let liveRegistry = await loadContactRegistryPersons({
      limit: 8000,
      orderByMention: true,
    });

    const holdEnabled = await isTelegramHitlReady();

    for (let i = 0; i < toAdjudicate.length; i += ADJUDICATE_BATCH_SIZE) {
      const batch = toAdjudicate.slice(i, i + ADJUDICATE_BATCH_SIZE);
      const items = batch.map((incomingCard) => ({
        incoming: incomingCard,
        candidates: shortlistAgainstRegistry(incomingCard, liveRegistry),
      }));

      const { decisions } = await adjudicateContactRegistryBatch(
        items,
        params.modelId,
      );

      const autoDecisions = [];
      const autoIncoming = [];
      const itemsByTemp = new Map(
        items.map((item) => [item.incoming.tempId, item]),
      );
      for (const decision of decisions) {
        const item = itemsByTemp.get(decision.incomingTempId);
        if (!item) continue;
        const resolved = rewriteSharedMailboxDecision({
          incoming: item.incoming,
          candidates: item.candidates,
          decision,
        });
        const holdReason = holdEnabled
          ? contactHoldReason({
              decision: resolved,
              candidates: item.candidates,
              incoming: item.incoming,
            })
          : null;
        if (holdReason) {
          await insertContactReviewItem({
            holdReason,
            fingerprintMergeId: params.fingerprintMergeId,
            payload: {
              incoming: item.incoming,
              decision: resolved,
              candidates: compactContactCandidates(item.candidates),
              modelId: params.modelId,
            },
          });
          continue;
        }
        autoDecisions.push(resolved);
        autoIncoming.push(item.incoming);
      }

      if (autoDecisions.length > 0) {
        const applied = await applyAdjudicationDecisions({
          incoming: autoIncoming,
          decisions: autoDecisions,
          modelId: params.modelId,
          fingerprintMergeId: params.fingerprintMergeId,
        });
        personsCreated += applied.personsCreated;
        decisionsApplied += applied.decisionsApplied;
      }

      liveRegistry = await loadContactRegistryPersons({
        limit: 8000,
        orderByMention: true,
      });
    }

    await db
      .update(contactRegistryIngests)
      .set({
        status: "completed",
        personsCreated,
        decisionsApplied,
        error: null,
        completedAt: new Date().toISOString(),
      })
      .where(eq(contactRegistryIngests.id, ingestId));

    if ((emailIds?.length ?? 0) > 0) {
      await resolveContactMentionsForStrongCards({
        emailIds,
        cards: entityCards ?? [],
      });
    }

    return {
      ingestId,
      status: "completed",
      personsCreated,
      decisionsApplied,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Registry ingest failed.";
    await db
      .update(contactRegistryIngests)
      .set({
        status: "failed",
        error: message,
        completedAt: new Date().toISOString(),
      })
      .where(eq(contactRegistryIngests.id, ingestId));

    return {
      ingestId,
      status: "failed",
      personsCreated: 0,
      decisionsApplied: 0,
      error: message,
    };
  }
}
