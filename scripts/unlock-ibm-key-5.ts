/**
 * One-time: un-exhaust key 5 (false-positive) and retire key 3 (401 / 4999/5000).
 * Safe to run multiple times.
 */
import { eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { ibmDoclingAccounts } from "@/lib/db/schema";
import { clearIbmSlotRunSkips } from "@/lib/email/ibm-docling-slots";

async function main() {
  const db = getDb();
  const now = new Date().toISOString();

  await db
    .update(ibmDoclingAccounts)
    .set({
      exhaustedAt: now,
      exhaustedReason: "auth",
      isActive: false,
      updatedAt: now,
    })
    .where(eq(ibmDoclingAccounts.envSlot, 3));

  await db
    .update(ibmDoclingAccounts)
    .set({
      exhaustedAt: null,
      exhaustedReason: null,
      isActive: true,
      updatedAt: now,
    })
    .where(eq(ibmDoclingAccounts.envSlot, 5));

  await db
    .update(ibmDoclingAccounts)
    .set({ isActive: false, updatedAt: now })
    .where(sql`env_slot is not null and env_slot <> 5`);

  clearIbmSlotRunSkips();

  const rows = await db.select().from(ibmDoclingAccounts);
  console.log(
    JSON.stringify(
      rows.map((r) => ({
        slot: r.envSlot,
        exhausted: r.exhaustedAt,
        active: r.isActive,
        pages: r.billedPages,
      })),
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
