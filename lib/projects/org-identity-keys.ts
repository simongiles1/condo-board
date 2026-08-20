/** Organization identity names for the project minting gate (rule 3). */

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { organizationEntities } from "@/lib/db/schema";
import { normalizeProjectNameKey } from "@/lib/projects/project-multi-values";

/**
 * Normalized names of active organization registry rows.
 * Used so a project card whose work-name is actually a company is dropped.
 */
export async function loadOrganizationIdentityNameKeys(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ name: organizationEntities.name })
    .from(organizationEntities)
    .where(eq(organizationEntities.status, "active"));
  const keys = new Set<string>();
  for (const row of rows) {
    const key = normalizeProjectNameKey(row.name);
    if (key) keys.add(key);
  }
  return keys;
}
