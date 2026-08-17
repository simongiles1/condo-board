import {
  prepareContactExtractItemsForEmails,
  prepareContactExtractItemsForThread,
  type PreparedContactExtractItem,
} from "@/lib/email-analysis/contact-highlight-prepare";

/** Payload shape accepted by POST /api/analysis/extract-events. */
export type PreparedEventExtractItem = PreparedContactExtractItem;

/**
 * Build extract-events items for a thread (oldest → newest) using the
 * same unique-body + display excerpt rules as contact extraction.
 */
export const prepareEventExtractItemsForThread =
  prepareContactExtractItemsForThread;

/**
 * Build extract-events items for specific emails. Unique bodies are
 * computed against all siblings in each email’s thread.
 */
export const prepareEventExtractItemsForEmails =
  prepareContactExtractItemsForEmails;
