/**
 * Reconcile open extracted action items per thread (semantic duplicate cleanup).
 * Usage: npx tsx scripts/reconcile-open-action-items.ts
 */
import { eq } from "drizzle-orm";

import { reconcileThreadActionItems } from "@/lib/email-analysis/action-item-reconciliation";
import { getAnalysisSettings } from "@/lib/email-analysis/settings";
import { getDb } from "@/lib/db";
import { extractedActionItems } from "@/lib/db/schema";

async function main() {
  const db = getDb();
  const settings = await getAnalysisSettings();

  const openRows = await db
    .select({
      threadId: extractedActionItems.emailThreadId,
    })
    .from(extractedActionItems)
    .where(eq(extractedActionItems.completed, false));

  const threadIds = [
    ...new Set(
      openRows
        .map((row) => row.threadId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  console.log(`Reconciling ${threadIds.length} thread(s) with open action items...`);

  let totalCompleted = 0;
  let totalSuperseded = 0;

  for (const threadId of threadIds) {
    const result = await reconcileThreadActionItems({
      threadId,
      modelName: settings.analysisModel,
    });
    totalCompleted += result.completed;
    totalSuperseded += result.superseded;
    if (result.completed || result.superseded) {
      console.log(
        `  ${threadId}: completed=${result.completed}, superseded=${result.superseded}`,
      );
    }
  }

  console.log(
    `Done. completed=${totalCompleted}, superseded=${totalSuperseded}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
