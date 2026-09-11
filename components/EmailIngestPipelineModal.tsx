"use client";

import { ingestStageLabel, type IngestRunPublic } from "@/lib/email/ingest-stages";

export function EmailIngestPipelineModal(props: {
  run: IngestRunPublic;
  busy: boolean;
  onClose: () => void;
  onContinue: () => void;
  onAllowlist: (action: "approved" | "denied" | "back") => void;
}) {
  const { run, busy } = props;
  const pending = run.senders.filter((row) => row.status === "pending");
  const decided = run.senders.filter((row) => row.status !== "pending");
  const current =
    pending.find((row) => row.sortIndex >= run.cursorIndex) ?? pending[0];
  const page = decided.length + 1;
  const stageNote =
    typeof run.counts.stageNote === "string" ? run.counts.stageNote : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Email ingest pipeline
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {ingestStageLabel(run.stage)}
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <p className="mt-3 text-sm text-slate-700">
          Status: <strong>{run.status.replaceAll("_", " ")}</strong>
          {" · "}
          {run.newEmailIds.length.toLocaleString()} new emails
        </p>
        {stageNote ? (
          <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {stageNote}
          </p>
        ) : null}
        {run.lastError ? (
          <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {run.lastError}
          </p>
        ) : null}

        {run.status === "waiting_allowlist" && current ? (
          <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-teal-800">
              {page} of {run.senders.length}
            </p>
            <p className="mt-1 font-medium text-slate-900">{current.email}</p>
            <p className="mt-1 text-sm text-slate-600">
              Gmail estimate:{" "}
              {(current.estimatedEmailCount ?? 0).toLocaleString()} messages /{" "}
              {(current.estimatedThreadCount ?? 0).toLocaleString()} threads
              (full history if approved).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => props.onAllowlist("approved")}
                className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => props.onAllowlist("denied")}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
              >
                Deny
              </button>
              <button
                type="button"
                disabled={busy || decided.length === 0}
                onClick={() => props.onAllowlist("back")}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
              >
                Back
              </button>
            </div>
          </div>
        ) : null}

        {run.status === "waiting_continue" ? (
          <div className="mt-4">
            <button
              type="button"
              disabled={busy}
              onClick={props.onContinue}
              className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Working…" : "Continue"}
            </button>
          </div>
        ) : null}

        {run.status === "running" ? (
          <p className="mt-4 text-sm text-slate-600">Working…</p>
        ) : null}

        {run.senders.length > 0 ? (
          <ul className="mt-4 space-y-1 text-sm text-slate-600">
            {run.senders.map((sender) => (
              <li key={sender.id}>
                {sender.email} — {sender.status}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
