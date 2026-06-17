/** Client-safe types and helpers for email processing stats (no DB imports). */

export type EmailProcessingStats = {
  emailId: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  processedAt: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  processingDurationMs: number | null;
  triggeredByEmail?: string | null;
};

export type ProcessedEmailSnapshot = {
  emailId: string;
  processedAt: string;
  processingCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  processingDurationMs: number | null;
  triggeredByEmail?: string | null;
};

export type InboxAnalysisQueueState = {
  processingEmailIds: string[];
  pendingEmailIds: string[];
  failedEmails: Array<{ emailId: string; error: string }>;
  /** Emails with processedAt set that are not still queued (for live badge updates). */
  processedEmails: ProcessedEmailSnapshot[];
};

export function mergeLiveProcessingStats(
  entries: EmailProcessingStats[],
  liveSnapshots: ProcessedEmailSnapshot[],
): EmailProcessingStats[] {
  const liveByEmail = new Map(
    liveSnapshots.map((entry) => [entry.emailId, entry]),
  );

  return entries.map((entry) => {
    const live = liveByEmail.get(entry.emailId);
    if (!live) return entry;

    return {
      ...entry,
      processedAt: live.processedAt,
      costUsd: live.processingCostUsd ?? entry.costUsd,
      inputTokens: live.inputTokens ?? entry.inputTokens,
      outputTokens: live.outputTokens ?? entry.outputTokens,
      processingDurationMs:
        live.processingDurationMs ?? entry.processingDurationMs,
      triggeredByEmail: live.triggeredByEmail ?? entry.triggeredByEmail,
    };
  });
}

export function sumProcessingStats(entries: EmailProcessingStats[]): {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  processingDurationMs: number;
  processedCount: number;
} {
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let processingDurationMs = 0;
  let processedCount = 0;

  for (const entry of entries) {
    if (!entry.processedAt) continue;
    processedCount += 1;
    if (entry.costUsd != null) costUsd += entry.costUsd;
    if (entry.inputTokens != null) inputTokens += entry.inputTokens;
    if (entry.outputTokens != null) outputTokens += entry.outputTokens;
    if (entry.processingDurationMs != null) {
      processingDurationMs += entry.processingDurationMs;
    }
  }

  return {
    costUsd,
    inputTokens,
    outputTokens,
    processingDurationMs,
    processedCount,
  };
}
