import { and, asc, eq, isNotNull, or } from "drizzle-orm";

import {
  ACTION_ITEM_RECONCILIATION_SYSTEM_PROMPT,
  buildActionItemReconciliationUserPrompt,
} from "@/lib/email-analysis/prompts";
import { getDb } from "@/lib/db";
import { emails, extractedActionItems } from "@/lib/db/schema";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { unwrapJsonCodeBlock } from "@/lib/gemini/parse-output";
import {
  estimateCostUsdForCalls,
  type GeminiUsageCall,
} from "@/lib/gemini/usage";

const MAX_THREAD_CHARS = 120_000;
const RECONCILIATION_MAX_OUTPUT_TOKENS = 8192;

export type ActionItemReconciliationStatus = "completed" | "open" | "superseded";

export type ActionItemReconciliationUpdate = {
  id: string;
  status: ActionItemReconciliationStatus;
  reason?: string;
  resolved_by_quote?: string;
};

export type ActionItemReconciliationResult = {
  updates: ActionItemReconciliationUpdate[];
};

export type ReconcileThreadActionItemsResult = {
  completed: number;
  superseded: number;
  calls: GeminiUsageCall[];
  costUsd: number;
};

type OpenActionItem = {
  id: string;
  assignee: string;
  description: string;
  deadline: string | null;
  createdAt: string;
  sourceQuote: string | null;
};

/**
 * "Send calendar invite" tasks stay open across verbal claims in any thread.
 * They close only when a separate meeting-invite email is analyzed.
 */
export function requiresCrossThreadCalendarEvidence(item: {
  description: string;
  sourceQuote?: string | null;
}): boolean {
  const text = `${item.description} ${item.sourceQuote ?? ""}`.toLowerCase();
  const mentionsInvite =
    /\b(calendar invite|meeting invite|teams invite)\b/.test(text);
  const mentionsSending = /\b(send|sending|sent)\b/.test(text);
  return mentionsInvite && mentionsSending;
}

