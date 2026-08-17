"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  buildEvidenceHighlightSpans,
  findPersonNameAnchorRanges,
} from "@/lib/contacts/person-anchored-highlight";
import type {
  ContactEvidenceKind,
  ContactEvidenceMatchReason,
  ContactEvidencePayload,
  ContactEvidenceScope,
} from "@/lib/contacts/registry-evidence-shared";
import {
  CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE,
  hasContentMatch,
  isParticipationMatchReason,
  matchReasonLabel,
} from "@/lib/contacts/registry-evidence-shared";
import type { EmailBodyDisplay } from "@/lib/email/format-body-display";
import { collapseEmailPlainWhitespace } from "@/lib/email/format-body-display";
import {
  buildHighlightedSegments,
  CONTACT_HIGHLIGHT_CLASS,
  type ContactHighlightSpan,
} from "@/lib/email-analysis/contact-highlight-shared";
import { formatDateTime } from "@/lib/format/datetime";

type Props = {
  target: {
    kind: ContactEvidenceKind;
    attributeId: string;
    label: string;
  } | null;
  onClose: () => void;
};

type MessageBody = {
  id: string;
  subject: string;
  fromAddress: string;
  toAddresses?: string[];
  ccAddresses?: string[];
  receivedAt: string;
  bodyText: string;
  bodyTextUnique?: string | null;
  bodyDisplay: EmailBodyDisplay;
  bodyDisplayUnique?: EmailBodyDisplay | null;
};

function formatRange(from: string | null, to: string | null): string {
  const a = from?.slice(0, 10) ?? "…";
  const b = to?.slice(0, 10) ?? "present";
  return `${a} → ${b}`;
}

function kindLabel(kind: ContactEvidenceKind): string {
  if (kind === "title") return "Title";
  if (kind === "phone") return "Phone";
  if (kind === "person") return "Mentions";
  return "Email";
}

function resolveEvidenceBodyText(message: MessageBody): string {
  // Prefer authored unique display (already quote-stripped + CSS-safe).
  const unique = message.bodyDisplayUnique?.content?.trim();
  if (unique) return collapseEmailPlainWhitespace(message.bodyDisplayUnique!.content);
  return collapseEmailPlainWhitespace(message.bodyDisplay.content);
}

function MarkedBody({
  text,
  spans,
}: {
  text: string;
  spans: ContactHighlightSpan[];
}): ReactNode {
  if (!text.trim()) {
    return (
      <p className="text-sm text-slate-500">(No plain-text body)</p>
    );
  }
  const segments = buildHighlightedSegments(text, spans);
  return (
    <div className="prose prose-sm max-w-none whitespace-pre-wrap">
      {segments.map((segment, index) => {
        if (!segment.type) {
          return <span key={index}>{segment.text}</span>;
        }
        return (
          <mark key={index} className={CONTACT_HIGHLIGHT_CLASS[segment.type]}>
            {segment.text}
          </mark>
        );
      })}
    </div>
  );
}

