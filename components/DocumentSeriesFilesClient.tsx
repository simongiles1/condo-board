"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { EmailAttachmentViewerDialog } from "@/components/EmailAttachmentViewerDialog";
import {
  attachmentKind,
  attachmentKindClasses,
  attachmentKindLabel,
  formatAttachmentSize,
} from "@/lib/email/attachment-display";
import { emailMessageDetailHref } from "@/lib/email/thread-filter-params";
import { formatDateTime } from "@/lib/format/datetime";

type SeriesListItem = {
  id: string;
  title: string;
  description: string;
  usage: string | null;
  memberCount: number;
  firstDate: string | null;
  lastDate: string | null;
};

type SeriesMember = {
  contentHash: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  receivedAt: string;
  fromAddress: string;
  subject: string;
  threadId: string | null;
  documentDate: string | null;
  summary: string;
  source: "discovery" | "human";
  subtypeKey: string | null;
  subtypeTitle: string | null;
};

type LinkedFileEmail = {
  emailId: string;
  threadId: string | null;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  pdfAttachmentCount: number;
  links: Array<{ url: string; label: string; kind: "zip" | "cloud" }>;
};

type SeriesRun = {
  id: string;
  status: string;
  totalDocs: number;
  clusteredDocs: number;
  seriesCount: number;
  currentLabel: string | null;
  errorMessage: string | null;
  totalCostUsd: string;
  workerAlive?: boolean;
};

function spanLabel(first: string | null, last: string | null): string | null {
  const a = first?.slice(0, 10) ?? null;
  const b = last?.slice(0, 10) ?? null;
  if (!a && !b) return null;
  if (a && b && a !== b) return `${a} → ${b}`;
  return a || b;
}

/** Keep the same sidebar selection when discovery rewrites series row ids. */
function reconcileActiveSeriesId(
  previous: SeriesListItem[],
  next: SeriesListItem[],
  currentId: string | null,
): string | null {
  if (currentId && next.some((row) => row.id === currentId)) return currentId;
  const previousItem = currentId
    ? previous.find((row) => row.id === currentId)
    : undefined;
  if (previousItem) {
    const byTitle = next.find((row) => row.title === previousItem.title);
    if (byTitle) return byTitle.id;
  }
  return next[0]?.id ?? null;
}

