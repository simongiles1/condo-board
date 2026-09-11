import { extractMailboxEmail } from "@/lib/email/address-display";

export type IngestParticipantSource = {
  fromAddress: string;
  toAddresses: string[] | string;
  ccAddresses: string[] | string;
};

function parseAddressList(raw: string[] | string): string[] {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function normalizeParticipantEmail(raw: string | null | undefined): string | null {
  const mailbox = extractMailboxEmail(raw) ?? raw?.trim().toLowerCase() ?? "";
  const email = mailbox.trim().toLowerCase();
  if (!email || !email.includes("@") || email === "unknown@unknown") {
    return null;
  }
  return email;
}

/** Unique From/To/CC mailboxes on newly ingested messages. */
export function collectParticipantEmails(
  rows: IngestParticipantSource[],
): string[] {
  const found = new Set<string>();
  for (const row of rows) {
    const participants = [
      row.fromAddress,
      ...parseAddressList(row.toAddresses),
      ...parseAddressList(row.ccAddresses),
    ];
    for (const raw of participants) {
      const email = normalizeParticipantEmail(raw);
      if (email) found.add(email);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

export function filterAllowlistCandidates(input: {
  participants: string[];
  allowlist: string[];
  blocklist: string[];
}): string[] {
  const allow = new Set(input.allowlist.map((email) => email.trim().toLowerCase()));
  const blocked = new Set(
    input.blocklist.map((email) => email.trim().toLowerCase()),
  );
  return input.participants.filter(
    (email) => !allow.has(email) && !blocked.has(email),
  );
}

export function shouldRemindAllowlistTimeout(input: {
  waitingSinceIso: string;
  timeoutHours: number;
  reminderSentAt: string | null;
  nowMs?: number;
}): boolean {
  if (input.reminderSentAt) return false;
  const started = Date.parse(input.waitingSinceIso);
  if (!Number.isFinite(started)) return false;
  const hours = Math.max(1, input.timeoutHours);
  const now = input.nowMs ?? Date.now();
  return now - started >= hours * 60 * 60 * 1000;
}
