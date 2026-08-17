/**
 * Incremental registry queue: ingest after pass 4, mention-ordered backfill,
 * and optional conflict sweep for shared mailboxes.
 *
 * Pass-4 ingest always runs through a process-wide serial chain so parallel
 * bulk thread workers cannot shortlist/apply against stale registry snapshots
 * at the same time.
 */

import { desc, eq, isNull } from "drizzle-orm";

import { adjudicateContactRegistryBatch } from "@/lib/contacts/registry-adjudicate";
import {
  coalesceWeakEmailDuplicatePersons,
  refreshEmailIndex,
} from "@/lib/contacts/registry-apply";
import { ingestFingerprintMergeIntoRegistry } from "@/lib/contacts/registry-ingest";
import { loadContactRegistryPersons } from "@/lib/contacts/registry-load";
import { shortlistAgainstRegistry } from "@/lib/contacts/registry-shortlist";
import {
  buildBlockingKeys,
  normalizeContactRegistryEmail,
  scoreMentionWeight,
  type ContactRegistryIncomingCard,
} from "@/lib/contacts/registry-shared";
import { getDb } from "@/lib/db";
import {
  contactFingerprintMerges,
  contactPersonEmails,
  contactRegistryIngests,
} from "@/lib/db/schema";
import { parseContactFingerprintResult } from "@/lib/email-analysis/contact-highlight-shared";
import type { ContactHighlightModelId } from "@/lib/email-analysis/contact-highlight-models";

/** Single-flight chain: one registry ingest at a time in this Node process. */
let registryIngestChain: Promise<void> = Promise.resolve();

function runSerialRegistryIngest<T>(fn: () => Promise<T>): Promise<T> {
  const result = registryIngestChain.then(fn, fn);
  registryIngestChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Hook after pass-4 save: push this merge into the global registry.
 * Failures are returned, not thrown — extraction UX should still succeed.
 * Concurrent callers wait their turn on the serial ingest chain.
 */
export async function enqueueRegistryIngestAfterPass4(params: {
  mergeId: string | null;
  modelId: ContactHighlightModelId;
  entityCards: Parameters<
    typeof ingestFingerprintMergeIntoRegistry
  >[0]["entityCards"];
  emailIds: string[];
}): Promise<Awaited<ReturnType<typeof ingestFingerprintMergeIntoRegistry>> | null> {
  if (!params.mergeId) return null;
  return runSerialRegistryIngest(async () => {
    const started = Date.now();
    try {
      const result = await ingestFingerprintMergeIntoRegistry({
        fingerprintMergeId: params.mergeId!,
        modelId: params.modelId,
        entityCards: params.entityCards,
        emailIds: params.emailIds,
      });
      console.info("[contact-registry] ingest finished", {
        mergeId: params.mergeId,
        status: result.status,
        personsCreated: result.personsCreated,
        decisionsApplied: result.decisionsApplied,
        ms: Date.now() - started,
      });
      return result;
    } catch (error) {
      console.error("[contact-registry] ingest after pass 4 failed", {
        mergeId: params.mergeId,
        ms: Date.now() - started,
        error,
      });
      return {
        ingestId: "",
        status: "failed",
        personsCreated: 0,
        decisionsApplied: 0,
        error:
          error instanceof Error ? error.message : "Registry ingest failed.",
      };
    }
  });
}

/** Backfill: ingest unprocessed fingerprint merges, highest card-count first. */
export async function processPendingRegistryIngests(params?: {
  limit?: number;
}): Promise<{
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
}> {
  const limit = params?.limit ?? 25;
  const db = getDb();

  const ingested = await db
    .select({
      fingerprintMergeId: contactRegistryIngests.fingerprintMergeId,
      status: contactRegistryIngests.status,
    })
    .from(contactRegistryIngests);

  const done = new Set(
    ingested
      .filter((r) => r.status === "completed")
      .map((r) => r.fingerprintMergeId),
  );

  const merges = await db
    .select()
    .from(contactFingerprintMerges)
    .orderBy(desc(contactFingerprintMerges.updatedAt))
    .limit(200);

  // Prefer merges with more cards (proxy for mention density / Pareto).
  const pending = merges
    .filter((m) => !done.has(m.id) && !m.error)
    .map((m) => {
      let cardCount = 0;
      try {
        cardCount = parseContactFingerprintResult(
          JSON.parse(m.entityCardsJson),
        ).entity_cards.length;
      } catch {
        cardCount = 0;
      }
      return { merge: m, cardCount };
    })
    .sort((a, b) => b.cardCount - a.cardCount)
    .slice(0, limit);

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const { merge } of pending) {
    const result = await runSerialRegistryIngest(() =>
      ingestFingerprintMergeIntoRegistry({
        fingerprintMergeId: merge.id,
        modelId: merge.modelId,
      }),
    );
    if (result.status === "completed") completed += 1;
    else if (result.status === "failed") failed += 1;
    else skipped += 1;
  }

  // Pending ingest can lock a wrong primary (Peter) under keep-existing prefer;
  // re-apply evidence majority + alias prune after each backfill batch.
  if (completed > 0) {
    await coalesceWeakEmailDuplicatePersons();
  }

  return {
    processed: pending.length,
    completed,
    failed,
    skipped,
  };
}

