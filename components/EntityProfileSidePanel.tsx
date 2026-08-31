"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { calendarEventTypeLabel } from "@/lib/calendar/event-types";
import { emailMessageDetailHref } from "@/lib/email/thread-filters";
import { formatConceptEventDate } from "@/lib/entities/concept-links";
import {
  highlightMarkKind,
  snippetNeedlesForEmail,
  type EntityProfileKind,
  type EntityProfilePayload,
} from "@/lib/entities/entity-profile-shared";
import { formatDateTime } from "@/lib/format/datetime";
import {
  ORG_HIGHLIGHT_CLASS,
  ORG_NAME_HIGHLIGHT_FADED_CLASS,
} from "@/lib/email-analysis/org-highlight-shared";
import { highlightTextParts } from "@/lib/organizations/registry-evidence-shared";

type FetchTarget = {
  kind: EntityProfileKind;
  id: string;
  nameHint: string | null;
  focusedAlias?: string | null;
};

type Props = {
  open: boolean;
  fetchTarget: FetchTarget | null;
  profile: EntityProfilePayload | null;
  loading: boolean;
  error: string | null;
  page: number;
  scope: "content" | "all";
  onProfile: (profile: EntityProfilePayload | null) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: string | null) => void;
  onPage: (page: number | ((prev: number) => number)) => void;
  onScope: (scope: "content" | "all") => void;
  onClose: () => void;
};

function kindLabel(kind: EntityProfileKind): string {
  if (kind === "person") return "Person";
  if (kind === "organization") return "Organization";
  if (kind === "project") return "Project";
  if (kind === "equipment") return "Equipment";
  return "Calendar event";
}

function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">
        {value?.trim() ? value : <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}

