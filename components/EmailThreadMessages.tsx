"use client";

import { useEffect, useState } from "react";

import { DeleteEmailButton } from "@/components/DeleteEmailButton";
import { formatDateTime } from "@/lib/format/datetime";

type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
};

export type ThreadMessage = {
  id: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  receivedAt: string;
  source: string;
  bodyText: string;
  attachments: Attachment[];
};

function bodyPreview(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "(No plain-text body)";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

export function EmailThreadMessages({ messages }: { messages: ThreadMessage[] }) {
  const [visibleMessages, setVisibleMessages] = useState(messages);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const newestId = messages.at(0)?.id;
    return newestId ? new Set([newestId]) : new Set();
  });

  useEffect(() => {
    setVisibleMessages(messages);
    const newestId = messages.at(0)?.id;
    setExpandedIds(newestId ? new Set([newestId]) : new Set());
  }, [messages]);

  function removeMessage(emailId: string) {
    setVisibleMessages((prev) => prev.filter((message) => message.id !== emailId));
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(emailId);
      return next;
    });
  }

  function toggleMessage(id: string) {
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

        return (
          <article
            key={message.id}
            className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
          >
            <button
              type="button"
              onClick={() => toggleMessage(message.id)}
              aria-expanded={expanded}
              className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-slate-50"
            >
              <span
                aria-hidden
                className="mt-0.5 shrink-0 text-xs text-slate-400"
              >
                {expanded ? "▼" : "▶"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-medium text-slate-900">{message.fromAddress}</p>
                  <time
                    dateTime={message.receivedAt}
                    className="shrink-0 text-sm text-slate-500"
                  >
                    {formatDateTime(message.receivedAt)}
                  </time>
                </div>
                {!expanded ? (
                  <p className="mt-1 truncate text-sm text-slate-600">
                    {bodyPreview(message.bodyText)}
                  </p>
                ) : null}
              </div>
            </button>

            {expanded ? (
              <div className="border-t border-slate-100 px-5 pb-5 pt-4">
                <header className="border-b border-slate-100 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-medium text-slate-900">
                      {message.subject}
                    </p>
                    <DeleteEmailButton
                      emailId={message.id}
                      subject={message.subject}
                      source={message.source}
                      onDeleted={removeMessage}
                    />
                  </div>
                  <dl className="mt-2 grid gap-1 text-sm text-slate-700">
                    <div>
                      <dt className="inline font-medium">From: </dt>
                      <dd className="inline">{message.fromAddress}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">To: </dt>
                      <dd className="inline">{message.toAddresses.join(", ")}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Received: </dt>
                      <dd className="inline">
                        {formatDateTime(message.receivedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Source: </dt>
                      <dd className="inline">{message.source}</dd>
                    </div>
                  </dl>
                </header>

                <div className="prose prose-sm mt-4 max-w-none whitespace-pre-wrap text-slate-800">
                  {message.bodyText || "(No plain-text body)"}
                </div>

                {message.attachments.length > 0 ? (
                  <ul className="mt-4 space-y-1 rounded-md border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
                    {message.attachments.map((attachment) => (
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