/**
 * Sweep: shared emails with multiple open-ended occupants → AI link_email
 * cleanup, then refresh current person index.
 */
export async function sweepSharedMailboxConflicts(params?: {
  modelId?: string | null;
  limit?: number;
}): Promise<{ emailsSwept: number; decisions: number }> {
  const db = getDb();
  const limit = params?.limit ?? 20;

  const openRows = await db
    .select()
    .from(contactPersonEmails)
    .where(isNull(contactPersonEmails.validTo));

  const byEmail = new Map<string, typeof openRows>();
  for (const row of openRows) {
    const key = normalizeContactRegistryEmail(row.email);
    const list = byEmail.get(key) ?? [];
    list.push(row);
    byEmail.set(key, list);
  }

  const conflicts = [...byEmail.entries()]
    .filter(([, rows]) => {
      const personIds = new Set(rows.map((r) => r.personId));
      return personIds.size > 1;
    })
    .slice(0, limit);

  if (conflicts.length === 0) {
    return { emailsSwept: 0, decisions: 0 };
  }

  const registry = await loadContactRegistryPersons({
    limit: 8000,
    orderByMention: true,
  });
  const personById = new Map(registry.map((p) => [p.id, p]));

  let decisions = 0;
  const touchedEmails: string[] = [];

  for (const [email, rows] of conflicts) {
    const persons = rows
      .map((r) => personById.get(r.personId))
      .filter(Boolean);
    if (persons.length < 2) continue;

    // Build synthetic incoming from the highest-mention occupant.
    persons.sort((a, b) => (b!.mentionWeight ?? 0) - (a!.mentionWeight ?? 0));
    const primary = persons[0]!;
    const incoming: ContactRegistryIncomingCard = {
      tempId: `sweep:${email}:${primary.id}`,
      first_name: primary.firstName,
      last_name: primary.lastName,
      email,
      phone: primary.phones[0]?.phone ?? null,
      job_title: primary.titles[0]?.title ?? null,
      sourceEmailIds: [],
      dateMin: rows
        .map((r) => r.validFrom)
        .filter(Boolean)
        .sort()[0] ?? null,
      dateMax: null,
      mentionWeight: scoreMentionWeight({
        sourceEmailCount: Math.max(1, primary.mentionWeight),
        card: {
          first_name: primary.firstName,
          last_name: primary.lastName,
          email,
          phone: primary.phones[0]?.phone ?? null,
          job_title: primary.titles[0]?.title ?? null,
        },
      }),
      blockingKeys: buildBlockingKeys({
        first_name: primary.firstName,
        last_name: primary.lastName,
        email,
        phone: primary.phones[0]?.phone ?? null,
      }),
    };

    const candidates = shortlistAgainstRegistry(
      incoming,
      registry.filter((p) => p.id !== primary.id),
    );

    const { decisions: batchDecisions } = await adjudicateContactRegistryBatch(
      [{ incoming, candidates }],
      params?.modelId,
    );

    // Only apply link_email / keep_separate style outcomes for sweep;
    // skip creating duplicate persons from keep_separate on synthetic cards.
    for (const decision of batchDecisions) {
      if (decision.action === "link_email" && decision.targetPersonId) {
        const closeAt =
          decision.validFrom ?? new Date().toISOString().slice(0, 10);
        for (const row of rows) {
          if (row.personId === decision.targetPersonId) continue;
          if (row.validTo != null) continue;
          // Keep primary (highest mention) open; close others.
          if (row.personId === primary.id) continue;
          await db
            .update(contactPersonEmails)
            .set({
              validTo: closeAt,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(contactPersonEmails.id, row.id));
          decisions += 1;
        }
      }
    }

    touchedEmails.push(email);
  }

  if (touchedEmails.length > 0) {
    await refreshEmailIndex(touchedEmails);
  }

  const coalesce = await coalesceWeakEmailDuplicatePersons();

  return {
    emailsSwept: conflicts.length,
    decisions,
    personsMerged: coalesce.merged,
  };
}
