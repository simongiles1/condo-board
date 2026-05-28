import { randomUUID } from "crypto";

import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { analysisQueue } from "@/lib/db/schema";

export type QueueUnitType = "email_message" | "email_thread" | "email_attachment";

export async function enqueueAnalysisUnit(input: {
  unitType: QueueUnitType;
  unitId: string;
}): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.insert(analysisQueue).values({
    id,
    unitType: input.unitType,
    unitId: input.unitId,
    status: "pending",
    createdAt: now,
  });

  return id;
}

export async function markQueueProcessing(queueId: string): Promise<void> {
  const db = getDb();
  await db
    .update(analysisQueue)
    .set({ status: "processing", startedAt: new Date().toISOString() })
    .where(eq(analysisQueue.id, queueId));
}

export async function markQueueDone(queueId: string): Promise<void> {
  const db = getDb();
  await db
    .update(analysisQueue)
    .set({ status: "done", finishedAt: new Date().toISOString() })
    .where(eq(analysisQueue.id, queueId));
}

export async function markQueueFailed(
  queueId: string,
  error: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(analysisQueue)
    .set({
      status: "failed",
      error,
      finishedAt: new Date().toISOString(),
    })
    .where(eq(analysisQueue.id, queueId));
}

/** Marks an email as actively processing (clears stale queue rows first). */
export async function beginEmailAnalysis(emailId: string): Promise<string> {
  const db = getDb();
  await db
    .delete(analysisQueue)
    .where(
      and(
        eq(analysisQueue.unitType, "email_message"),
        eq(analysisQueue.unitId, emailId),
        inArray(analysisQueue.status, ["pending", "processing", "failed"]),
      ),
    );

  const queueId = await enqueueAnalysisUnit({
    unitType: "email_message",
    unitId: emailId,
  });
  await markQueueProcessing(queueId);
  return queueId;
}

export async function completeEmailAnalysis(queueId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ unitId: analysisQueue.unitId })
    .from(analysisQueue)
    .where(eq(analysisQueue.id, queueId))
    .limit(1);

  await markQueueDone(queueId);

  if (row) {
    await clearFailedQueueForEmail(row.unitId);
  }
}

export async function failEmailAnalysis(
  queueId: string,
  error: string,
): Promise<void> {
  await markQueueFailed(queueId, error);
}

/** Clears non-terminal queue rows for an email (pending, processing, or stale failed). */
export async function clearActiveQueueForEmail(emailId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(analysisQueue)
    .where(
      and(
        eq(analysisQueue.unitType, "email_message"),
        eq(analysisQueue.unitId, emailId),
        inArray(analysisQueue.status, ["pending", "processing", "failed"]),
      ),
    );
}

async function clearFailedQueueForEmail(emailId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(analysisQueue)
    .where(
      and(
        eq(analysisQueue.unitType, "email_message"),
        eq(analysisQueue.unitId, emailId),
        eq(analysisQueue.status, "failed"),
      ),
    );
}

export async function enqueueEmailAnalysisPending(emailId: string): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: analysisQueue.id })
    .from(analysisQueue)
    .where(
      and(
        eq(analysisQueue.unitType, "email_message"),
        eq(analysisQueue.unitId, emailId),
        inArray(analysisQueue.status, ["pending", "processing"]),
      ),
    )
    .limit(1);

  if (existing) return;

  await enqueueAnalysisUnit({
    unitType: "email_message",
    unitId: emailId,
  });
}

export async function enqueueEmailsAnalysisPending(
  emailIds: string[],
): Promise<void> {
  for (const emailId of emailIds) {
    await enqueueEmailAnalysisPending(emailId);
  }
}
