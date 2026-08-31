/**
 * Incremental registry queue: ingest after pass 4, mention-ordered backfill,
 * and optional conflict sweep for shared mailboxes.
 *
 * Pass-4 ingest always runs through a process-wide serial chain so parallel
 * bulk thread workers cannot shortlist/apply against stale registry snapshots
 * at the same time.
 */

import { desc, eq } from "drizzle-orm";

import { coalesceWeakEmailDuplicatePersons } from "@/lib/contacts/registry-apply";
import { cleanupSharedMailboxRegistry } from "@/lib/contacts/registry-cleanup";
import { ingestFingerprintMergeIntoRegistry } from "@/lib/contacts/registry-ingest";
import { resolveContactMentionsForStrongCards } from "@/lib/contacts/mention-resolve";
import { getDb } from "@/lib/db";
import {
  contactFingerprintMerges,
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
      if (result.status !== "failed" && params.emailIds.length > 0) {
        try {
          const resolved = await resolveContactMentionsForStrongCards({
            emailIds: params.emailIds,
            cards: params.entityCards ?? [],
          });
          console.info("[contact-mentions] resolve after ingest", {
            mergeId: params.mergeId,
            ...resolved,
          });
        } catch (error) {
          console.error("[contact-mentions] resolve after ingest failed", {
            mergeId: params.mergeId,
            error,
          });
        }
      }
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
 * Sweep: rebuild shared-mailbox occupancy from named evidence so the latest
 * occupant is "present", not the highest-mention former manager.
 */
export async function sweepSharedMailboxConflicts(_params?: {
  modelId?: string | null;
  limit?: number;
}): Promise<{ emailsSwept: number; decisions: number; personsMerged: number }> {
  const cleanup = await cleanupSharedMailboxRegistry({
    dryRun: false,
    emailFilter: null,
  });

  return {
    emailsSwept: cleanup.emailsConsidered,
    decisions: cleanup.occupancyRowsUpdated,
    personsMerged: cleanup.duplicatesMerged,
  };
}
