import {
  prepareContactExtractItemsForEmails,
  prepareContactExtractItemsForThread,
  type PreparedContactExtractItem,
} from "@/lib/email-analysis/contact-highlight-prepare";

/** Payload shape accepted by POST /api/analysis/extract-todos. */
export type PreparedTodoExtractItem = PreparedContactExtractItem;

/**
 * Build extract-todos items for a thread (oldest → newest) using the
 * same unique-body + display excerpt rules as contact extraction.
 */
export const prepareTodoExtractItemsForThread =
  prepareContactExtractItemsForThread;

/**
 * Build extract-todos items for specific emails. Unique bodies are
 * computed against all siblings in each email’s thread.
 */
export const prepareTodoExtractItemsForEmails =
  prepareContactExtractItemsForEmails;
