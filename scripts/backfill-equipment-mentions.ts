import { readFileSync } from "fs";
import pg from "pg";

import { reconcileExistingThreadEquipment } from "../lib/email-analysis/equipment-reconciliation";
import { backfillEquipmentMentionsForSource } from "../lib/email-analysis/persist";
import { getAnalysisSettings } from "../lib/email-analysis/settings";
import { validateEmailExtraction } from "../lib/email-analysis/schema";

function loadDatabaseUrl(): string {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        return trimmed.slice("DATABASE_URL=".length).trim();
      }
    }
  } catch {
    // optional when env is already set
  }

  return (
    process.env.DATABASE_URL ??
    "postgresql://condo:condo@localhost:5433/condo_board"
  );
}

async function main() {
  process.env.DATABASE_URL = loadDatabaseUrl();

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  const { rows } = await client.query<{
    id: string;
    raw_extraction_json: string;
  }>(`
    SELECT id, raw_extraction_json
    FROM extraction_sources
    WHERE raw_extraction_json::jsonb->'equipment_mentions' IS NOT NULL
      AND jsonb_array_length(raw_extraction_json::jsonb->'equipment_mentions') > 0
    ORDER BY processed_at ASC
  `);

  let backfilled = 0;

  for (const row of rows) {
    const { document } = validateEmailExtraction(
      JSON.parse(row.raw_extraction_json),
    );
    backfilled += await backfillEquipmentMentionsForSource({
      sourceId: row.id,
      document,
    });
  }

  const { rows: threadRows } = await client.query<{ thread_id: string }>(`
    SELECT DISTINCT email_thread_id AS thread_id
    FROM extraction_sources
    WHERE email_thread_id IS NOT NULL
      AND raw_extraction_json::jsonb->'equipment_mentions' IS NOT NULL
      AND jsonb_array_length(raw_extraction_json::jsonb->'equipment_mentions') > 0
  `);

  await client.end();

  const settings = await getAnalysisSettings();
  let reconciledThreads = 0;

  for (const row of threadRows) {
    if (!row.thread_id) continue;
    try {
      const result = await reconcileExistingThreadEquipment({
        threadId: row.thread_id,
        modelName: settings.analysisModel,
      });
      if (result.calls.length > 0) {
        reconciledThreads += 1;
      }
    } catch (error) {
      console.error("[backfill-equipment-mentions:reconcile]", {
        threadId: row.thread_id,
        error: error instanceof Error ? error.message : "Reconciliation failed",
      });
    }
  }

  const verifyClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  await verifyClient.connect();

  const [{ maintenance_events, equipment_assets }] = (
    await verifyClient.query(`
      SELECT
        (SELECT COUNT(*)::int FROM maintenance_events) AS maintenance_events,
        (SELECT COUNT(*)::int FROM equipment_assets) AS equipment_assets
    `)
  ).rows as Array<{ maintenance_events: number; equipment_assets: number }>;

  await verifyClient.end();

  console.info(
    "[backfill-equipment-mentions:complete]",
    JSON.stringify(
      {
        sourcesProcessed: rows.length,
        equipmentMentionsBackfilled: backfilled,
        threadsReconciled: reconciledThreads,
        maintenance_events,
        equipment_assets,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[backfill-equipment-mentions:fatal]", error);
  process.exit(1);
});
