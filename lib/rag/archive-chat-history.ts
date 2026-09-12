/** Browser persistence for global archive chat sessions (client-only). */

import type { CorpusGroundedAnswer } from "@/lib/rag/answer-shared";
import type { MatchedRegistryEntity } from "@/lib/rag/registry-boost";
import type { CorpusSearchResult } from "@/lib/rag/search";

export const ARCHIVE_CHAT_HISTORY_STORAGE_KEY = "condo-board-archive-chat-history";
export const ARCHIVE_CHAT_HISTORY_MAX_SESSIONS = 40;

export type ArchiveChatAssistantPayload = {
  answer: CorpusGroundedAnswer | null;
  answerError: string | null;
  results: CorpusSearchResult[];
  matchedEntities: MatchedRegistryEntity[];
};

export type ArchiveChatStoredMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      payload: ArchiveChatAssistantPayload;
    };

export type ArchiveChatSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  costUsd: number;
  messages: ArchiveChatStoredMessage[];
};

type CostUsage = { costUsd?: number };

export type CorpusAskCostFields = {
  searchUsage?: CostUsage | null;
  rewriteUsage?: CostUsage | null;
  rerankUsage?: CostUsage | null;
  answer?: CorpusGroundedAnswer | null;
};

export function corpusAskTurnCostUsd(data: CorpusAskCostFields): number {
  let total = 0;
  if (data.searchUsage?.costUsd) total += data.searchUsage.costUsd;
  if (data.rewriteUsage?.costUsd) total += data.rewriteUsage.costUsd;
  if (data.rerankUsage?.costUsd) total += data.rerankUsage.costUsd;
  if (data.answer?.usage?.costUsd) total += data.answer.usage.costUsd;
  return total;
}

export function archiveChatSessionTitle(
  messages: ArchiveChatStoredMessage[],
): string {
  const first = messages.find((row) => row.role === "user");
  if (!first) return "Untitled chat";
  const text = first.text.trim();
  if (text.length <= 72) return text;
  return `${text.slice(0, 69)}…`;
}

function parseSessions(raw: unknown): ArchiveChatSession[] {
  if (!Array.isArray(raw)) return [];
  const sessions: ArchiveChatSession[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== "string" || !Array.isArray(record.messages)) {
      continue;
    }
    sessions.push({
      id: record.id,
      createdAt:
        typeof record.createdAt === "string"
          ? record.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof record.updatedAt === "string"
          ? record.updatedAt
          : new Date().toISOString(),
      costUsd:
        typeof record.costUsd === "number" && Number.isFinite(record.costUsd)
          ? record.costUsd
          : 0,
      messages: record.messages as ArchiveChatStoredMessage[],
    });
  }
  return sessions;
}

export function readArchiveChatHistory(): ArchiveChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ARCHIVE_CHAT_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    return parseSessions(JSON.parse(raw)).sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  } catch {
    return [];
  }
}

export function upsertArchiveChatSession(
  session: Omit<ArchiveChatSession, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  },
): ArchiveChatSession[] {
  if (typeof window === "undefined") return [];
  const now = new Date().toISOString();
  const existing = readArchiveChatHistory();
  const prior = existing.find((row) => row.id === session.id);
  const next: ArchiveChatSession = {
    id: session.id,
    createdAt: session.createdAt ?? prior?.createdAt ?? now,
    updatedAt: session.updatedAt ?? now,
    costUsd: session.costUsd,
    messages: session.messages,
  };
  const merged = [next, ...existing.filter((row) => row.id !== session.id)].slice(
    0,
    ARCHIVE_CHAT_HISTORY_MAX_SESSIONS,
  );
  try {
    window.localStorage.setItem(
      ARCHIVE_CHAT_HISTORY_STORAGE_KEY,
      JSON.stringify(merged),
    );
  } catch {
    /* quota or private mode */
  }
  return merged;
}
