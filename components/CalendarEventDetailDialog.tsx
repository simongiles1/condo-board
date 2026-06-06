"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { CalendarEventSourceDetail } from "@/lib/calendar/event-source";
import { attachmentKind } from "@/lib/email/attachment-display";
import { filterVisibleAttachments } from "@/lib/email/attachment-visibility";
import { emailMessageDetailHref } from "@/lib/email/thread-filter-params";
import { formatDateTime } from "@/lib/format/datetime";
import { useAttachmentVisibilitySettings } from "@/lib/settings/attachment-visibility-settings";

type Props = {
  eventId: string | null;
  onClose: () => void;
};

function eventTypeLabel(eventType: string): string {
  return eventType.charAt(0).toUpperCase() + eventType.slice(1);
}

function formatEventWhen(startAt: string): string {
  if (startAt.includes("T")) {
    return formatDateTime(startAt);
  }
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "America/Toronto",
    }).format(new Date(`${startAt}T12:00:00`));
  } catch {
    return startAt;
  }
}

export function CalendarEventDetailDialog({ eventId, onClose }: Props) {
  const visibilitySettings = useAttachmentVisibilitySettings();
  const [detail, setDetail] = useState<CalendarEventSourceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [eventId, onClose]);

  useEffect(() => {
    if (!eventId) {
      setDetail(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);

    fetch(`/api/calendar/events/${eventId}/source`)
      .then(async (response) => {
        const data = (await response.json()) as CalendarEventSourceDetail & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load event source.");
        }
        return data;
      })
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Failed to load event source.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (!eventId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-event-dialog-title"
        className="relative flex max-h-[min(90dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
                {detail ? eventTypeLabel(detail.event.eventType) : "Event"}
              </p>
              <h2
                id="calendar-event-dialog-title"
                className="mt-1 text-lg font-semibold text-slate-900"
              >
                {detail?.event.title ?? "Loading…"}
              </h2>
              {detail ? (
                <p className="mt-1 text-sm text-slate-600">
                  {formatEventWhen(detail.event.startAt)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-3">
              <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
              <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {detail && !loading && !error ? (
            <div className="space-y-4">
              {detail.event.description ? (
                <p className="text-sm text-slate-700">{detail.event.description}</p>
              ) : null}

              {detail.source?.sourceQuote ? (
                <blockquote className="rounded-lg border-l-4 border-teal-200 bg-teal-50/60 px-3 py-2 text-sm italic text-slate-700">
                  &ldquo;{detail.source.sourceQuote}&rdquo;
                </blockquote>
              ) : null}

              {detail.source?.kind === "email" ? (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Source email
                  </h3>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <Link
                      href={emailMessageDetailHref(detail.source.emailId)}
                      className="font-medium text-teal-800 hover:text-teal-950 hover:underline"
                    >
                      {detail.source.subject}
                    </Link>
                    <p className="mt-1 text-sm text-slate-600">
                      From {detail.source.fromAddress}
                    </p>
                    <p className="text-sm text-slate-500">
                      Received {formatDateTime(detail.source.receivedAt)}
                    </p>
                  </div>

                  {filterVisibleAttachments(
                    detail.source.attachments,
                    "calendar",
                    visibilitySettings,
                  ).length > 0 ? (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Attachments analyzed with this email
                      </h4>
                      <ul className="space-y-1">
                        {filterVisibleAttachments(
                          detail.source.attachments,
                          "calendar",
                          visibilitySettings,
                        ).map((attachment) => (
                          <li
                            key={attachment.id}
                            className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm"
                          >
                            <span className="min-w-0 flex-1 truncate text-slate-800">
                              {attachment.filename}
                            </span>
                            <span className="shrink-0 text-xs uppercase text-slate-400">
                              {attachmentKind(attachment.mimeType)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {detail.source?.kind === "meeting" ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Source meeting
                  </h3>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <Link
                      href={`/meetings/${detail.source.meetingId}`}
                      className="font-medium text-teal-800 hover:text-teal-950 hover:underline"
                    >
                      {detail.source.title}
                    </Link>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatEventWhen(detail.source.meetingDate)}
                    </p>
                  </div>
                </section>
              ) : null}

              {!detail.source ? (
                <p className="text-sm text-slate-600">
                  No source record found for this event.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