function LetterheadAvatar({
  initials,
  kind,
}: {
  initials: string;
  kind: EntityProfileKind;
}) {
  const tone =
    kind === "person"
      ? "bg-violet-100 text-violet-900"
      : kind === "organization"
        ? "bg-fuchsia-100 text-fuchsia-900"
        : kind === "project"
          ? "bg-orange-100 text-orange-900"
          : kind === "equipment"
            ? "bg-amber-100 text-amber-900"
            : "bg-sky-100 text-sky-900";
  return (
    <span
      className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${tone}`}
      aria-hidden
    >
      {initials}
    </span>
  );
}

function HighlightedSnippet({
  text,
  needles,
  focusedAlias,
  className,
}: {
  text: string;
  needles: string[];
  focusedAlias: string | null;
  className?: string;
}) {
  const parts = highlightTextParts(text, needles);
  return (
    <p className={className}>
      {parts.map((part, index) =>
        part.hit ? (
          <mark
            key={index}
            className={
              highlightMarkKind(part.needle, focusedAlias) === "faded"
                ? ORG_NAME_HIGHLIGHT_FADED_CLASS
                : ORG_HIGHLIGHT_CLASS.organization_name
            }
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

export function EntityProfileSidePanel({
  open,
  fetchTarget,
  profile,
  loading,
  error,
  page,
  scope,
  onProfile,
  onLoading,
  onError,
  onPage,
  onScope,
  onClose,
}: Props) {
  const [focusedAlias, setFocusedAlias] = useState<string | null>(
    fetchTarget?.focusedAlias?.trim() || null,
  );

  useEffect(() => {
    setFocusedAlias(fetchTarget?.focusedAlias?.trim() || null);
  }, [fetchTarget?.kind, fetchTarget?.id, fetchTarget?.focusedAlias]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!fetchTarget) return;

    let cancelled = false;
    onLoading(true);
    onError(null);

    const params = new URLSearchParams({
      kind: fetchTarget.kind,
      id: fetchTarget.id,
      page: String(page),
    });
    if (fetchTarget.nameHint) params.set("name", fetchTarget.nameHint);
    if (fetchTarget.kind === "person") params.set("scope", scope);

    fetch(`/api/entities/profile?${params}`)
      .then(async (response) => {
        const data = (await response.json()) as {
          profile?: EntityProfilePayload;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error ?? "Could not load profile.");
        }
        return data.profile!;
      })
      .then((loaded) => {
        if (!cancelled) onProfile(loaded);
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          onError(
            fetchError instanceof Error
              ? fetchError.message
              : "Could not load profile.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) onLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchTarget, page, scope, onError, onLoading, onProfile]);

  if (!open) return null;

  const titleId = "entity-profile-panel-title";
  const paging =
    profile && "paging" in profile ? profile.paging : null;
  const emails = profile && "emails" in profile ? profile.emails : [];

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/25"
        onClick={onClose}
        aria-label="Close profile panel"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {profile ? (
              <LetterheadAvatar
                initials={profile.initials}
                kind={profile.kind}
              />
            ) : (
              <span className="inline-flex h-14 w-14 shrink-0 rounded-full bg-slate-100" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {profile ? kindLabel(profile.kind) : "Profile"}
              </p>
              <h2
                id={titleId}
                className="mt-1 text-lg font-semibold text-slate-900"
              >
                {profile?.displayName ?? "Loading…"}
              </h2>
              {profile?.kind === "person" && profile.title ? (
                <p className="mt-0.5 text-sm text-slate-600">{profile.title}</p>
              ) : null}
              {profile?.kind === "organization" && profile.role ? (
                <p className="mt-0.5 text-sm text-slate-600">{profile.role}</p>
              ) : null}
            </div>
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
          {loading && !profile ? (
            <p className="p-4 text-sm text-slate-500">Loading profile…</p>
          ) : null}
          {error ? <p className="p-4 text-sm text-rose-700">{error}</p> : null}

          {profile ? (
            <div className="space-y-5 px-5 py-4">
              {profile.linked ? null : (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  Not linked to a registry card yet.
                </p>
              )}

              {profile.kind === "person" ? (
                <dl className="space-y-1.5">
                  <FieldRow label="Email" value={profile.email} />
                  <FieldRow label="Phone" value={profile.phone} />
                  <FieldRow
                    label="Organization"
                    value={profile.organizationName}
                  />
                </dl>
              ) : null}

              {profile.kind === "organization" ? (
                <dl className="space-y-1.5">
                  <FieldRow label="Email" value={profile.email} />
                  <FieldRow label="Phone" value={profile.phone} />
                  <FieldRow label="Website" value={profile.website} />
                </dl>
              ) : null}

              {profile.kind === "organization" &&
              (profile.previewNeedles?.length ?? 0) > 1 ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Names in mail
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(profile.previewNeedles ?? []).map((alias) => {
                      const selected =
                        focusedAlias?.trim().toLowerCase() ===
                        alias.trim().toLowerCase();
                      return (
                        <button
                          type="button"
                          key={alias}
                          aria-pressed={selected}
                          onClick={() =>
                            setFocusedAlias(selected ? null : alias)
                          }
                          className={
                            selected
                              ? "rounded-full bg-violet-200 px-2.5 py-0.5 text-xs font-semibold text-violet-950"
                              : "rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-800 hover:bg-violet-100"
                          }
                        >
                          {alias}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {profile.kind === "project" ? (
                <dl className="space-y-1.5">
                  <FieldRow label="Years" value={profile.yearHint} />
                  <FieldRow label="Phase" value={profile.phase} />
                  <FieldRow label="Contractor" value={profile.contractor} />
                  <FieldRow label="Location" value={profile.location} />
                  <FieldRow
                    label="Equipment"
                    value={profile.equipmentMentions}
                  />
                </dl>
              ) : null}

              {profile.kind === "equipment" ? (
                <dl className="space-y-1.5">
                  <FieldRow label="Manufacturer" value={profile.manufacturer} />
                  <FieldRow label="Category" value={profile.category} />
                  <FieldRow label="Location" value={profile.location} />
                  <FieldRow label="Kind" value={profile.equipmentKind} />
                  <FieldRow label="Notes" value={profile.notes} />
                </dl>
              ) : null}

              {profile.kind === "event" ? (
                <dl className="space-y-1.5">
                  <FieldRow
                    label="When"
                    value={
                      profile.startAt
                        ? formatConceptEventDate(profile.startAt)
                        : null
                    }
                  />
                  <FieldRow
                    label="Type"
                    value={
                      profile.eventType
                        ? calendarEventTypeLabel(profile.eventType)
                        : null
                    }
                  />
                  <FieldRow label="Notes" value={profile.description} />
                  {profile.calendarHref ? (
                    <div className="pt-1">
                      <Link
                        href={profile.calendarHref}
                        className="text-sm font-medium text-sky-800 underline decoration-sky-300 underline-offset-2 hover:text-sky-950"
                        onClick={onClose}
                      >
                        View on calendar
                      </Link>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              {profile.kind === "person" && profile.involveWhen ? (
                <section className="rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-800">
                    Get me involved when
                    <span className="ml-1.5 font-medium normal-case tracking-normal text-violet-700/80">
                      · Role-based
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-slate-800">
                    {profile.involveWhen.prompt}
                  </p>
                  {profile.involveWhen.examples.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
                      {profile.involveWhen.examples.map((example) => (
                        <li key={example}>{example}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}

              {profile.registryHref ? (
                <p>
                  <Link
                    href={profile.registryHref}
                    className="text-sm font-medium text-teal-800 underline decoration-teal-300 underline-offset-2 hover:text-teal-950"
                    onClick={onClose}
                  >
                    Open in registry
                  </Link>
                </p>
              ) : null}

              {profile.kind === "person" ||
              profile.kind === "organization" ||
              profile.kind === "project" ? (
                <section>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">
                      Emails
                    </h3>
                    {loading ? (
                      <span className="text-xs text-slate-400">Updating…</span>
                    ) : null}
                  </div>
                  {paging && paging.matchedCount > 0 ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {(paging.page - 1) * paging.pageSize + 1}–
                      {(paging.page - 1) * paging.pageSize + emails.length} of{" "}
                      {paging.matchedCount} harvested mention
                      {paging.matchedCount === 1 ? "" : "s"}
                    </p>
                  ) : null}

                  {profile.kind === "person" ? (
                    <div className="mt-2">
                      <div
                        className="inline-flex rounded-md border border-slate-200 p-0.5"
                        role="group"
                        aria-label="Evidence filter"
                      >
                        <button
                          type="button"
                          onClick={() => onScope("content")}
                          className={
                            scope === "content"
                              ? "rounded px-3 py-1.5 text-xs font-semibold bg-teal-700 text-white"
                              : "rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          }
                        >
                          Content
                          {` (${profile.contentCount})`}
                        </button>
                        <button
                          type="button"
                          onClick={() => onScope("all")}
                          className={
                            scope === "all"
                              ? "rounded px-3 py-1.5 text-xs font-semibold bg-teal-700 text-white"
                              : "rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          }
                        >
                          All
                          {` (${profile.contentCount + profile.participationOnlyCount})`}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {emails.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">
                      {profile.linked
                        ? "No emails found for this card."
                        : "Emails appear after this mention is linked to a registry card."}
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                      {emails.map((row) => {
                        const needles = snippetNeedlesForEmail({
                          previewNeedles: profile.previewNeedles,
                          highlightNeedles: row.highlightNeedles,
                          fallback: profile.displayName,
                        });
                        return (
                          <li key={row.id}>
                            <Link
                              href={emailMessageDetailHref(row.id)}
                              onClick={onClose}
                              className="block px-0 py-3 hover:bg-slate-50"
                            >
                              <HighlightedSnippet
                                text={row.subject || "(No subject)"}
                                needles={needles}
                                focusedAlias={focusedAlias}
                                className="text-sm font-medium text-slate-900"
                              />
                              <p className="mt-0.5 text-xs text-slate-500">
                                {row.fromAddress} · {formatDateTime(row.receivedAt)}
                              </p>
                              {row.preview ? (
                                <HighlightedSnippet
                                  text={row.preview}
                                  needles={needles}
                                  focusedAlias={focusedAlias}
                                  className="mt-1 line-clamp-2 text-xs text-slate-600"
                                />
                              ) : null}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ) : null}
            </div>
          ) : null}
        </div>

        {paging && paging.totalPages > 1 ? (
          <nav
            aria-label="Profile email pagination"
            className="flex shrink-0 items-center gap-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-600"
          >
            <button
              type="button"
              disabled={loading || paging.page <= 1}
              onClick={() => onPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="flex-1 text-center">
              Page {paging.page} of {paging.totalPages}
            </span>
            <button
              type="button"
              disabled={loading || paging.page >= paging.totalPages}
              onClick={() =>
                onPage((p) => Math.min(paging.totalPages, p + 1))
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
