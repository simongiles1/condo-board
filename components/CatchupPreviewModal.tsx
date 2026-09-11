"use client";

import { useState } from "react";

import { formatDateTime } from "@/lib/format/datetime";

export type CatchupPreviewMessageRow = {
  gmailMessageId: string;
  gmailThreadId: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  receivedAt: string;
  alreadyInArchive: boolean;
  matchedAllowlistAddresses: string[];
  gmailUrl: string;
};

type Props = {
  open: boolean;
  loading: boolean;
  error: string | null;
  query: string | null;
  sinceIso: string | null;
  messages: CatchupPreviewMessageRow[];
  truncated: boolean;
  onClose: () => void;
};

function formatParticipantList(values: string[]): string {
  if (values.length === 0) return "—";
  if (values.length <= 2) return values.join(", ");
  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}

export function CatchupPreviewModal({
  open,
  loading,
  error,
  query,
  sinceIso,
  messages,
  truncated,
  onClose,
}: Props) {
  const [copiedQuery, setCopiedQuery] = useState(false);

  if (!open) return null;

  const pending = messages.filter((row) => !row.alreadyInArchive);
  const archived = messages.filter((row) => row.alreadyInArchive);

  async function copyQuery() {
    if (!query) return;
    try {
      await navigator.clipboard.writeText(query);
      setCopiedQuery(true);
      window.setTimeout(() => setCopiedQuery(false), 2000);
    } catch {
      setCopiedQuery(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close catch-up preview"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="catchup-preview-title"
        className="relative flex max-h-[min(85vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
          <h2
            id="catchup-preview-title"
            className="text-lg font-semibold text-slate-900"
          >
            Catch-up window messages
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Messages Gmail returns for allowlist catch-up
            {sinceIso ? (
              <>
                {" "}
                since {formatDateTime(sinceIso)}
              </>
            ) : (
              " in the last 2 days"
            )}
            .
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-slate-500">Loading from Gmail…</p>
          ) : error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-800">
                {messages.length.toLocaleString()} message
                {messages.length === 1 ? "" : "s"} in this window
                {messages.length > 0 ? (
                  <>
                    {" · "}
                    <span className="text-teal-900">
                      {pending.length.toLocaleString()} not in archive
                    </span>
                    {" · "}
                    {archived.length.toLocaleString()} already imported
                  </>
                ) : null}
              </p>

              {messages.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">
                  Gmail returned no allowlist messages for this catch-up search.
                </p>
              ) : (
                <div className="mt-4 space-y-6">
                  {pending.length > 0 ? (
                    <section>
                      <h3 className="text-sm font-semibold text-teal-900">
                        Not in archive yet ({pending.length})
                      </h3>
                      <ul className="mt-2 space-y-3">
                        {pending.map((row) => (
                          <CatchupMessageCard key={row.gmailMessageId} row={row} />
                        ))}
                      </ul>
                    </section>
                  ) : (
                    <p className="text-sm text-slate-600">
                      Nothing here still needs importing. Messages can still
                      appear when they were received before your last sync but
                      match Gmail&apos;s day-based{" "}
                      <code className="text-[11px]">after:</code> filter — they
                      are listed under &quot;Already in archive&quot; below.
                    </p>
                  )}

                  {archived.length > 0 ? (
                    <section>
                      <h3 className="text-sm font-semibold text-slate-700">
                        Already in archive ({archived.length})
                      </h3>
                      <ul className="mt-2 space-y-3">
                        {archived.map((row) => (
                          <CatchupMessageCard key={row.gmailMessageId} row={row} />
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>
              )}

              {truncated ? (
                <p className="mt-4 text-xs text-slate-500">
                  Showing the first 200 matches. Run Sync now to import the
                  rest.
                </p>
              ) : null}

              {query ? (
                <details className="mt-6 rounded-lg border border-slate-200 bg-slate-50">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700">
                    Gmail search query (advanced)
                  </summary>
                  <pre className="max-h-40 overflow-y-auto border-t border-slate-200 px-3 py-2 font-mono text-[11px] leading-snug whitespace-pre-wrap break-all text-slate-600">
                    {query}
                  </pre>
                </details>
              ) : null}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-3">
          {query && !loading ? (
            <button
              type="button"
              onClick={() => void copyQuery()}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              {copiedQuery ? "Copied" : "Copy Gmail search"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function CatchupMessageCard({ row }: { row: CatchupPreviewMessageRow }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium text-slate-900">{row.subject}</p>
        <a
          href={row.gmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs font-medium text-teal-800 hover:underline"
        >
          Open in Gmail
        </a>
      </div>
      <p className="mt-1 text-slate-600">
        <span className="font-medium text-slate-700">From:</span> {row.fromAddress}
      </p>
      <p className="mt-0.5 text-slate-600">
        <span className="font-medium text-slate-700">To:</span>{" "}
        {formatParticipantList(row.toAddresses)}
      </p>
      {row.ccAddresses.length > 0 ? (
        <p className="mt-0.5 text-slate-600">
          <span className="font-medium text-slate-700">Cc:</span>{" "}
          {formatParticipantList(row.ccAddresses)}
        </p>
      ) : null}
      <p className="mt-0.5 text-slate-600">
        <span className="font-medium text-slate-700">Received:</span>{" "}
        {formatDateTime(row.receivedAt)}
      </p>
      {row.matchedAllowlistAddresses.length > 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          Allowlist match: {row.matchedAllowlistAddresses.join(", ")}
        </p>
      ) : null}
    </li>
  );
}
