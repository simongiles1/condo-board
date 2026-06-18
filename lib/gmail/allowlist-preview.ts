import { buildAllowlistQuery } from "./queries";
import { getGmailClient } from "./client";
import { getQueryMatchCounts } from "./thread-search";

export type AllowlistImportPreview = {
  threadCount: number;
  emailCount: number;
};

/** Estimate allowlist-matching mail in personal Gmail (same query as Sync now). */
export async function getAllowlistImportPreview(
  addresses: string[],
): Promise<AllowlistImportPreview | null> {
  const normalized = [
    ...new Set(
      addresses
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.includes("@")),
    ),
  ];

  if (normalized.length === 0) {
    return { threadCount: 0, emailCount: 0 };
  }

  try {
    const { gmail } = await getGmailClient("personal_backfill");
    const query = buildAllowlistQuery(normalized);
    return await getQueryMatchCounts(gmail, query);
  } catch (error) {
    console.warn("[allowlist-preview] personal Gmail unavailable", error);
    return null;
  }
}
