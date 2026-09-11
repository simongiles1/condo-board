export function shouldSendOauthRelinkRemind(input: {
  connectedAt: string | null;
  remindAfterDays: number;
  lastRemindedAt: string | null;
  nowMs?: number;
}): boolean {
  if (!input.connectedAt) return false;
  const connected = Date.parse(input.connectedAt);
  if (!Number.isFinite(connected)) return false;
  const days = Math.max(1, input.remindAfterDays);
  const now = input.nowMs ?? Date.now();
  if (now - connected < days * 24 * 60 * 60 * 1000) return false;
  if (!input.lastRemindedAt) return true;
  const reminded = Date.parse(input.lastRemindedAt);
  if (!Number.isFinite(reminded)) return true;
  return reminded < connected;
}