function MatchReasonChips({
  reasons,
}: {
  reasons: ContactEvidenceMatchReason[];
}) {
  if (reasons.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {reasons.map((reason) => (
        <span
          key={reason}
          className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600"
        >
          {matchReasonLabel(reason)}
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
  person,
  mentionText,
  mentionType,
  evidenceKind,
}: {
  emailId: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  preview: string;
  matchReasons: ContactEvidenceMatchReason[];
  person: ContactEvidencePayload["person"];
  mentionText: string;
  mentionType: ContactEvidencePayload["mentionType"];
  evidenceKind: ContactEvidenceKind;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<MessageBody | null>(null);
  const contentHit = hasContentMatch(matchReasons);
  const participationReasons = matchReasons.filter(isParticipationMatchReason);

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
  const spans =
    message != null
      ? evidenceKind === "person"
        ? findPersonNameAnchorRanges(bodyText, {
            firstName: person.firstName,
            lastName: person.lastName,
          }).map((range) => ({
            type: "contact_name" as const,
            text: bodyText.slice(range.start, range.end),
            start: range.start,
            end: range.end,
          }))
        : buildEvidenceHighlightSpans({
            text: bodyText,
            person: {
              firstName: person.firstName,
              lastName: person.lastName,
            },
            mentionText,
            mentionType,
          })
      : [];

  return (
    <li className="border-b border-slate-100">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-slate-50"
        aria-expanded={open}
      >
        <span className="mt-0.5 shrink-0 text-slate-400" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-900">
            {subject || "(no subject)"}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {fromAddress} · {formatDateTime(receivedAt)}
          </span>
          <MatchReasonChips reasons={matchReasons} />
          {!open ? (
            <span className="mt-1 block text-xs text-slate-500 line-clamp-2">
              {!contentHit && participationReasons.length > 0
                ? `Participation only — ${participationReasons
                    .map(matchReasonLabel)
                    .join(", ")}`
                : preview}
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
          {loading ? (
            <p className="text-sm text-slate-500">Loading email…</p>
          ) : null}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          {message ? (
            <>
              {participationReasons.length > 0 ? (
                <p className="mb-2 text-xs text-slate-600">
                  Participation:{" "}
                  {participationReasons.map(matchReasonLabel).join(", ")}
                  {!contentHit
                    ? " — name not in authored body"
                    : ""}
                </p>
              ) : null}
              <p className="mb-2 text-xs text-slate-500">
                Authored content only (quoted reply history omitted)
              </p>
              <MarkedBody text={bodyText} spans={spans} />
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ContactEvidenceSidePanel({ target, onClose }: Props) {
  const [evidence, setEvidence] = useState<ContactEvidencePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<ContactEvidenceScope>("content");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!target) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [target, onClose]);

  useEffect(() => {
    // Reset filters when opening a different target.
    setScope(target?.kind === "person" ? "content" : "all");
    setPage(1);
    setEvidence(null);
    setError(null);
  }, [target?.kind, target?.attributeId]);

  useEffect(() => {
    if (!target) {
      setEvidence(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      kind: target.kind,
      id: target.attributeId,
      page: String(page),
      pageSize: String(CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE),
    });
    if (target.kind === "person") {
      params.set("scope", scope);
    }
    fetch(`/api/contacts/evidence?${params}`)
      .then(async (response) => {
        const data = (await response.json()) as {
          evidence?: ContactEvidencePayload;
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
  }, [target, scope, page]);

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
        aria-labelledby="contact-evidence-panel-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {kindLabel(target.kind)} evidence
            </p>
            <h2
              id="contact-evidence-panel-title"
              className="mt-1 text-lg font-semibold text-slate-900"
            >
              {evidence?.value ?? target.label}
            </h2>
            {evidence ? (
              <p className="mt-1 text-sm text-slate-600">
                For {evidence.person.displayName}
                {evidence.kind !== "person"
                  ? ` · ${formatRange(evidence.validFrom, evidence.validTo)}`
                  : ""}
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

        {target.kind === "person" ? (
          <div className="shrink-0 border-b border-slate-200 px-4 py-3">
            <div
              className="inline-flex rounded-md border border-slate-200 p-0.5"
              role="group"
              aria-label="Evidence filter"
            >
              <button
                type="button"
                onClick={() => {
                  setScope("content");
                  setPage(1);
                }}
                className={
                  scope === "content"
                    ? "rounded px-3 py-1.5 text-xs font-semibold bg-teal-700 text-white"
                    : "rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                }
              >
                Content
                {evidence ? ` (${evidence.contentCount})` : ""}
              </button>
              <button
                type="button"
                onClick={() => {
                  setScope("all");
                  setPage(1);
                }}
                className={
                  scope === "all"
                    ? "rounded px-3 py-1.5 text-xs font-semibold bg-teal-700 text-white"
                    : "rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                }
              >
                All
                {evidence
                  ? ` (${evidence.contentCount + evidence.participationOnlyCount})`
                  : ""}
              </button>
            </div>
            {evidence && evidence.participationOnlyCount > 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                {evidence.participationOnlyCount} participation-only
                {evidence.participationOnlyCount === 1
                  ? " message"
                  : " messages"}{" "}
                (on From/To/Cc, no name in body)
                {scope === "content" ? " — switch to All to include" : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !evidence ? (
            <p className="p-4 text-sm text-slate-500">Loading evidence…</p>
          ) : null}
          {error ? <p className="p-4 text-sm text-rose-700">{error}</p> : null}
          {evidence ? (
            evidence.matchedCount === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                {target.kind === "email"
                  ? `No source emails found for this address.`
                  : target.kind === "person"
                    ? scope === "content"
                      ? `No emails found mentioning ${evidence.person.displayName} in authored content.`
                      : `No emails found for ${evidence.person.displayName}.`
                    : `No emails found where this ${kindLabel(target.kind).toLowerCase()} appears near ${evidence.person.displayName}'s name.`}
                {evidence.omittedCount > 0
                  ? ` (${evidence.omittedCount} related thread message${evidence.omittedCount === 1 ? "" : "s"} omitted.)`
                  : ""}
              </p>
            ) : (
              <>
                <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
                  {rangeStart}–{rangeEnd} of {evidence.matchedCount} email
                  {evidence.matchedCount === 1 ? "" : "s"}
                  {loading ? " · updating…" : ""}
                  {target.kind === "email"
                    ? " · includes messages from/to/cc this address"
                    : target.kind === "person"
                      ? scope === "content"
                        ? " · name in unique authored text"
                        : " · content + participation"
                      : " · highlights only this person's mention"}
                  {evidence.omittedCount > 0
                    ? ` · ${evidence.omittedCount} thread-wide hits omitted`
                    : ""}
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
                      person={evidence.person}
                      mentionText={evidence.value}
                      mentionType={evidence.mentionType}
                      evidenceKind={evidence.kind}
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
