/**
 * Client-safe DeepSeek peak helpers for bulk extract (no database imports).
 */

import {
  CONTACT_HIGHLIGHT_MODELS,
  contactHighlightModelProvider,
  type ContactHighlightModelId,
} from "@/lib/email-analysis/contact-highlight-models";

/** Prefix for run labels while paused for DeepSeek peak pricing. */
export const BULK_EXTRACT_DEEPSEEK_PEAK_PAUSE_PREFIX =
  "Paused for DeepSeek peak pricing";

/** True when the bulk-extract model id routes to the DeepSeek provider. */
export function bulkExtractModelUsesDeepSeek(modelId: string): boolean {
  const trimmed = modelId.trim();
  if (!trimmed) return false;
  if ((CONTACT_HIGHLIGHT_MODELS as readonly string[]).includes(trimmed)) {
    return (
      contactHighlightModelProvider(trimmed as ContactHighlightModelId) ===
      "deepseek"
    );
  }
  return trimmed.toLowerCase().includes("deepseek");
}
