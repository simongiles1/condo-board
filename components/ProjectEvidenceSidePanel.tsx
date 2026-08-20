"use client";

import { useEffect, useState, type ReactNode } from "react";

import type { EmailBodyDisplay } from "@/lib/email/format-body-display";
import { collapseEmailPlainWhitespace } from "@/lib/email/format-body-display";
import {
  PROJECT_HIGHLIGHT_CLASS,
  type ProjectHighlightType,
} from "@/lib/email-analysis/project-highlight-shared";
import { formatDateTime } from "@/lib/format/datetime";
import {
  findNeedleRanges,
  projectEvidenceFieldLabel,
  projectEvidenceMatchReasonLabel,
  type ProjectEvidenceField,
  type ProjectEvidenceMatchReason,
  type ProjectEvidencePayload,
} from "@/lib/projects/registry-evidence-shared";

type Props = {
  target: {
    projectId: string;
    projectName: string;
    field: ProjectEvidenceField;
    value: string;
  } | null;
  onClose: () => void;
};

type MessageBody = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  bodyDisplay: EmailBodyDisplay;
  bodyDisplayUnique?: EmailBodyDisplay | null;
};

function highlightTypeForField(field: ProjectEvidenceField): ProjectHighlightType {
  if (field === "year_hint") return "year_hint";
  if (field === "phase") return "phase";
  if (field === "contractor") return "contractor";
  if (field === "location") return "location";
  return "project_name";
}

function resolveEvidenceBodyText(message: MessageBody): string {
  const unique = message.bodyDisplayUnique?.content?.trim();
  if (unique) {
    return collapseEmailPlainWhitespace(message.bodyDisplayUnique!.content);
  }
  return collapseEmailPlainWhitespace(message.bodyDisplay.content);
}

function MarkedBody({
  text,
  needles,
  field,
}: {
  text: string;
  needles: string[];
  field: ProjectEvidenceField;
}): ReactNode {
  if (!text.trim()) {
    return <p className="text-sm text-slate-500">(No plain-text body)</p>;
  }
  const ranges = findNeedleRanges(text, needles);
  if (ranges.length === 0) {
    return (
      <div className="prose prose-sm max-w-none whitespace-pre-wrap">{text}</div>
    );
  }
  const cls = PROJECT_HIGHLIGHT_CLASS[highlightTypeForField(field)];
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(
        <span key={`t-${index}`}>{text.slice(cursor, range.start)}</span>,
      );
    }
    parts.push(
      <mark key={`m-${index}`} className={cls}>
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) {
    parts.push(<span key="tail">{text.slice(cursor)}</span>);
  }
  return (
    <div className="prose prose-sm max-w-none whitespace-pre-wrap">{parts}</div>
  );
}

function MatchReasonChips({
  reasons,
}: {
  reasons: ProjectEvidenceMatchReason[];
}) {
  if (reasons.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {reasons.map((reason) => (
        <span
          key={reason}
          className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600"
        >
          {projectEvidenceMatchReasonLabel(reason)}
        </span>
      ))}
    </span>
  );
}

