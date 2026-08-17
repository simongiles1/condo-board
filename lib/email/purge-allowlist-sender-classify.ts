/**
 * Classify imported threads for a mistaken allowlist sender.
 * Exclusive threads (this address is From, no other current allowlist
 * participant) are safe to delete. Mixed threads are kept.
 */

import { extractMailboxEmail } from "@/lib/email/address-display";

export type SenderImportMessage = {
  id: string;
  threadId: string | null;
  fromAddress: string;
  toAddresses: string;
  ccAddresses: string;
};

export type ClassifiedSenderImport = {
  exclusiveThreadIds: string[];
  mixedThreadIds: string[];
  exclusiveEmailIds: string[];
  orphanEmailIds: string[];
};

export function normalizeAllowlistMailbox(
  raw: string | null | undefined,
): string | null {
  const email = extractMailboxEmail(raw) ?? raw?.trim().toLowerCase() ?? "";
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;
  return normalized;
}

function parseAddressJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function messageMailboxes(message: SenderImportMessage): Set<string> {
  const mailboxes = new Set<string>();
  for (const raw of [
    message.fromAddress,
    ...parseAddressJson(message.toAddresses),
    ...parseAddressJson(message.ccAddresses),
  ]) {
    const email = normalizeAllowlistMailbox(raw);
    if (email) mailboxes.add(email);
  }
  return mailboxes;
}

function fromMailbox(message: SenderImportMessage): string | null {
  return normalizeAllowlistMailbox(message.fromAddress);
}

export function classifySenderImport(params: {
  targetEmail: string;
  otherAllowlistEmails: string[];
  messages: SenderImportMessage[];
}): ClassifiedSenderImport {
  const target = normalizeAllowlistMailbox(params.targetEmail);
  if (!target) {
    return {
      exclusiveThreadIds: [],
      mixedThreadIds: [],
      exclusiveEmailIds: [],
      orphanEmailIds: [],
    };
  }

  const others = new Set(
    params.otherAllowlistEmails
      .map((email) => normalizeAllowlistMailbox(email))
      .filter((email): email is string => Boolean(email) && email !== target),
  );

  const byThread = new Map<string, SenderImportMessage[]>();
  const orphanEmailIds: string[] = [];

  for (const message of params.messages) {
    if (fromMailbox(message) !== target) continue;
    if (!message.threadId) {
      orphanEmailIds.push(message.id);
      continue;
    }
    const list = byThread.get(message.threadId) ?? [];
    list.push(message);
    byThread.set(message.threadId, list);
  }

  const exclusiveThreadIds: string[] = [];
  const mixedThreadIds: string[] = [];
  const exclusiveEmailIds: string[] = [...orphanEmailIds];

  const messagesByThread = new Map<string, SenderImportMessage[]>();
  for (const message of params.messages) {
    if (!message.threadId) continue;
    const list = messagesByThread.get(message.threadId) ?? [];
    list.push(message);
    messagesByThread.set(message.threadId, list);
  }

  for (const threadId of byThread.keys()) {
    const threadMessages = messagesByThread.get(threadId) ?? [];
    const mixed = threadMessages.some((message) => {
      const mailboxes = messageMailboxes(message);
      for (const mailbox of mailboxes) {
        if (others.has(mailbox)) return true;
      }
      return false;
    });
    if (mixed) {
      mixedThreadIds.push(threadId);
      continue;
    }
    exclusiveThreadIds.push(threadId);
    for (const message of threadMessages) {
      exclusiveEmailIds.push(message.id);
    }
  }

  return {
    exclusiveThreadIds,
    mixedThreadIds,
    exclusiveEmailIds,
    orphanEmailIds,
  };
}
