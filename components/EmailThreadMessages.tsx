"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import { HarvestMarkedBody } from "@/components/HarvestMarkedBody";
import { DeleteEmailButton } from "@/components/DeleteEmailButton";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { SourceQuoteDisplay } from "@/components/SourceQuoteDisplay";
import {
  type EmailAttachmentSummary,
} from "@/lib/email/attachment-display";
import { filterVisibleAttachments } from "@/lib/email/attachment-visibility";
import type { EmailBodyDisplay } from "@/lib/email/format-body-display";
import {
  resolveUniqueHighlightSplit,
  type HighlightSplit,
} from "@/lib/email/highlight-unique";
import {
  buildHighlightedSegments,
  CONTACT_HIGHLIGHT_CLASS,
  extractionHasAny,
  toHighlightSpans,
  type ContactHighlightExtraction,
} from "@/lib/email-analysis/contact-highlight-shared";
import {
  buildHarvestMarkTree,
  locateSentenceQuoteRange,
  resolveHarvestSpans,
} from "@/lib/email-analysis/harvest-highlight-spans";
import type { TodoExtractListItem } from "@/lib/email-analysis/todo-highlight-run-display";
import { formatDateTime } from "@/lib/format/datetime";
import { useAttachmentVisibilitySettings } from "@/lib/settings/attachment-visibility-settings";

type Attachment = EmailAttachmentSummary;

export type ThreadMessage = {
  id: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses?: string[];
  receivedAt: string;
  source: string;
  bodyText: string;
  bodyTextUnique?: string | null;
  bodyDisplay: EmailBodyDisplay;
  bodyDisplayUnique?: EmailBodyDisplay | null;
  attachments: Attachment[];
};

