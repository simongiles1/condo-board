import {
  prepareContactExtractItemsForEmails,
  prepareContactExtractItemsForThread,
  type PreparedContactExtractItem,
} from "@/lib/email-analysis/contact-highlight-prepare";

/** Payload shape accepted by POST /api/analysis/extract-projects. */
export type PreparedProjectExtractItem = PreparedContactExtractItem;

/**
 * Build extract-projects items for a thread (oldest → newest) using the
 * same unique-body + display excerpt rules as contact extraction.
 */
export const prepareProjectExtractItemsForThread =
  prepareContactExtractItemsForThread;

/**
 * Build extract-projects items for specific emails. Unique bodies are
 * computed against all siblings in each email’s thread.
 */
export const prepareProjectExtractItemsForEmails =
  prepareContactExtractItemsForEmails;