function EvidenceEmailRow({
  emailId,
  subject,
  fromAddress,
  receivedAt,
  preview,
  matchReasons,
  needles,
  field,
}: {
  emailId: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  preview: string;
  matchReasons: ProjectEvidenceMatchReason[];
  needles: string[];
  field: ProjectEvidenceField;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<MessageBody | null>(null);

  useEffect(() => {
    if (!open || message) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/email/messages/${emailId}`)
      .then(async (response) => {
        const data = (await response.json()) as {
          message?: MessageBody;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error ?? "Could not load email.");
        }
        return data.message!;
      })
      .then((loaded) => {
        if (!cancelled) setMessage(loaded);
      })
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
  }, [open, emailId, message]);

  const bodyText = message ? resolveEvidenceBodyText(message) : "";

  return (
    <li className="border-b border-slate-100">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full px-4 py-3 text-left hover:bg-slate-50"
      >
        <p className="text-sm font-medium text-slate-900">
          {subject.trim() || "(no subject)"}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {fromAddress} · {formatDateTime(receivedAt)}
        </p>
        <MatchReasonChips reasons={matchReasons} />
        {preview.trim() ? (
          <p className="mt-1 line-clamp-2 text-xs text-slate-600">{preview}</p>
        ) : null}
      </button>
      {open ? (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
          {loading ? (
            <p className="text-sm text-slate-500">Loading email…</p>
          ) : null}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          {message ? (
            <MarkedBody text={bodyText} needles={needles} field={field} />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ProjectEvidenceSidePanel({ target, onClose }: Props) {
  const [evidence, setEvidence] = useState<ProjectEvidencePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
    setEvidence(null);
    setError(null);
  }, [target?.projectId, target?.field, target?.value]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      projectId: target.projectId,
      projectName: target.projectName,
      field: target.field,
      value: target.value,
      page: String(page),
    });
    fetch(`/api/projects/evidence?${params.toString()}`)
      .then(async (response) => {
        const data = (await response.json()) as {
          evidence?: ProjectEvidencePayload;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error ?? "Could not load evidence.");
        }
        return data.evidence!;
      })
      .then((loaded) => {
        if (!cancelled) setEvidence(loaded);
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Could not load evidence.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, page]);

  if (!target) return null;

  const rangeStart =
    evidence && evidence.matchedCount > 0
      ? (evidence.page - 1) * evidence.pageSize + 1
      : 0;
  const rangeEnd = evidence
    ? Math.min(evidence.page * evidence.pageSize, evidence.matchedCount)
    : 0;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/25"
        onClick={onClose}
        aria-label="Close evidence panel"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-evidence-panel-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {projectEvidenceFieldLabel(target.field)} evidence
            </p>
            <h2
              id="project-evidence-panel-title"
              className="mt-1 text-lg font-semibold text-slate-900"
            >
              {evidence?.value ?? target.value}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              For {target.projectName}
            </p>
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !evidence ? (
            <p className="p-4 text-sm text-slate-500">Loading evidence…</p>
          ) : null}
          {error ? <p className="p-4 text-sm text-rose-700">{error}</p> : null}
          {evidence ? (
            evidence.matchedCount === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                {target.field === "source_emails"
                  ? "No source emails found for this project."
                  : `No emails found where this ${projectEvidenceFieldLabel(target.field).toLowerCase()} was extracted as a project field.`}
              </p>
            ) : (
              <>
                <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
                  {rangeStart}–{rangeEnd} of {evidence.matchedCount} email
                  {evidence.matchedCount === 1 ? "" : "s"}
                  {loading ? " · updating…" : ""}
                  {target.field === "source_emails"
                    ? " · emails attributed to this project"
                    : " · project-card or highlight extractions"}
                </p>
                <ul>
                  {evidence.emails.map((row) => (
                    <EvidenceEmailRow
                      key={row.id}
                      emailId={row.id}
                      subject={row.subject}
                      fromAddress={row.fromAddress}
                      receivedAt={row.receivedAt}
                      preview={row.preview}
                      matchReasons={row.matchReasons}
                      needles={
                        evidence.needles.length > 0
                          ? evidence.needles
                          : [evidence.value]
                      }
                      field={evidence.field}
                    />
                  ))}
                </ul>
              </>
            )
          ) : null}
        </div>

        {evidence && evidence.totalPages > 1 ? (
          <nav
            aria-label="Evidence email pagination"
            className="flex shrink-0 items-center gap-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-600"
          >
            <button
              type="button"
              disabled={loading || evidence.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="flex-1 text-center">
              Page {evidence.page} of {evidence.totalPages}
            </span>
            <button
              type="button"
              disabled={loading || evidence.page >= evidence.totalPages}
              onClick={() =>
                setPage((p) => Math.min(evidence.totalPages, p + 1))
              }
              className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </nav>
        ) : null}
      </aside>
    </>
  );
}
