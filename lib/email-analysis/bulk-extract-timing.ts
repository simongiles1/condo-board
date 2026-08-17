export type BulkExtractRunTimingSource = {
  status: "running" | "completed" | "failed" | "cancelled";
  completedEmails: number;
  totalEmails: number;
  stintStartedAt: string | null;
  completedEmailsAtStintStart: number;
  activeElapsedMs: number;
};

export type BulkExtractTimingSnapshot = {
  activeMs: number;
  stintMs: number;
  stintEmails: number;
  isRunning: boolean;
};

export type BulkExtractRateEstimate = {
  emailsPerMinute: number;
  secondsPerEmail: number;
  etaMs: number | null;
};

export function getBulkExtractTimingSnapshot(
  run: BulkExtractRunTimingSource,
  now = Date.now(),
): BulkExtractTimingSnapshot {
  const isRunning = run.status === "running";
  const stintStartMs = run.stintStartedAt
    ? Date.parse(run.stintStartedAt)
    : Number.NaN;
  const stintMs =
    isRunning && Number.isFinite(stintStartMs)
      ? Math.max(0, now - stintStartMs)
      : 0;
  const activeMs = run.activeElapsedMs + stintMs;
  const stintEmails = Math.max(
    0,
    run.completedEmails - run.completedEmailsAtStintStart,
  );

  return { activeMs, stintMs, stintEmails, isRunning };
}

/** Rate and ETA from the current stint only — not lifetime totals. */
export function estimateBulkExtractRate(params: {
  stintMs: number;
  stintEmails: number;
  totalEmails: number;
  completedEmails: number;
}): BulkExtractRateEstimate {
  const { stintMs, stintEmails, totalEmails, completedEmails } = params;
  const remaining = Math.max(0, totalEmails - completedEmails);

  if (stintEmails <= 0 || stintMs < 1000) {
    return { emailsPerMinute: 0, secondsPerEmail: 0, etaMs: null };
  }

  const emailsPerMs = stintEmails / stintMs;
  const emailsPerMinute = emailsPerMs * 60_000;
  const secondsPerEmail = stintMs / stintEmails / 1000;
  const etaMs = remaining > 0 ? remaining / emailsPerMs : 0;

  return { emailsPerMinute, secondsPerEmail, etaMs };
}

export function formatBulkExtractDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatBulkExtractRate(emailsPerMinute: number): string {
  if (!Number.isFinite(emailsPerMinute) || emailsPerMinute <= 0) {
    return "—";
  }
  if (emailsPerMinute >= 10) {
    return `${emailsPerMinute.toFixed(1)} emails/min`;
  }
  return `${emailsPerMinute.toFixed(2)} emails/min`;
}

export function formatBulkExtractEta(etaMs: number | null): string {
  if (etaMs === null) return "—";
  if (etaMs <= 0) return "Finishing…";
  if (etaMs < 60_000) return "< 1 min left";
  return `~${formatBulkExtractDuration(etaMs)} left`;
}
