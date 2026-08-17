import {
  prepareContactExtractItemsForEmails,
  prepareContactExtractItemsForThread,
  type PreparedContactExtractItem,
} from "@/lib/email-analysis/contact-highlight-prepare";

/** Payload shape accepted by POST /api/analysis/extract-organizations. */
export type PreparedOrgExtractItem = PreparedContactExtractItem;

/**
 * Build extract-organizations items for a thread (oldest → newest) using the
 * same unique-body + display excerpt rules as contact extraction.
 */
export const prepareOrgExtractItemsForThread =
  prepareContactExtractItemsForThread;

/**
 * Build extract-organizations items for specific emails. Unique bodies are
 * computed against all siblings in each email’s thread.
 */
export const prepareOrgExtractItemsForEmails =
  prepareContactExtractItemsForEmails;
