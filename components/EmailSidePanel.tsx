"use client";

import { useEffect, useState } from "react";

import { EmailAttachmentPreviewRow } from "@/components/EmailAttachmentPreviewRow";
import {
  EmailThreadMessages,
  type ThreadMessage,
} from "@/components/EmailThreadMessages";
import { filterVisibleAttachments } from "@/lib/email/attachment-visibility";
import { formatDateTime } from "@/lib/format/datetime";
import { useAttachmentVisibilitySettings } from "@/lib/settings/attachment-visibility-settings";

type Props = {
  emailId: string | null;
  onClose: () => void;
  threadId?: string | null;
  highlightQuote?: string | null;
};

type EmailResponse = {
  message: ThreadMessage & { processedAt: string | null };
  error?: string;
};

type ThreadResponse = {
  thread?: { subject: string };
  messages?: Array<{ id: string }>;
  error?: string;
};

export function EmailSidePanel({
  emailId,
  onClose,
  threadId = null,
  highlightQuote = null,
}: Props) {
  const visibilitySettings = useAttachmentVisibilitySettings();
  const [message, setMessage] = useState<ThreadMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[] | null>(
    null,
  );
  const [threadSubject, setThreadSubject] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = Boolean(emailId || threadId);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setMessage(null);
      setThreadMessages(null);
      setThreadSubject(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    setThreadMessages(null);
    setThreadSubject(null);

    async function loadMessage(id: string): Promise<ThreadMessage> {
      const response = await fetch(`/api/email/messages/${id}`);
      const data = (await response.json()) as EmailResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Could not load email.");
      }
      return data.message;
    }

    async function load() {
      if (threadId) {
        const response = await fetch(`/api/email/threads/${threadId}`);
        const data = (await response.json()) as ThreadResponse;
        if (!response.ok) {
          throw new Error(data.error ?? "Could not load email thread.");
        }
        const headers = data.messages ?? [];
        const loaded = await Promise.all(
          headers.map((header) => loadMessage(header.id)),
        );
        const byId = new Map(loaded.map((item) => [item.id, item]));
        const ordered = headers
          .map((header) => byId.get(header.id))
          .filter((item): item is ThreadMessage => Boolean(item));
        if (!cancelled) {
          setThreadSubject(data.thread?.subject ?? ordered[0]?.subject ?? null);
          setThreadMessages(ordered);
          if (emailId) {
            setMessage(ordered.find((item) => item.id === emailId) ?? null);
          }
        }
        return;
      }

      if (!emailId) return;
      const loadedMessage = await loadMessage(emailId);
      if (!cancelled) setMessage(loadedMessage);
    }

    load()
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Could not load email.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [emailId, threadId, open]);

  if (!open) return null;

  const threadMode = Boolean(threadId);
  const headerMessage =
    message ??
    threadMessages?.find((item) => item.id === emailId) ??
    threadMessages?.[0] ??
    null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/25"
        onClick={onClose}
        aria-label="Close email panel"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-side-panel-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {threadMode ? "Source thread" : "Source email"}
            </p>
            <h2
              id="email-side-panel-title"
              className="mt-1 text-lg font-semibold text-slate-900"
            >
              {threadSubject ?? headerMessage?.subject ?? "Loading…"}
            </h2>
            {headerMessage ? (
              <p className="mt-1 text-sm text-slate-600">
                {threadMode
                  ? `${threadMessages?.length ?? 0} email${
                      (threadMessages?.length ?? 0) === 1 ? "" : "s"
                    } · source message expanded`
                  : `From ${headerMessage.fromAddress} · Received ${formatDateTime(headerMessage.receivedAt)}`}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
              <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {!loading && !error && threadMode && threadMessages ? (
            <EmailThreadMessages
              messages={threadMessages}
              hideAttachments
              focusEmailId={emailId}
              highlightQuote={highlightQuote}
            />
          ) : null}

          {!loading && !error && !threadMode && message ? (
            <>
              <EmailAttachmentPreviewRow
                attachments={filterVisibleAttachments(
                  message.attachments,
                  "sidePanel",
                  visibilitySettings,
                )}
              />
              <EmailThreadMessages
                messages={[message]}
                hideAttachments
                highlightQuote={highlightQuote}
              />
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}
