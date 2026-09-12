"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";

import { CorpusAnswerMarkdown } from "@/components/CorpusAnswerMarkdown";
import { useEntityProfile } from "@/components/EntityProfileProvider";
import { FileCardSummaryBadge } from "@/components/FileCardSummaryBadge";
import {
  ConceptLinkProvider,
  LinkedConceptText,
} from "@/components/LinkedConceptText";
import { PdfAttachmentPreview } from "@/components/PdfAttachmentPreview";
import {
  attachmentKind,
  emailAttachmentApiUrl,
} from "@/lib/email/attachment-display";
import {
  type LinkedConcept,
} from "@/lib/entities/concept-links";
import { formatDateTime } from "@/lib/format/datetime";
import { formatCostUsd } from "@/lib/gemini/usage";
import {
  archiveChatSessionTitle,
  corpusAskTurnCostUsd,
  readArchiveChatHistory,
  type ArchiveChatSession,
  upsertArchiveChatSession,
} from "@/lib/rag/archive-chat-history";
import type { CorpusGroundedAnswer } from "@/lib/rag/answer-shared";
import type { MatchedRegistryEntity } from "@/lib/rag/registry-boost";
import type { CorpusSearchResult } from "@/lib/rag/search";

const EXAMPLE_QUERIES = [
  "Where is the reserve fund study?",
  "Who is the condominium manager?",
  "Elevator modernization status",
];

type ChatSource = {
  key: string;
  result: CorpusSearchResult;
  cited: boolean;
  nearMiss: boolean;
};

type AssistantPayload = {
  answer: CorpusGroundedAnswer | null;
  answerError: string | null;
  results: CorpusSearchResult[];
  matchedEntities: MatchedRegistryEntity[];
};

const COMPOSER_MIN_PX = 44;
/** ~90px taller than the two-line rest height, then the box scrolls. */
const COMPOSER_MAX_PX = 136;

type AskResponsePayload = {
  error?: string;
  answer?: CorpusGroundedAnswer | null;
  answerError?: string;
  results?: CorpusSearchResult[];
  matchedEntities?: MatchedRegistryEntity[];
  searchUsage?: { costUsd?: number } | null;
  rewriteUsage?: { costUsd?: number } | null;
  rerankUsage?: { costUsd?: number } | null;
};

async function readCorpusAskResponse(
  response: Response,
  onPhase: (label: string) => void,
): Promise<AskResponsePayload> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    return (await response.json()) as AskResponsePayload;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AskResponsePayload | null = null;
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      const parsed = JSON.parse(dataLines.join("\n")) as {
        label?: string;
        error?: string;
      } & AskResponsePayload;
      if (eventName === "phase" && parsed.label) {
        onPhase(parsed.label);
      } else if (eventName === "result") {
        result = parsed;
      } else if (eventName === "error") {
        streamError = parsed.error || "Ask failed";
      }
    }
  }

  if (streamError) throw new Error(streamError);
  if (!result) throw new Error("Ask failed");
  return result;
}

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; payload: AssistantPayload };

function dedupeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

function sourceKey(result: CorpusSearchResult): string {
  const attachmentId = result.metadata.attachmentId;
  if (typeof attachmentId === "string" && attachmentId) {
    return `att:${attachmentId}`;
  }
  if (result.emailId) return `email:${result.emailId}`;
  return `chunk:${result.id}`;
}

function sourceLabel(result: CorpusSearchResult): string {
  return result.metadata.filename || result.metadata.subject || "Document";
}

function uniqueSources(
  results: CorpusSearchResult[],
  citedIds: Set<string>,
  nearIds: Set<string>,
): ChatSource[] {
  const byKey = new Map<string, ChatSource>();
  for (const result of results) {
    const key = sourceKey(result);
    const cited = citedIds.has(result.id);
    const nearMiss = nearIds.has(result.id);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { key, result, cited, nearMiss });
      continue;
    }
    existing.cited = existing.cited || cited;
    existing.nearMiss = existing.nearMiss || nearMiss;
    if (cited && !citedIds.has(existing.result.id)) {
      existing.result = result;
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const rank = (row: ChatSource) => (row.cited ? 0 : row.nearMiss ? 1 : 2);
    return rank(a) - rank(b);
  });
}

