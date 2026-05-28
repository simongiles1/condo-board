import type { gmail_v1 } from "googleapis";

import { getGmailClient } from "./client";
import type { GmailAccountType } from "./oauth";

export type ConnectionVerification = {
  accountType: GmailAccountType;
  storedEmailAddress: string;
  verifiedEmailAddress: string | null;
  matchesStored: boolean;
  matchesExpectedDedicated: boolean;
  expectedDedicatedEmail: string | null;
  messagesTotal: number | null;
};

function normalizeEmail(email: string | null | undefined): string | null {
  return email?.trim().toLowerCase() ?? null;
}

export function getExpectedDedicatedEmail(): string | null {
  return normalizeEmail(process.env.GMAIL_DEDICATED_EMAIL);
}

export async function verifyGmailConnection(
  accountType: GmailAccountType,
): Promise<ConnectionVerification & { gmail: gmail_v1.Gmail }> {
  const { gmail, connection } = await getGmailClient(accountType);
  const profile = await gmail.users.getProfile({ userId: "me" });
  const verifiedEmailAddress = profile.data.emailAddress ?? null;
  const stored = normalizeEmail(connection.emailAddress);
  const verified = normalizeEmail(verifiedEmailAddress);
  const expectedDedicated = getExpectedDedicatedEmail();

  return {
    accountType,
    storedEmailAddress: connection.emailAddress,
    verifiedEmailAddress,
    matchesStored: stored === verified,
    matchesExpectedDedicated:
      accountType !== "dedicated" ||
      !expectedDedicated ||
      verified === expectedDedicated,
    expectedDedicatedEmail: expectedDedicated,
    messagesTotal: profile.data.messagesTotal ?? null,
    gmail,
  };
}

export function formatConnectionMismatchError(
  verification: ConnectionVerification,
): string {
  const lines = [
    `Gmail OAuth token is for ${verification.verifiedEmailAddress ?? "an unknown account"}, but settings show ${verification.storedEmailAddress}.`,
    "Click Reconnect on the dedicated mailbox and sign in with the condo account.",
  ];

  if (verification.expectedDedicatedEmail) {
    lines.push(`Expected account: ${verification.expectedDedicatedEmail}`);
  }

  return lines.join(" ");
}

export async function assertDedicatedConnectionValid(): Promise<
  ConnectionVerification & { gmail: gmail_v1.Gmail }
> {
  const verification = await verifyGmailConnection("dedicated");

  if (!verification.matchesStored || !verification.matchesExpectedDedicated) {
    throw new Error(formatConnectionMismatchError(verification));
  }

  return verification;
}
