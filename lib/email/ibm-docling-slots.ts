/**
 * Persist IBM env-slot usage and exhaustion. Keys stay in .env.local.
 */

import { createHash, randomUUID } from "crypto";
import { and, asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { ibmDoclingAccounts } from "@/lib/db/schema";
import {
  listIbmDoclingCredentials,
  type IbmDoclingCredential,
} from "@/lib/email/docling-ibm";
import {
  IBM_DOCLING_TRIAL_PAGES,
  ibmDoclingCostUsd,
} from "@/lib/email/docling-provider";

function nowIso(): string {
  return new Date().toISOString();
}

function keyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

export function ibmInstanceHint(url: string): string {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split("/").filter(Boolean);
    return parts[parts.length - 1]?.slice(0, 48) || url.slice(0, 48);
  } catch {
    return url.replace(/^https?:\/\//, "").slice(0, 48);
  }
}

const memoryExhausted = new Set<number>();
let slotsSynced = false;

function createAsyncMutex() {
  let tail: Promise<void> = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

const slotLock = createAsyncMutex();

export async function syncIbmDoclingSlotsFromEnv(): Promise<void> {
  const creds = listIbmDoclingCredentials();
  const db = getDb();
  const now = nowIso();
  const existing = await db
    .select()
    .from(ibmDoclingAccounts)
    .orderBy(asc(ibmDoclingAccounts.envSlot), asc(ibmDoclingAccounts.createdAt));

  const bySlot = new Map<number, (typeof existing)[number]>();
  for (const row of existing) {
    if (row.envSlot != null) bySlot.set(row.envSlot, row);
    if (row.envSlot != null && row.exhaustedAt) {
      memoryExhausted.add(row.envSlot);
    }
  }

  const liveSlots = new Set(creds.map((c) => c.slot));
  const firstLive =
    creds.find((c) => !memoryExhausted.has(c.slot))?.slot ?? null;

  for (const cred of creds) {
    const fingerprint = keyFingerprint(cred.apiKey);
    const hint = ibmInstanceHint(cred.url);
    const row = bySlot.get(cred.slot);
    const keyChanged = row?.keyFingerprint && row.keyFingerprint !== fingerprint;
    if (keyChanged) memoryExhausted.delete(cred.slot);

    const exhaustedAt = keyChanged ? null : row?.exhaustedAt ?? null;
    if (exhaustedAt) memoryExhausted.add(cred.slot);

    const isActive =
      firstLive != null &&
      cred.slot === firstLive &&
      !exhaustedAt &&
      !memoryExhausted.has(cred.slot);

    if (!row) {
      await db.insert(ibmDoclingAccounts).values({
        id: randomUUID(),
        label: `Key ${cred.slot}`,
        envSlot: cred.slot,
        instanceHint: hint,
        keyFingerprint: fingerprint,
        trialPages: IBM_DOCLING_TRIAL_PAGES,
        notes: null,
        isActive,
        exhaustedAt: null,
        exhaustedReason: null,
        billedPages: 0,
        billedUsd: "0",
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    await db
      .update(ibmDoclingAccounts)
      .set({
        label: row.label.startsWith("Trial") ? `Key ${cred.slot}` : row.label,
        instanceHint: hint,
        keyFingerprint: fingerprint,
        isActive,
        exhaustedAt,
        exhaustedReason: exhaustedAt ? row.exhaustedReason : null,
        archivedAt: null,
        updatedAt: now,
      })
      .where(eq(ibmDoclingAccounts.id, row.id));
  }

  for (const row of existing) {
    if (row.envSlot == null || liveSlots.has(row.envSlot)) continue;
    if (row.archivedAt) continue;
    await db
      .update(ibmDoclingAccounts)
      .set({
        isActive: false,
        archivedAt: now,
        updatedAt: now,
      })
      .where(eq(ibmDoclingAccounts.id, row.id));
  }

  const dbExhausted = await db
    .select({
      envSlot: ibmDoclingAccounts.envSlot,
      exhaustedAt: ibmDoclingAccounts.exhaustedAt,
    })
    .from(ibmDoclingAccounts);
  for (const row of dbExhausted) {
    if (row.envSlot != null && row.exhaustedAt) {
      memoryExhausted.add(row.envSlot);
    }
  }

  slotsSynced = true;
}

async function ensureSlotsSynced(): Promise<void> {
  if (!slotsSynced) await syncIbmDoclingSlotsFromEnv();
}

export async function pickLiveIbmCredential(): Promise<IbmDoclingCredential | null> {
  await ensureSlotsSynced();
  const creds = listIbmDoclingCredentials();
  return creds.find((cred) => !memoryExhausted.has(cred.slot)) ?? null;
}

export async function markIbmSlotExhausted(
  slot: number,
  reason: "quota" | "auth",
): Promise<void> {
  memoryExhausted.add(slot);
  const db = getDb();
  const now = nowIso();
  await db
    .update(ibmDoclingAccounts)
    .set({
      isActive: false,
      exhaustedAt: now,
      exhaustedReason: reason,
      updatedAt: now,
    })
    .where(eq(ibmDoclingAccounts.envSlot, slot));

  const next = listIbmDoclingCredentials().find(
    (cred) => !memoryExhausted.has(cred.slot),
  );
  if (next) {
    await db
      .update(ibmDoclingAccounts)
      .set({ isActive: true, updatedAt: now })
      .where(eq(ibmDoclingAccounts.envSlot, next.slot));
  }
}

export async function recordIbmSlotUsage(
  slot: number,
  pages: number,
): Promise<void> {
  if (pages <= 0) return;
  await ensureSlotsSynced();
  const cost = ibmDoclingCostUsd(pages);
  const db = getDb();
  await db.execute(sql`
    update ibm_docling_accounts
    set
      billed_pages = billed_pages + ${pages},
      billed_usd = (cast(billed_usd as numeric) + ${cost})::text,
      updated_at = ${nowIso()}
    where env_slot = ${slot}
  `);
}

export async function withIbmSlotLock<T>(fn: () => Promise<T>): Promise<T> {
  return slotLock(fn);
}

export async function getActiveIbmAccountId(): Promise<string | null> {
  await syncIbmDoclingSlotsFromEnv();
  const db = getDb();
  const [active] = await db
    .select({ id: ibmDoclingAccounts.id })
    .from(ibmDoclingAccounts)
    .where(
      and(
        eq(ibmDoclingAccounts.isActive, true),
        sql`${ibmDoclingAccounts.archivedAt} is null`,
      ),
    )
    .limit(1);
  if (active?.id) return active.id;
  const [any] = await db
    .select({ id: ibmDoclingAccounts.id })
    .from(ibmDoclingAccounts)
    .where(sql`${ibmDoclingAccounts.envSlot} is not null`)
    .orderBy(asc(ibmDoclingAccounts.envSlot))
    .limit(1);
  return any?.id ?? null;
}
