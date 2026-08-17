/**
 * IBM watsonx Docling spend summary: env key slots + billed pages.
 */

import { desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  doclingBackfillRuns,
  ibmDoclingAccounts,
} from "@/lib/db/schema";
import { summarizeDoclingBackfillCorpus } from "@/lib/email/docling-lab";
import { listIbmDoclingCredentials } from "@/lib/email/docling-ibm";
import {
  IBM_DOCLING_TRIAL_PAGES,
  ibmDoclingUsdPerPage,
} from "@/lib/email/docling-provider";
import { syncIbmDoclingSlotsFromEnv } from "@/lib/email/ibm-docling-slots";
import {
  ibmTrialCoverage,
  type IbmTrialCoverage,
} from "@/lib/email/ibm-docling-spend-shared";

function parseCostUsd(value: string | null | undefined): number {
  if (!value?.trim()) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export type IbmDoclingAccountRecord = {
  id: string;
  label: string;
  envSlot: number | null;
  instanceHint: string | null;
  trialPages: number;
  notes: string | null;
  isActive: boolean;
  exhaustedAt: string | null;
  exhaustedReason: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  pagesUsed: number;
  costUsd: number;
  pagesRemaining: number;
  inEnv: boolean;
};

export type IbmDoclingSpendSummary = {
  usdPerPage: number;
  trialPages: number;
  billedPages: number;
  billedUsd: number;
  textRoutePages: number;
  remainingPages: number;
  remainingUsd: number;
  remainingAsOf: string | null;
  keyCount: number;
  activeSlot: number | null;
  coverage: IbmTrialCoverage;
  accounts: IbmDoclingAccountRecord[];
};

async function remainingIbmPages(): Promise<{
  remainingPages: number;
  remainingAsOf: string | null;
  textRoutePages: number;
}> {
  const db = getDb();
  const corpus = await summarizeDoclingBackfillCorpus();
  const [latest] = await db
    .select({
      corpusUncachedPages: doclingBackfillRuns.corpusUncachedPages,
      completedDoclingPages: doclingBackfillRuns.completedDoclingPages,
      startedAt: doclingBackfillRuns.startedAt,
    })
    .from(doclingBackfillRuns)
    .where(eq(doclingBackfillRuns.doclingProvider, "ibm"))
    .orderBy(desc(doclingBackfillRuns.startedAt))
    .limit(1);

  if (!latest || latest.corpusUncachedPages <= 0) {
    return {
      remainingPages: corpus.uncachedDoclingPages,
      remainingAsOf: null,
      textRoutePages: corpus.textRoutePages,
    };
  }

  return {
    remainingPages: Math.max(
      0,
      latest.corpusUncachedPages - latest.completedDoclingPages,
    ),
    remainingAsOf: latest.startedAt,
    textRoutePages: corpus.textRoutePages,
  };
}

export async function getIbmDoclingSpendSummary(): Promise<IbmDoclingSpendSummary> {
  await syncIbmDoclingSlotsFromEnv();
  const db = getDb();
  const usdPerPage = ibmDoclingUsdPerPage();
  const creds = listIbmDoclingCredentials();
  const envSlots = new Set(creds.map((c) => c.slot));
  const [accounts, remaining] = await Promise.all([
    db.select().from(ibmDoclingAccounts).orderBy(sql`env_slot asc nulls last`),
    remainingIbmPages(),
  ]);

  const records: IbmDoclingAccountRecord[] = accounts.map((row) => {
    const pagesUsed = row.billedPages || 0;
    return {
      id: row.id,
      label: row.label,
      envSlot: row.envSlot,
      instanceHint: row.instanceHint,
      trialPages: row.trialPages,
      notes: row.notes,
      isActive: row.isActive,
      exhaustedAt: row.exhaustedAt,
      exhaustedReason: row.exhaustedReason,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      pagesUsed,
      costUsd: parseCostUsd(row.billedUsd),
      pagesRemaining: Math.max(0, row.trialPages - pagesUsed),
      inEnv: row.envSlot != null && envSlots.has(row.envSlot),
    };
  });

  const billedPages = records.reduce((n, row) => n + row.pagesUsed, 0);
  const billedUsd = records.reduce((n, row) => n + row.costUsd, 0);
  const live = records.filter((row) => !row.archivedAt);
  const coverage = ibmTrialCoverage({
    remainingPages: remaining.remainingPages,
    accounts: live.map((account) => ({
      archived: Boolean(account.exhaustedAt),
      trialPages: account.trialPages,
      pagesUsed: account.pagesUsed,
    })),
    usdPerPage,
  });

  return {
    usdPerPage,
    trialPages: IBM_DOCLING_TRIAL_PAGES,
    billedPages,
    billedUsd,
    textRoutePages: remaining.textRoutePages,
    remainingPages: remaining.remainingPages,
    remainingUsd: remaining.remainingPages * usdPerPage,
    remainingAsOf: remaining.remainingAsOf,
    keyCount: creds.length,
    activeSlot: live.find((row) => row.isActive)?.envSlot ?? creds[0]?.slot ?? null,
    coverage,
    accounts: records,
  };
}