function bodyPreview(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "(No plain-text body)";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

function formatSourceLabel(source: string): string {
  return source.replace(/_/g, " ");
}

function QuoteMarkedText({
  text,
  quote,
}: {
  text: string;
  quote: string | null;
}): ReactNode {
  if (!quote?.trim()) return text;
  const range = locateSentenceQuoteRange(text, quote);
  if (!range) return text;
  return (
    <>
      {text.slice(0, range.start)}
      <mark
        id="source-quote-mark"
        data-source-quote-mark=""
        className="rounded-sm bg-amber-200 text-amber-950 ring-2 ring-amber-400 box-decoration-clone px-0.5"
      >
        {text.slice(range.start, range.end)}
      </mark>
      {text.slice(range.end)}
    </>
  );
}

function quoteMatches(text: string, quote: string | null): boolean {
  if (!quote?.trim() || !text) return false;
  return locateSentenceQuoteRange(text, quote) != null;
}

/** Scroll a child inside an overflow panel. Never use scrollIntoView — it
 *  centers the whole message card and lands in quoted history. */
function scrollChildIntoContainer(
  container: HTMLElement,
  child: HTMLElement,
  paddingTop = 20,
): void {
  const containerRect = container.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const nextTop =
    container.scrollTop + (childRect.top - containerRect.top) - paddingTop;
  container.scrollTo({ top: Math.max(0, nextTop), behavior: "auto" });
}

function TodoHarvestBody({
  text,
  todos,
  focusQuote,
}: {
  text: string;
  todos: TodoExtractListItem[];
  focusQuote?: string | null;
}): ReactNode {
  const tree = useMemo(
    () =>
      buildHarvestMarkTree(
        resolveHarvestSpans({
          text,
          todos: todos.map((todo) => ({
            title: todo.task,
            sourceQuote: todo.sourceQuote,
          })),
          focusQuote,
        }),
      ),
    [focusQuote, text, todos],
  );

  return (
    <HarvestMarkedBody
      text={text}
      nodes={tree}
      todos={todos.map((todo) => ({
        type: "action_item",
        title: todo.task,
        detail: todo.assignee,
        when: todo.deadline,
        sourceQuote: todo.sourceQuote,
      }))}
    />
  );
}

function BodyContent({
  display,
  quote,
}: {
  display: EmailBodyDisplay;
  quote?: string | null;
}) {
  if (quote?.trim()) {
    return (
      <div className="prose prose-sm max-w-none whitespace-pre-wrap">
        <QuoteMarkedText text={display.content} quote={quote} />
      </div>
    );
  }
  if (display.kind === "markdown") {
    return <MarkdownPreview>{display.content}</MarkdownPreview>;
  }
  return (
    <div className="prose prose-sm max-w-none whitespace-pre-wrap">
      {display.content || "(No plain-text body)"}
    </div>
  );
}

function resolveHighlightSplit(
  display: EmailBodyDisplay,
  uniqueText: string,
): HighlightSplit | null {
  return resolveUniqueHighlightSplit(display.content, uniqueText);
}

function ContactMarkedText({
  text,
  extraction,
}: {
  text: string;
  extraction: ContactHighlightExtraction;
}): ReactNode {
  const spans = toHighlightSpans(extraction);
  const segments = buildHighlightedSegments(text, spans);
  return segments.map((segment, index) => {
    if (!segment.type) {
      return <span key={index}>{segment.text}</span>;
    }
    return (
      <mark key={index} className={CONTACT_HIGHLIGHT_CLASS[segment.type]}>
        {segment.text}
      </mark>
    );
  });
}

function HighlightedFullBody({
  display,
  uniqueText,
  contactExtraction,
  uniqueOnly = false,
  highlightQuote = null,
}: {
  display: EmailBodyDisplay;
  uniqueText: string;
  contactExtraction?: ContactHighlightExtraction | null;
  uniqueOnly?: boolean;
  highlightQuote?: string | null;
}) {
  // Verify-this-task: yellow on the extracting sentence only. Do not wash the
  // unique authored region teal — that reads as "the whole email is the quote".
  if (highlightQuote?.trim()) {
    const searchText =
      uniqueOnly && uniqueText.trim() ? uniqueText : display.content;
    const quote =
      quoteMatches(searchText, highlightQuote) ||
      quoteMatches(display.content, highlightQuote) ||
      quoteMatches(uniqueText, highlightQuote)
        ? highlightQuote
        : null;
    if (uniqueOnly) {
      return (
        <div className="prose prose-sm max-w-none whitespace-pre-wrap">
          <QuoteMarkedText
            text={uniqueText.trim() ? uniqueText : display.content}
            quote={quote}
          />
        </div>
      );
    }
    return <BodyContent display={display} quote={quote} />;
  }

  const split = resolveHighlightSplit(display, uniqueText);
  if (!split) {
    if (uniqueOnly) {
      return (
        <p className="text-sm text-slate-500">(No unique content for this message)</p>
      );
    }
    return <BodyContent display={display} />;
  }

  const highlightClass =
    "w-full max-w-none rounded-sm bg-teal-50 box-decoration-clone px-1 py-0.5 -mx-1";

  const showContactMarks =
    contactExtraction != null && extractionHasAny(contactExtraction);
  const showRemainder = Boolean(split.remainder) && !uniqueOnly;

  // Unique could not be located as a prefix of the HTML display. Paint the
  // mention unique string teal so the overlay matches what mentions search,
  // then show the full message unhighlighted.
  if (!split.aligned) {
    return (
      <div className="w-full max-w-none">
        <div
          className={`prose prose-sm whitespace-pre-wrap ${highlightClass}`}
        >
          {showContactMarks ? (
            <ContactMarkedText
              text={split.highlighted}
              extraction={contactExtraction}
            />
          ) : (
            split.highlighted
          )}
        </div>
        {showRemainder ? <BodyContent display={display} /> : null}
      </div>
    );
  }

  // When contact marks are active, render the unique span as plain text so
  // substring marks stay reliable (markdown AST would break mid-token wraps).
  if (showContactMarks) {
    return (
      <div className="w-full max-w-none">
        <div
          className={`prose prose-sm whitespace-pre-wrap ${highlightClass}`}
        >
          <ContactMarkedText
            text={split.highlighted}
            extraction={contactExtraction}
          />
        </div>
        {showRemainder ? (
          display.kind === "markdown" ? (
            <MarkdownPreview>{split.remainder}</MarkdownPreview>
          ) : (
            <div className="prose prose-sm max-w-none whitespace-pre-wrap">
              {split.remainder}
            </div>
          )
        ) : null}
      </div>
    );
  }

  if (display.kind === "markdown") {
    if (!showRemainder) {
      return (
        <div className={highlightClass}>
          <MarkdownPreview>{split.highlighted}</MarkdownPreview>
        </div>
      );
    }
    return (
      <div className="w-full max-w-none">
        <div className={highlightClass}>
          <MarkdownPreview>{split.highlighted}</MarkdownPreview>
        </div>
        <MarkdownPreview>{split.remainder}</MarkdownPreview>
      </div>
    );
  }

  if (!showRemainder) {
    return (
      <div
        className={`prose prose-sm w-full max-w-none whitespace-pre-wrap ${highlightClass}`}
      >
        {split.highlighted}
      </div>
    );
  }

  return (
    <div className="prose prose-sm w-full max-w-none whitespace-pre-wrap">
      <mark className="rounded-sm bg-teal-100/90 text-inherit box-decoration-clone px-0.5">
        {split.highlighted}
      </mark>
      {split.remainder}
    </div>
  );
}

export function EmailThreadMessages({
  messages,
  hideAttachments = false,
  contactExtractions = null,
  uniqueContentOnly = false,
  focusEmailId = null,
  highlightQuote = null,
  todosByEmailId = null,
  scrollRootRef = null,
}: {
  messages: ThreadMessage[];
  hideAttachments?: boolean;
  contactExtractions?: Record<string, ContactHighlightExtraction> | null;
  uniqueContentOnly?: boolean;
  focusEmailId?: string | null;
  highlightQuote?: string | null;
  todosByEmailId?: Record<string, TodoExtractListItem[]> | null;
  scrollRootRef?: RefObject<HTMLElement | null> | null;
}) {
  const scrolledForKeyRef = useRef<string | null>(null);
  const visibilitySettings = useAttachmentVisibilitySettings();
  const [visibleMessages, setVisibleMessages] = useState(messages);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initialId = focusEmailId ?? messages.at(0)?.id;
    return initialId ? new Set([initialId]) : new Set();
  });

  useEffect(() => {
    setVisibleMessages(messages);
    const initialId = focusEmailId ?? messages.at(0)?.id;
    setExpandedIds(initialId ? new Set([initialId]) : new Set());
  }, [messages, focusEmailId]);

  // Expand every message when contact marks are present or unique-only mode is on.
  // Do not reset to the focus email — that would collapse a message the user just opened.
  useEffect(() => {
    if (!contactExtractions && !uniqueContentOnly) return;
    setExpandedIds(new Set(visibleMessages.map((message) => message.id)));
  }, [contactExtractions, uniqueContentOnly, visibleMessages]);

  useLayoutEffect(() => {
    if (!focusEmailId && !highlightQuote?.trim()) return;

    const container = scrollRootRef?.current;
    if (!container) return;

    const scrollKey = `${focusEmailId ?? ""}::${highlightQuote ?? ""}`;
    if (scrolledForKeyRef.current === scrollKey) return;

    let cancelled = false;
    let attempts = 0;

    function tryScroll() {
      if (cancelled) return;
      const mark = container.querySelector<HTMLElement>(
        "[data-source-quote-mark]",
      );
      if (mark) {
        scrollChildIntoContainer(container, mark);
        scrolledForKeyRef.current = scrollKey;
        return;
      }
      const article = focusEmailId
        ? container.querySelector<HTMLElement>(`#thread-msg-${focusEmailId}`)
        : null;
      if (article && attempts === 0) {
        scrollChildIntoContainer(container, article);
      }
      attempts += 1;
      if (attempts < 16) {
        requestAnimationFrame(tryScroll);
      }
    }

    tryScroll();
    return () => {
      cancelled = true;
    };
  }, [focusEmailId, highlightQuote, scrollRootRef, visibleMessages]);

  function removeMessage(emailId: string) {
    setVisibleMessages((prev) => prev.filter((message) => message.id !== emailId));
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(emailId);
      return next;
    });
  }

  function toggleMessage(id: string) {
    if (uniqueContentOnly) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (visibleMessages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        No messages in this thread.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visibleMessages.map((message) => {
        const expanded = expandedIds.has(message.id);
        const visibleAttachments = filterVisibleAttachments(
          message.attachments,
          "emailDetail",
          visibilitySettings,
        );
        const uniqueText = message.bodyTextUnique?.trim() || "";
        const toLine = message.toAddresses.join(", ");
        const contactExtraction = contactExtractions?.[message.id] ?? null;
        const isFocus = Boolean(focusEmailId) && message.id === focusEmailId;
        const messageQuote =
          !focusEmailId || isFocus ? highlightQuote : null;
        const quoteMissing =
          Boolean(messageQuote?.trim()) &&
          !quoteMatches(message.bodyDisplay.content, messageQuote) &&
          !quoteMatches(uniqueText, messageQuote);

        return (
          <article
            key={message.id}
            id={`thread-msg-${message.id}`}
            className={`overflow-hidden rounded-lg border bg-white shadow-sm ${
              isFocus
                ? "border-amber-300 ring-1 ring-amber-200"
                : "border-slate-200"
            }`}
          >
            <div className="flex w-full items-start gap-3 p-4">
              <button
                type="button"
                onClick={() => toggleMessage(message.id)}
                aria-expanded={expanded}
                className="flex min-w-0 flex-1 items-start gap-3 text-left transition-colors hover:opacity-80"
              >
                <span
                  aria-hidden
                  className="mt-0.5 shrink-0 text-xs text-slate-400"
                >
                  {expanded ? "▼" : "▶"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        {message.fromAddress}
                      </p>
                      {toLine ? (
                        <p className="mt-0.5 truncate text-sm text-slate-500">
                          To: {toLine}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <time
                          dateTime={message.receivedAt}
                          className="text-sm text-slate-500"
                        >
                          {formatDateTime(message.receivedAt)}
                        </time>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                          {formatSourceLabel(message.source)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {!expanded ? (
                    <p className="mt-1 truncate text-sm text-slate-600">
                      {bodyPreview(uniqueText || message.bodyText)}
                    </p>
                  ) : null}
                </div>
              </button>
              {expanded ? (
                <DeleteEmailButton
                  emailId={message.id}
                  subject={message.subject}
                  source={message.source}
                  onDeleted={removeMessage}
                />
              ) : null}
            </div>

            {expanded ? (
              <div className="border-t border-slate-100 px-5 pb-5 pt-3">
                <p className="mb-3 font-medium text-slate-900">{message.subject}</p>

                {quoteMissing && messageQuote ? (
                  <div className="mb-3">
                    <p className="mb-1 text-xs text-slate-500">
                      Quote was not found in this email's unique content
                    </p>
                    <SourceQuoteDisplay quote={messageQuote} />
                  </div>
                ) : null}

                <div className="text-slate-800">
                  {(() => {
                    const emailTodos = todosByEmailId?.[message.id] ?? [];
                    if (emailTodos.length > 0) {
                      return (
                        <TodoHarvestBody
                          text={
                            uniqueText ||
                            message.bodyDisplay.content ||
                            message.bodyText
                          }
                          todos={emailTodos}
                          focusQuote={messageQuote}
                        />
                      );
                    }
                    return (
                      <HighlightedFullBody
                        display={message.bodyDisplay}
                        uniqueText={uniqueText}
                        contactExtraction={contactExtraction}
                        uniqueOnly={uniqueContentOnly}
                        highlightQuote={messageQuote}
                      />
                    );
                  })()}
                </div>

                {!hideAttachments && !uniqueContentOnly && visibleAttachments.length > 0 ? (
                  <ul className="mt-4 space-y-1 rounded-md border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
                    {visibleAttachments.map((attachment) => (
                      <li key={attachment.id}>
                        {attachment.filename} ({attachment.mimeType})
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
