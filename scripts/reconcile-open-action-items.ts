/**
 * Reconcile unresolved extracted action items per thread (open + stale).
 * Usage: npx tsx scripts/reconcile-open-action-items.ts
 * Optional: TODO_CLOSEOUT_MODEL=deepseek-v4-flash (harvest close-out when Gemini is unavailable)
 *
 * For harvests older than 120 days prefer: npm run closeout:archive-todos
 */
import { eq } from "drizzle-orm";

import { reconcileThreadActionItems } from "@/lib/email-analysis/action-item-reconciliation";
import { getAnalysisSettings } from "@/lib/email-analysis/settings";
import { getDb } from "@/lib/db";
import { extractedActionItems } from "@/lib/db/schema";

async function main() {
  const db = getDb();
  const settings = await getAnalysisSettings();
  const modelName =
    process.env.TODO_CLOSEOUT_MODEL?.trim() || settings.analysisModel;

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

  console.log(
    `Reconciling ${threadIds.length} thread(s) with ${modelName}...`,
  );

  let totalCompleted = 0;
  let totalSuperseded = 0;

  for (const threadId of threadIds) {
    try {
      const result = await reconcileThreadActionItems({
        threadId,
        modelName,
      });
      totalCompleted += result.completed;
      totalSuperseded += result.superseded;
      if (result.completed || result.superseded) {
        console.log(
          `  ${threadId}: completed=${result.completed}, superseded=${result.superseded}`,
        );
      }
    } catch (error) {
      console.error(
        `  ${threadId}: FAILED ${error instanceof Error ? error.message : error}`,
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