function previewKind(result: CorpusSearchResult): "pdf" | "image" | "email" | "other" {
  if (result.sourceKind === "email_body") return "email";
  const mime = typeof result.metadata.mimeType === "string" ? result.metadata.mimeType : "";
  const filename = typeof result.metadata.filename === "string" ? result.metadata.filename : "";
  const kind = attachmentKind(mime, filename);
  if (kind === "pdf") return "pdf";
  if (kind === "image") return "image";
  return "other";
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function formatSourceMarkdownLine(source: ChatSource): string {
  const label = sourceLabel(source.result);
  const page =
    source.result.pageNo != null ? ` (p.${source.result.pageNo})` : "";
  const card = source.result.fileCard;
  if (card) {
    return `- **${label}**${page} — *${card.documentType}*: ${card.summary}`;
  }
  return `- **${label}**${page}`;
}

function assistantSources(payload: AssistantPayload): ChatSource[] {
  const citedIds = new Set(
    (payload.answer?.citations ?? []).map((citation) => citation.chunkId),
  );
  const nearIds = new Set(
    (payload.answer?.nearMisses ?? []).map((citation) => citation.chunkId),
  );
  return uniqueSources(payload.results, citedIds, nearIds);
}

function assistantMessageMarkdown(
  message: Extract<ChatMessage, { role: "assistant" }>,
): string {
  const { payload } = message;
  let body =
    payload.answer?.answer?.trim() || payload.answerError?.trim() || message.text.trim();
  const sources = assistantSources(payload);
  const cited = sources.filter((row) => row.cited);
  const related = sources.filter((row) => !row.cited);
  if (cited.length > 0) {
    body += `\n\n### Files used\n\n${cited.map(formatSourceMarkdownLine).join("\n")}`;
  }
  if (related.length > 0) {
    body += `\n\n### Also retrieved\n\n${related.map(formatSourceMarkdownLine).join("\n")}`;
  }
  return body;
}

function conversationMarkdown(messages: ChatMessage[]): string {
  const sections = ["# Ask the board archive\n"];
  for (const message of messages) {
    if (message.role === "user") {
      sections.push(`## User\n\n${message.text.trim()}\n`);
    } else {
      sections.push(`## Assistant\n\n${assistantMessageMarkdown(message)}\n`);
    }
  }
  return sections.join("\n");
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text.trim()) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ArchiveChatLauncher() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [askPhase, setAskPhase] = useState("Understanding the question…");
  const [concepts, setConcepts] = useState<LinkedConcept[]>([]);
  const [activePreview, setActivePreview] = useState<ChatSource | null>(null);
  const [conversationCopied, setConversationCopied] = useState(false);
  const [chatHistory, setChatHistory] = useState<ArchiveChatSession[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionId, setSessionId] = useState(() => newId());
  const [sessionCostUsd, setSessionCostUsd] = useState(0);
  const [mobilePane, setMobilePane] = useState<"chat" | "files">("chat");
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  /** Guards Strict Mode double-invocation and duplicate async completion per user turn. */
  const completedAskTurnRef = useRef<string | null>(null);
  const appendedAssistantIdRef = useRef<string | null>(null);
  const costAppliedAssistantIdRef = useRef<string | null>(null);

  const resizeComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    const unconstrained = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(unconstrained, COMPOSER_MIN_PX), COMPOSER_MAX_PX)}px`;
    el.style.overflowY = unconstrained > COMPOSER_MAX_PX ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshChatHistory = useCallback(() => {
    setChatHistory(readArchiveChatHistory());
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshChatHistory();
  }, [open, refreshChatHistory]);

  useEffect(() => {
    if (!historyOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!historyMenuRef.current?.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [historyOpen]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/entities/concepts")
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { concepts?: LinkedConcept[] };
        if (!cancelled) setConcepts(data.concepts ?? []);
      })
      .catch(() => {
        /* highlighting is optional */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      if (historyOpen) {
        setHistoryOpen(false);
        return;
      }
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busy, historyOpen]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy, askPhase, open]);

  useLayoutEffect(() => {
    resizeComposer();
  }, [query, open, resizeComposer]);

  const persistCurrentSession = useCallback(
    (
      snapshot: {
        id: string;
        messages: ChatMessage[];
        costUsd: number;
      },
    ) => {
      if (snapshot.messages.length === 0) return;
      const stored = upsertArchiveChatSession({
        id: snapshot.id,
        messages: dedupeChatMessages(snapshot.messages),
        costUsd: snapshot.costUsd,
      });
      setChatHistory(stored);
    },
    [],
  );

  useEffect(() => {
    if (messages.length === 0) return;
    persistCurrentSession({ id: sessionId, messages, costUsd: sessionCostUsd });
  }, [messages, sessionCostUsd, sessionId, persistCurrentSession]);

  function previewFromMessages(nextMessages: ChatMessage[]) {
    for (let i = nextMessages.length - 1; i >= 0; i -= 1) {
      const row = nextMessages[i];
      if (row.role !== "assistant") continue;
      const { payload } = row;
      const citedIds = new Set(
        (payload.answer?.citations ?? []).map((citation) => citation.chunkId),
      );
      const nearIds = new Set(
        (payload.answer?.nearMisses ?? []).map((citation) => citation.chunkId),
      );
      const sources = uniqueSources(payload.results, citedIds, nearIds);
      const firstCited =
        sources.find((source) => source.cited) ?? sources[0] ?? null;
      if (firstCited) {
        setActivePreview(firstCited);
      } else {
        setActivePreview(null);
      }
      return;
    }
    setActivePreview(null);
  }

  function loadHistorySession(session: ArchiveChatSession) {
    abortRef.current?.abort();
    setBusy(false);
    if (messages.length > 0) {
      persistCurrentSession({ id: sessionId, messages, costUsd: sessionCostUsd });
    }
    setSessionId(session.id);
    setSessionCostUsd(session.costUsd);
    setMessages(dedupeChatMessages(session.messages as ChatMessage[]));
    previewFromMessages(
      dedupeChatMessages(session.messages as ChatMessage[]),
    );
    setQuery("");
    setMobilePane("chat");
    setHistoryOpen(false);
  }

  const ask = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage: ChatMessage = { id: newId(), role: "user", text };
    const turnId = userMessage.id;
    completedAskTurnRef.current = null;
    appendedAssistantIdRef.current = null;
    costAppliedAssistantIdRef.current = null;
    setMessages((current) => [...current, userMessage]);
    setQuery("");
    setBusy(true);
    setAskPhase("Understanding the question…");
    setMobilePane("chat");

    try {
      const response = await fetch("/api/analysis/corpus-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, generateAnswer: true, stream: true }),
        signal: controller.signal,
      });
      if (!response.ok && !response.headers.get("content-type")?.includes("text/event-stream")) {
        const data = (await response.json()) as AskResponsePayload;
        throw new Error(data.error || "Ask failed");
      }
      const data = await readCorpusAskResponse(response, setAskPhase);
      if (data.error) {
        throw new Error(data.error);
      }
      const results = data.results ?? [];
      const payload: AssistantPayload = {
        answer: data.answer ?? null,
        answerError: data.answerError ?? null,
        results,
        matchedEntities: data.matchedEntities ?? [],
      };
      const assistantText =
        data.answer?.answer?.trim() ||
        data.answerError ||
        "No grounded answer was returned.";
      const turnCostUsd = corpusAskTurnCostUsd(data);
      const assistantMessage: ChatMessage = {
        id: newId(),
        role: "assistant",
        text: assistantText,
        payload,
      };
      if (completedAskTurnRef.current !== turnId) {
        completedAskTurnRef.current = turnId;
        setMessages((currentMessages) => {
          if (appendedAssistantIdRef.current === assistantMessage.id) {
            return currentMessages;
          }
          appendedAssistantIdRef.current = assistantMessage.id;
          return [...currentMessages, assistantMessage];
        });
        setSessionCostUsd((currentCost) => {
          if (costAppliedAssistantIdRef.current === assistantMessage.id) {
            return currentCost;
          }
          costAppliedAssistantIdRef.current = assistantMessage.id;
          return currentCost + turnCostUsd;
        });
      }

      const citedIds = new Set(
        (data.answer?.citations ?? []).map((citation) => citation.chunkId),
      );
      const nearIds = new Set(
        (data.answer?.nearMisses ?? []).map((citation) => citation.chunkId),
      );
      const sources = uniqueSources(results, citedIds, nearIds);
      const firstCited = sources.find((row) => row.cited) ?? sources[0] ?? null;
      if (firstCited) {
        setActivePreview(firstCited);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message =
        error instanceof Error ? error.message : "Ask failed";
      const errorMessage: ChatMessage = {
        id: newId(),
        role: "assistant",
        text: message,
        payload: {
          answer: null,
          answerError: message,
          results: [],
          matchedEntities: [],
        },
      };
      if (completedAskTurnRef.current !== turnId) {
        completedAskTurnRef.current = turnId;
        setMessages((currentMessages) => {
          if (appendedAssistantIdRef.current === errorMessage.id) {
            return currentMessages;
          }
          appendedAssistantIdRef.current = errorMessage.id;
          return [...currentMessages, errorMessage];
        });
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, [busy, sessionId]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(query);
  }

  function clearConversation() {
    abortRef.current?.abort();
    persistCurrentSession({ id: sessionId, messages, costUsd: sessionCostUsd });
    setMessages([]);
    setActivePreview(null);
    setQuery("");
    setBusy(false);
    setMobilePane("chat");
    setSessionId(newId());
    setSessionCostUsd(0);
    completedAskTurnRef.current = null;
    appendedAssistantIdRef.current = null;
    costAppliedAssistantIdRef.current = null;
  }

  function showPreview(source: ChatSource) {
    setActivePreview(source);
    setMobilePane("files");
  }

  function openChunk(results: CorpusSearchResult[], chunkId: string) {
    const result = results.find((row) => row.id === chunkId);
    if (!result) return;
    const citedIds = new Set([chunkId]);
    const sources = uniqueSources(results, citedIds, new Set());
    const match = sources.find((row) => row.key === sourceKey(result)) ?? {
      key: sourceKey(result),
      result,
      cited: true,
      nearMiss: false,
    };
    showPreview(match);
  }

  async function copyConversation() {
    const ok = await copyTextToClipboard(conversationMarkdown(messages));
    if (!ok) return;
    setConversationCopied(true);
    window.setTimeout(() => setConversationCopied(false), 2000);
  }

  const activePreviewKey = activePreview?.key ?? null;

  if (!mounted) return null;

  return (
    <>
      {open ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-5 bottom-5 z-[90] flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg ring-1 ring-teal-700/30 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2"
          aria-label="Ask the archive"
          title="Ask the archive"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}
      {open
        ? createPortal(
            <div className="fixed inset-0 z-[110] flex items-end justify-center p-0 sm:items-center sm:p-4">
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/50"
                onClick={() => {
                  if (!busy) setOpen(false);
                }}
                aria-label="Close archive chat"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="archive-chat-title"
                className="relative flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(92dvh,56rem)] sm:rounded-2xl sm:border sm:border-slate-200"
              >
                <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-800">
                      Archive
                    </p>
                    <h2
                      id="archive-chat-title"
                      className="text-lg font-semibold text-slate-900"
                    >
                      Ask the board archive
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Answers are grounded in stored emails and files. Click a
                      citation to preview the source.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div ref={historyMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          refreshChatHistory();
                          setHistoryOpen((open) => !open);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
                        aria-label="Previous archive chats"
                        aria-expanded={historyOpen}
                        aria-haspopup="menu"
                        title="Previous chats"
                      >
                        <HistoryIcon />
                      </button>
                      {historyOpen ? (
                        <ArchiveChatHistoryPopover
                          sessions={chatHistory}
                          activeSessionId={sessionId}
                          onSelect={loadHistorySession}
                        />
                      ) : null}
                    </div>
                    {messages.length > 0 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void copyConversation()}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          title={
                            conversationCopied
                              ? "Conversation copied"
                              : "Copy conversation as Markdown"
                          }
                        >
                          {conversationCopied ? (
                            <CheckIcon className="text-emerald-600" />
                          ) : (
                            <CopyIcon />
                          )}
                          {conversationCopied ? "Copied" : "Copy chat"}
                        </button>
                        <button
                          type="button"
                          onClick={clearConversation}
                          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          New chat
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>
                </header>

                <div className="flex shrink-0 gap-1 border-b border-slate-100 px-3 py-2 lg:hidden">
                  <button
                    type="button"
                    onClick={() => setMobilePane("chat")}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                      mobilePane === "chat"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobilePane("files")}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                      mobilePane === "files"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    Files
                  </button>
                </div>

                <ConceptLinkProvider concepts={concepts}>
                  <div className="flex min-h-0 flex-1">
                    <section
                      className={`min-h-0 min-w-0 flex-1 flex-col ${
                        mobilePane === "chat" ? "flex" : "hidden lg:flex"
                      }`}
                    >
                      <div
                        ref={scrollerRef}
                        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5"
                      >
                        {messages.length === 0 && !busy ? (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6">
                            <p className="text-sm font-medium text-slate-800">
                              Ask a question the way you would in a board
                              meeting.
                            </p>
                            <p className="mt-1 text-sm text-slate-600">
                              Each question searches the archive. Named people
                              and companies in the answer are highlighted.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {EXAMPLE_QUERIES.map((example) => (
                                <button
                                  key={example}
                                  type="button"
                                  onClick={() => void ask(example)}
                                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-teal-300 hover:text-teal-900"
                                >
                                  {example}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {dedupeChatMessages(messages).map((message) =>
                          message.role === "user" ? (
                            <UserMessageBubble key={message.id} text={message.text} />
                          ) : (
                            <AssistantBubble
                              key={message.id}
                              message={message}
                              activePreviewKey={activePreviewKey}
                              onCite={(chunkId) =>
                                openChunk(message.payload.results, chunkId)
                              }
                              onOpenSource={showPreview}
                            />
                          ),
                        )}

                        {busy ? (
                          <div className="flex justify-start">
                            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-600">
                              <span
                                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600"
                                aria-hidden
                              />
                              <span>{askPhase}</span>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <form
                        onSubmit={onSubmit}
                        className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-5"
                      >
                        <div className="flex items-end gap-2">
                          <textarea
                            ref={composerRef}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onInput={resizeComposer}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                void ask(query);
                              }
                            }}
                            rows={1}
                            disabled={busy}
                            placeholder="Ask about a file, vendor, or decision…"
                            className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-xs outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-50"
                            style={{ maxHeight: COMPOSER_MAX_PX }}
                          />
                          <button
                            type="submit"
                            disabled={busy || !query.trim()}
                            className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Send
                          </button>
                        </div>
                      </form>
                    </section>

                    <aside
                      className={`min-h-0 w-full flex-col border-slate-200 bg-slate-50 lg:w-[26rem] lg:border-l ${
                        mobilePane === "files" ? "flex" : "hidden lg:flex"
                      }`}
                    >
                      <SourcePreviewPane
                        preview={activePreview}
                        onHide={() => setActivePreview(null)}
                      />
                    </aside>
                  </div>
                </ConceptLinkProvider>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

const MESSAGE_BUBBLE_RADIUS_CLASS = "rounded-2xl";
const MESSAGE_COPY_OUTSIDE_CLASS =
  "shrink-0 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100";

function UserMessageBubble({ text }: { text: string }) {
  return (
    <div className="group flex items-start justify-end gap-1.5">
      <MessageCopyButton
        markdown={`## User\n\n${text.trim()}`}
        className={MESSAGE_COPY_OUTSIDE_CLASS}
        label="Copy message as Markdown"
      />
      <div
        className={`max-w-[85%] ${MESSAGE_BUBBLE_RADIUS_CLASS} rounded-br-sm bg-teal-700 px-3.5 py-2 text-sm text-white`}
      >
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  activePreviewKey,
  onCite,
  onOpenSource,
}: {
  message: Extract<ChatMessage, { role: "assistant" }>;
  activePreviewKey: string | null;
  onCite: (chunkId: string) => void;
  onOpenSource: (source: ChatSource) => void;
}) {
  const { openProfile } = useEntityProfile();
  const { payload } = message;
  const sources = assistantSources(payload);
  const cited = sources.filter((row) => row.cited);
  const related = sources.filter((row) => !row.cited);

  return (
    <div className="group flex items-start justify-start gap-1.5">
      <div
        className={`max-w-[95%] ${MESSAGE_BUBBLE_RADIUS_CLASS} rounded-bl-sm border border-slate-200 bg-white px-3.5 py-2.5 shadow-xs`}
      >
        {payload.answerError && !payload.answer ? (
          <p className="text-sm text-amber-900">{payload.answerError}</p>
        ) : payload.answer ? (
          <CorpusAnswerMarkdown
            answer={payload.answer.answer}
            results={payload.results}
            onCite={onCite}
          />
        ) : (
          <p className="text-sm text-slate-800">{message.text}</p>
        )}

        {payload.matchedEntities.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {payload.matchedEntities.map((entity) => (
              <button
                key={`${entity.kind}:${entity.id}`}
                type="button"
                onClick={() =>
                  openProfile({
                    kind: entity.kind,
                    id: entity.id,
                    displayName: entity.name,
                  })
                }
                className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-900 ring-1 ring-orange-200 hover:bg-orange-100"
              >
                {entity.name}
              </button>
            ))}
          </div>
        ) : null}

        {cited.length > 0 ? (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Files used
            </p>
            <div className="mt-1.5 flex flex-col gap-1">
              {cited.map((source) => (
                <SourceChip
                  key={source.key}
                  source={source}
                  selected={activePreviewKey === source.key}
                  onOpen={() => onOpenSource(source)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {related.length > 0 ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Also retrieved ({related.length})
            </summary>
            <div className="mt-1.5 flex flex-col gap-1">
              {related.map((source) => (
                <SourceChip
                  key={source.key}
                  source={source}
                  selected={activePreviewKey === source.key}
                  onOpen={() => onOpenSource(source)}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <MessageCopyButton
        markdown={assistantMessageMarkdown(message)}
        className={MESSAGE_COPY_OUTSIDE_CLASS}
        label="Copy message as Markdown"
      />
    </div>
  );
}

function SourceChip({
  source,
  selected,
  onOpen,
}: {
  source: ChatSource;
  selected: boolean;
  onOpen: () => void;
}) {
  const result = source.result;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition ${
        selected
          ? "border-teal-500 bg-teal-50 ring-2 ring-teal-200/80 hover:bg-teal-100"
          : "border-slate-200 bg-slate-50 hover:border-teal-300 hover:bg-teal-50"
      }`}
    >
      <span className="min-w-0 truncate text-xs font-medium text-slate-800">
        {sourceLabel(result)}
        {result.pageNo != null ? ` · p.${result.pageNo}` : ""}
      </span>
      {result.fileCard ? <FileCardSummaryBadge card={result.fileCard} /> : null}
    </button>
  );
}

function MessageCopyButton({
  markdown,
  label,
  className,
}: {
  markdown: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    const ok = await copyTextToClipboard(markdown);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-xs hover:border-slate-300 hover:text-slate-900 ${className ?? ""}`}
    >
      {copied ? (
        <CheckIcon className="text-emerald-600" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function SourcePreviewPane({
  preview,
  onHide,
}: {
  preview: ChatSource | null;
  onHide: () => void;
}) {
  if (!preview) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-slate-500">
        Cited files appear here. Open a chip or an [S1] marker to preview.
      </div>
    );
  }

  const result = preview.result;
  const kind = previewKind(result);
  const attachmentId =
    typeof result.metadata.attachmentId === "string"
      ? result.metadata.attachmentId
      : null;
  const fileUrl = attachmentId ? emailAttachmentApiUrl(attachmentId) : result.sourceLink;
  const page = result.pageNo && result.pageNo > 0 ? result.pageNo : 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            {sourceLabel(result)}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {result.sourceKind === "email_body"
              ? "Email"
              : result.sourceKind === "attachment_vision_page"
                ? `Vision page ${result.pageNo ?? ""}`
                : "Attachment"}
            {result.metadata.receivedAt
              ? ` · ${formatDateTime(result.metadata.receivedAt)}`
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onHide}
          className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          Hide
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 border-b border-slate-100 bg-white px-3 py-2 text-xs">
        {result.emailLink ? (
          <Link
            href={result.emailLink}
            className="font-medium text-teal-800 underline hover:text-teal-950"
          >
            Open email
          </Link>
        ) : null}
        {fileUrl && kind !== "email" ? (
          <a
            href={`${fileUrl}${fileUrl.includes("?") ? "&" : "?"}download=1`}
            className="font-medium text-purple-800 underline hover:text-purple-950"
          >
            Download
          </a>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {kind === "pdf" && fileUrl ? (
          <PdfAttachmentPreview url={fileUrl} initialPage={page} compact />
        ) : kind === "image" && fileUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fileUrl}
            alt={sourceLabel(result)}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        ) : (
          <div className="space-y-3">
            {result.fileCard ? (
              <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {result.fileCard.documentType}
                </p>
                <p className="mt-1">{result.fileCard.summary}</p>
              </div>
            ) : null}
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
              <LinkedConceptText text={result.chunkText || result.excerpt} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ArchiveChatHistoryPopover({
  sessions,
  activeSessionId,
  onSelect,
}: {
  sessions: ArchiveChatSession[];
  activeSessionId: string;
  onSelect: (session: ArchiveChatSession) => void;
}) {
  return (
    <div
      role="menu"
      aria-label="Previous archive chats"
      className="absolute right-0 top-[calc(100%+0.375rem)] z-30 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
    >
      <div className="border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Previous chats
        </p>
      </div>
      <div className="max-h-72 overflow-y-auto py-1">
        {sessions.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">
            Completed chats on this browser appear here with estimated AI cost.
          </p>
        ) : (
          sessions.map((session) => {
            const active = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                type="button"
                role="menuitem"
                onClick={() => onSelect(session)}
                className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition hover:bg-slate-50 ${
                  active ? "bg-teal-50/80" : ""
                }`}
              >
                <span className="line-clamp-2 text-sm font-medium text-slate-900">
                  {archiveChatSessionTitle(session.messages)}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                  <span>{formatDateTime(session.updatedAt)}</span>
                  <span aria-hidden>·</span>
                  <span className="font-medium text-slate-700">
                    {formatCostUsd(session.costUsd)}
                  </span>
                  {active ? (
                    <span className="rounded-full bg-teal-100 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-teal-900">
                      Current
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function HistoryIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`h-4 w-4 ${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`h-4 w-4 ${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