export function DocumentSeriesFilesClient() {
  const [series, setSeries] = useState<SeriesListItem[]>([]);
  const [fileCardCount, setFileCardCount] = useState(0);
  const [run, setRun] = useState<SeriesRun | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [members, setMembers] = useState<SeriesMember[]>([]);
  const [membersTitle, setMembersTitle] = useState("");
  const [membersDescription, setMembersDescription] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  const [subtypeFilter, setSubtypeFilter] = useState("");
  const [linkedFiles, setLinkedFiles] = useState<LinkedFileEmail[]>([]);

  const running = run?.status === "running" && run.workerAlive !== false;

  const reloadList = useCallback(async () => {
    const response = await fetch("/api/documents/series");
    const payload = (await response.json()) as {
      error?: string;
      series?: SeriesListItem[];
      fileCardCount?: number;
      run?: SeriesRun | null;
      linkedFiles?: LinkedFileEmail[];
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "Could not load recurring types.");
    }
    const nextSeries = payload.series ?? [];
    let previousSeries: SeriesListItem[] = [];
    setSeries((prev) => {
      previousSeries = prev;
      return nextSeries;
    });
    setActiveId((current) =>
      reconcileActiveSeriesId(previousSeries, nextSeries, current),
    );
    setFileCardCount(payload.fileCardCount ?? 0);
    setRun(payload.run ?? null);
    setLinkedFiles(payload.linkedFiles ?? []);
    return nextSeries;
  }, []);

  const reloadMembers = useCallback(async (id: string) => {
    const response = await fetch(`/api/documents/series/${id}`);
    const payload = (await response.json()) as {
      error?: string;
      title?: string;
      description?: string;
      members?: SeriesMember[];
    };
    if (!response.ok) {
      if (response.status === 404) {
        return;
      }
      throw new Error(payload.error ?? "Could not load files.");
    }
    setMembersTitle(payload.title ?? "");
    setMembersDescription(payload.description ?? "");
    setMembers(payload.members ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void reloadList()
      .then((rows) => {
        if (cancelled) return;
        setLoadError(null);
        setActiveId((current) => current ?? rows[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Could not load recurring types.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadList]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void reloadList().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [running, reloadList]);

  useEffect(() => {
    if (!activeId) {
      setMembers([]);
      setMembersTitle("");
      setMembersDescription("");
      return;
    }
    if (series.length > 0 && !series.some((row) => row.id === activeId)) {
      return;
    }
    let cancelled = false;
    void reloadMembers(activeId).catch((error: unknown) => {
      if (!cancelled) {
        setLoadError(
          error instanceof Error ? error.message : "Could not load files.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, reloadMembers, run?.status, series]);

  useEffect(() => {
    setSubtypeFilter("");
  }, [activeId]);

  const subtypes = useMemo(() => {
    const counts = new Map<
      string,
      { key: string; title: string; count: number }
    >();
    for (const file of members) {
      if (!file.subtypeKey) continue;
      const current = counts.get(file.subtypeKey);
      if (current) {
        current.count += 1;
      } else {
        counts.set(file.subtypeKey, {
          key: file.subtypeKey,
          title: file.subtypeTitle || file.subtypeKey,
          count: 1,
        });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [members]);

  const visibleMembers = useMemo(() => {
    if (!subtypeFilter) return members;
    return members.filter((file) => file.subtypeKey === subtypeFilter);
  }, [members, subtypeFilter]);

  const previewMember = useMemo(
    () => visibleMembers.find((row) => row.contentHash === previewHash) ?? null,
    [visibleMembers, previewHash],
  );

  async function startDiscovery() {
    setBusy(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/documents/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not start discovery.");
      }
      await reloadList();
    } catch (error: unknown) {
      setLoadError(
        error instanceof Error ? error.message : "Could not start discovery.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelDiscovery() {
    if (!run?.id) return;
    setBusy(true);
    try {
      await fetch("/api/documents/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", runId: run.id }),
      });
      await reloadList();
    } finally {
      setBusy(false);
    }
  }

  async function ejectMember(contentHash: string) {
    if (!activeId) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/documents/series/${activeId}/members?contentHash=${encodeURIComponent(contentHash)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not remove that file.");
      }
      await Promise.all([reloadList(), reloadMembers(activeId)]);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : "Could not remove that file.");
    } finally {
      setBusy(false);
    }
  }

  async function moveMember(contentHash: string, seriesId: string) {
    if (!activeId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/documents/series/${activeId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentHash, seriesId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not move that file.");
      }
      await Promise.all([reloadList(), reloadMembers(activeId)]);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : "Could not move that file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Email attachments
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          Recurring documents
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Types the archive has seen more than once. Open a type, pick a
          subtype when the list is large, then click a file to check that the
          copies belong together.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || running}
            onClick={() => void startDiscovery()}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-950 hover:bg-emerald-100 disabled:opacity-50"
          >
            {running ? "Finding recurring types…" : "Find recurring types"}
          </button>
          {running ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancelDiscovery()}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          ) : null}
          <span className="text-xs text-slate-500">
            {fileCardCount.toLocaleString()} file card
            {fileCardCount === 1 ? "" : "s"} on file
          </span>
        </div>
        {run ? (
          <p className="mt-2 text-sm text-slate-600">
            {run.currentLabel || run.status}
            {run.errorMessage ? ` — ${run.errorMessage}` : ""}
          </p>
        ) : null}
        {loadError ? (
          <p className="mt-2 text-sm text-red-700">{loadError}</p>
        ) : null}
        {linkedFiles.length > 0 ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-950">
              {linkedFiles.length} email
              {linkedFiles.length === 1 ? "" : "s"} sent files as a link, not
              an attachment
            </p>
            <p className="mt-1 text-xs text-amber-900/80">
              Recurring types only see Gmail attachments. Download these (zip
              folders included), then they can be ingested like other files.
              Auto-download is off — many of these links sit behind a login.
            </p>
            <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
              {linkedFiles.map((row) => (
                <li key={row.emailId} className="text-sm text-amber-950">
                  <a
                    href={emailMessageDetailHref(row.emailId)}
                    className="font-medium underline decoration-amber-400 underline-offset-2 hover:text-amber-800"
                  >
                    {row.subject || "(no subject)"}
                  </a>
                  <span className="ml-2 text-xs text-amber-900/70">
                    {formatDateTime(row.receivedAt)}
                    {row.pdfAttachmentCount === 0
                      ? " · no PDF attached"
                      : ` · ${row.pdfAttachmentCount} PDF attached`}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-amber-900/70">
                    {row.links
                      .map((link) => link.label || link.url)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Types ({series.length})
          </div>
          {series.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {fileCardCount === 0
                ? "Create file cards first, then find recurring types."
                : "No recurring types yet. Run Find recurring types."}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {series.map((item) => {
                const selected = item.id === activeId;
                const span = spanLabel(item.firstDate, item.lastDate);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(item.id)}
                      className={`w-full px-3 py-2.5 text-left transition ${
                        selected
                          ? "bg-teal-50"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <span className="block text-sm font-medium text-slate-900">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {item.memberCount} file
                        {item.memberCount === 1 ? "" : "s"}
                        {span ? ` · ${span}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {activeId && membersTitle ? (
            <div className="shrink-0 border-b border-slate-100 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 text-base font-semibold text-slate-900">
                  {membersTitle}
                </h2>
                {subtypes.length > 1 ? (
                  <label className="flex shrink-0 flex-col items-end gap-1 text-xs font-medium text-slate-600">
                    Subtype
                    <select
                      value={subtypeFilter}
                      onChange={(event) => setSubtypeFilter(event.target.value)}
                      className="min-w-[14rem] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm font-normal text-slate-800"
                    >
                      <option value="">
                        All subtypes ({members.length})
                      </option>
                      {subtypes.map((subtype) => (
                        <option key={subtype.key} value={subtype.key}>
                          {subtype.title} ({subtype.count})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              {membersDescription ? (
                <p className="mt-1 text-sm text-slate-600">{membersDescription}</p>
              ) : null}
            </div>
          ) : null}
          {visibleMembers.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-4 py-8 text-sm text-slate-500">
              {activeId
                ? subtypeFilter
                  ? "No files in this subtype."
                  : "No files in this type."
                : "Select a type."}
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {visibleMembers.map((file) => {
                const kind = attachmentKind(file.mimeType, file.filename);
                const sizeLabel = formatAttachmentSize(file.sizeBytes);
                const when = file.receivedAt;
                return (
                  <li
                    key={file.contentHash}
                    className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewHash(file.contentHash)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 text-sm font-medium text-slate-900">
                          {file.filename}
                        </p>
                        <span
                          className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${attachmentKindClasses(kind)}`}
                        >
                          {attachmentKindLabel(kind)}
                        </span>
                        {sizeLabel ? (
                          <span className="shrink-0 text-xs tabular-nums text-slate-500">
                            {sizeLabel}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                        {file.summary || file.subject}
                      </p>
                    </button>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <time
                        dateTime={when}
                        className="whitespace-nowrap text-xs text-slate-500"
                      >
                        {formatDateTime(when)}
                      </time>
                      <div className="flex items-center gap-1">
                        {series.length > 1 ? (
                          <select
                            aria-label="Move to another type"
                            disabled={busy}
                            className="max-w-[9rem] rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-700"
                            defaultValue=""
                            onChange={(event) => {
                              const next = event.target.value;
                              event.target.value = "";
                              if (next) void moveMember(file.contentHash, next);
                            }}
                          >
                            <option value="">Move…</option>
                            {series
                              .filter((item) => item.id !== activeId)
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.title}
                                </option>
                              ))}
                          </select>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void ejectMember(file.contentHash)}
                          className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <EmailAttachmentViewerDialog
        open={Boolean(previewMember)}
        attachment={
          previewMember
            ? {
                id: previewMember.attachmentId,
                filename: previewMember.filename,
                mimeType: previewMember.mimeType,
                sizeBytes: previewMember.sizeBytes,
              }
            : null
        }
        onClose={() => setPreviewHash(null)}
      />
    </div>
  );
}