export function isMeetingInviteEmail(input: {
  subject: string;
  bodyText: string;
  bodyTextUnique?: string | null;
}): boolean {
  const body = (input.bodyTextUnique ?? input.bodyText).toLowerCase();
  const subject = input.subject.toLowerCase();

  if (body.includes("teams.microsoft.com/meet")) return true;
  if (body.includes("jointeamsmeeting")) return true;
  if (body.includes("zoom.us/j/")) return true;
  if (
    subject.includes("board meeting") &&
    (body.includes("meeting id:") || body.includes("join:"))
  ) {
    return true;
  }

  return false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseStatus(value: unknown): ActionItemReconciliationStatus | null {
  if (value === "completed" || value === "open" || value === "superseded") {
    return value;
  }
  return null;
}

export function parseActionItemReconciliationResult(
  raw: unknown,
): ActionItemReconciliationResult {
  if (!isObject(raw)) return { updates: [] };

  const updatesRaw = raw.updates;
  if (!Array.isArray(updatesRaw)) return { updates: [] };

  const updates: ActionItemReconciliationUpdate[] = [];
  for (const entry of updatesRaw) {
    if (!isObject(entry)) continue;
    const id = asString(entry.id);
    const status = parseStatus(entry.status);
    if (!id || !status || status === "open") continue;

    updates.push({
      id,
      status,
      reason: asString(entry.reason),
      resolved_by_quote: asString(entry.resolved_by_quote),
    });
  }

  return { updates };
}

function buildThreadTranscript(
  messages: Array<{
    fromAddress: string;
    subject: string;
    receivedAt: string;
    bodyTextUnique: string | null;
    bodyText: string;
  }>,
): string {
  const blocks = messages.map((message, index) => {
    const body = (message.bodyTextUnique ?? message.bodyText).trim();
    return [
      `--- Message ${index + 1} ---`,
      `From: ${message.fromAddress}`,
      `Date: ${message.receivedAt}`,
      `Subject: ${message.subject}`,
      "Body:",
      body,
    ].join("\n");
  });

  let transcript = blocks.join("\n\n");
  if (transcript.length > MAX_THREAD_CHARS) {
    transcript = `${transcript.slice(-MAX_THREAD_CHARS)}\n\n[Thread truncated to the most recent ${MAX_THREAD_CHARS} characters.]`;
  }

  return transcript;
}

async function loadOpenThreadActionItems(
  threadId: string,
): Promise<OpenActionItem[]> {
  const db = getDb();
  return db
    .select({
      id: extractedActionItems.id,
      assignee: extractedActionItems.assignee,
      description: extractedActionItems.description,
      deadline: extractedActionItems.deadline,
      createdAt: extractedActionItems.createdAt,
      sourceQuote: extractedActionItems.sourceQuote,
    })
    .from(extractedActionItems)
    .where(
      and(
        eq(extractedActionItems.emailThreadId, threadId),
        eq(extractedActionItems.completed, false),
      ),
    );
}

/**
 * Only emails the system has actually analyzed so far.
 * During incremental thread analysis, later unprocessed messages are excluded.
 */
async function loadAnalyzedThreadMessages(
  threadId: string,
  analyzedEmailId?: string,
) {
  const db = getDb();
  const scopeFilter = analyzedEmailId
    ? or(isNotNull(emails.processedAt), eq(emails.id, analyzedEmailId))
    : isNotNull(emails.processedAt);

  return db
    .select({
      id: emails.id,
      fromAddress: emails.fromAddress,
      subject: emails.subject,
      receivedAt: emails.receivedAt,
      bodyTextUnique: emails.bodyTextUnique,
      bodyText: emails.bodyText,
    })
    .from(emails)
    .where(and(eq(emails.threadId, threadId), scopeFilter))
    .orderBy(asc(emails.receivedAt));
}

export async function closeCrossThreadCalendarInviteItems(input: {
  emailId: string;
}): Promise<number> {
  const db = getDb();
  const [email] = await db
    .select({
      subject: emails.subject,
      bodyText: emails.bodyText,
      bodyTextUnique: emails.bodyTextUnique,
    })
    .from(emails)
    .where(eq(emails.id, input.emailId));

  if (!email || !isMeetingInviteEmail(email)) {
    return 0;
  }

  const openItems = await db
    .select({
      id: extractedActionItems.id,
      description: extractedActionItems.description,
      sourceQuote: extractedActionItems.sourceQuote,
    })
    .from(extractedActionItems)
    .where(eq(extractedActionItems.completed, false));

  const toClose = openItems.filter(requiresCrossThreadCalendarEvidence);
  if (!toClose.length) return 0;

  const now = new Date().toISOString();
  for (const item of toClose) {
    await db
      .update(extractedActionItems)
      .set({ completed: true, completedAt: now })
      .where(
        and(
          eq(extractedActionItems.id, item.id),
          eq(extractedActionItems.completed, false),
        ),
      );
  }

  console.info("[email-analysis:action-item-cross-thread]", {
    meetingInviteEmailId: input.emailId,
    closed: toClose.length,
  });

  return toClose.length;
}

export async function reconcileThreadActionItems(input: {
  threadId: string;
  modelName: string;
  /** Email just analyzed — scopes reconciliation to processed messages + this one. */
  analyzedEmailId?: string;
}): Promise<ReconcileThreadActionItemsResult> {
  const openItems = await loadOpenThreadActionItems(input.threadId);
  const threadReconcilableItems = openItems.filter(
    (item) => !requiresCrossThreadCalendarEvidence(item),
  );

  if (!threadReconcilableItems.length) {
    return { completed: 0, superseded: 0, calls: [], costUsd: 0 };
  }

  const threadMessages = await loadAnalyzedThreadMessages(
    input.threadId,
    input.analyzedEmailId,
  );
  if (!threadMessages.length) {
    return { completed: 0, superseded: 0, calls: [], costUsd: 0 };
  }

  const openById = new Map(threadReconcilableItems.map((item) => [item.id, item]));
  const userPrompt = buildActionItemReconciliationUserPrompt({
    threadTranscript: buildThreadTranscript(threadMessages),
    openItems: threadReconcilableItems.map((item) => ({
      id: item.id,
      assignee: item.assignee,
      task: item.description,
      deadline: item.deadline,
      created_at: item.createdAt,
    })),
  });

  const generation = await generateEmailExtraction({
    systemInstruction: ACTION_ITEM_RECONCILIATION_SYSTEM_PROMPT,
    userText: userPrompt,
    modelName: input.modelName,
    maxOutputTokens: RECONCILIATION_MAX_OUTPUT_TOKENS,
    step: "action_item_reconciliation",
  });

  const { jsonText } = unwrapJsonCodeBlock(generation.text);
  const parsed = parseActionItemReconciliationResult(
    JSON.parse(jsonText) as unknown,
  );

  const db = getDb();
  const now = new Date().toISOString();
  let completed = 0;
  let superseded = 0;

  for (const update of parsed.updates) {
    if (!openById.has(update.id)) continue;

    await db
      .update(extractedActionItems)
      .set({
        completed: true,
        completedAt: now,
      })
      .where(
        and(
          eq(extractedActionItems.id, update.id),
          eq(extractedActionItems.emailThreadId, input.threadId),
          eq(extractedActionItems.completed, false),
        ),
      );

    if (update.status === "completed") completed += 1;
    if (update.status === "superseded") superseded += 1;
  }

  const calls = generation.usageCalls;
  const costUsd = estimateCostUsdForCalls(calls);

  if (completed || superseded) {
    console.info("[email-analysis:action-item-reconcile]", {
      threadId: input.threadId,
      analyzedEmailId: input.analyzedEmailId,
      analyzedMessageCount: threadMessages.length,
      completed,
      superseded,
      costUsd,
    });
  }

  return { completed, superseded, calls, costUsd };
}
