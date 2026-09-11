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
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ArchiveChatLauncher() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [askPhase, setAskPhase] = useState("Understanding the question…");
  const [concepts, setConcepts] = useState<LinkedConcept[]>([]);
  const [preview, setPreview] = useState<ChatSource | null>(null);
  const [mobilePane, setMobilePane] = useState<"chat" | "files">("chat");
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

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
      if (event.key === "Escape" && !busy) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busy]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy, askPhase, open]);

  useLayoutEffect(() => {
    resizeComposer();
  }, [query, open, resizeComposer]);

  const ask = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage: ChatMessage = { id: newId(), role: "user", text };
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
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: assistantText, payload },
      ]);

      const citedIds = new Set(
        (data.answer?.citations ?? []).map((citation) => citation.chunkId),
      );
      const nearIds = new Set(
        (data.answer?.nearMisses ?? []).map((citation) => citation.chunkId),
      );
      const sources = uniqueSources(results, citedIds, nearIds);
      const firstCited = sources.find((row) => row.cited) ?? sources[0] ?? null;
      setPreview(firstCited);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message =
        error instanceof Error ? error.message : "Ask failed";
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: message,
          payload: {
            answer: null,
            answerError: message,
            results: [],
            matchedEntities: [],
          },
        },
      ]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, [busy]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(query);
  }

  function clearConversation() {
    abortRef.current?.abort();
    setMessages([]);
    setPreview(null);
    setQuery("");
    setBusy(false);
    setMobilePane("chat");
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
    setPreview(match);
    setMobilePane("files");
  }

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
                    {messages.length > 0 ? (
                      <button
                        type="button"
                        onClick={clearConversation}
                        className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        New chat
                      </button>
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

                        {messages.map((message) =>
                          message.role === "user" ? (
                            <div key={message.id} className="flex justify-end">
                              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-teal-700 px-3.5 py-2 text-sm text-white">
                                {message.text}
                              </div>
                            </div>
                          ) : (
                            <AssistantBubble
                              key={message.id}
                              message={message}
                              onCite={(chunkId) =>
                                openChunk(message.payload.results, chunkId)
                              }
                              onOpenSource={(source) => {
                                setPreview(source);
                                setMobilePane("files");
                              }}
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
                        preview={preview}
                        onClear={() => setPreview(null)}
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

function AssistantBubble({
  message,
  onCite,
  onOpenSource,
}: {
  message: Extract<ChatMessage, { role: "assistant" }>;
  onCite: (chunkId: string) => void;
  onOpenSource: (source: ChatSource) => void;
}) {
  const { openProfile } = useEntityProfile();
  const { payload } = message;
  const citedIds = new Set(
    (payload.answer?.citations ?? []).map((citation) => citation.chunkId),
  );
  const nearIds = new Set(
    (payload.answer?.nearMisses ?? []).map((citation) => citation.chunkId),
  );
  const sources = uniqueSources(payload.results, citedIds, nearIds);
  const cited = sources.filter((row) => row.cited);
  const related = sources.filter((row) => !row.cited);

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3.5 py-2.5 shadow-xs">
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
                  onOpen={() => onOpenSource(source)}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function SourceChip({
  source,
  onOpen,
}: {
  source: ChatSource;
  onOpen: () => void;
}) {
  const result = source.result;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left hover:border-teal-300 hover:bg-teal-50"
    >
      <span className="min-w-0 truncate text-xs font-medium text-slate-800">
        {sourceLabel(result)}
        {result.pageNo != null ? ` · p.${result.pageNo}` : ""}
      </span>
      {result.fileCard ? <FileCardSummaryBadge card={result.fileCard} /> : null}
    </button>
  );
}

function SourcePreviewPane({
  preview,
  onClear,
}: {
  preview: ChatSource | null;
  onClear: () => void;
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
          onClick={onClear}
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
