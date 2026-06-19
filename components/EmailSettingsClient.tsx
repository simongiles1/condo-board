"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  DEFAULT_SYNC_SCHEDULE,
  describeSyncSchedule,
  describeSyncCron,
  parseSyncSchedule,
  scheduleFromTimeInput,
  syncScheduleToCron,
  timeInputFromSchedule,
  type SyncSchedule,
} from "@/lib/email/sync-schedule";
import { formatDateTime } from "@/lib/format/datetime";
import { formatGmailOrEmailList } from "@/lib/email/gmail-filter-format";

type AllowlistEntry = {
  id: string;
  email: string;
  displayName: string | null;
  notes: string | null;
  addedAt: string;
};

type AllowlistCandidate = {
  email: string;
  messageCount: number;
  threadCount: number;
  personalFromCount: number | null;
  personalThreadCount: number | null;
  saved: boolean;
  id: string | null;
  displayName: string | null;
  notes: string | null;
  addedAt: string | null;
};

type AllowlistCandidateSort =
  | "email-asc"
  | "count-desc"
  | "count-asc"
  | "personal-count-desc"
  | "personal-count-asc";

type ConnectionInfo = {
  accountType: "personal_backfill";
  emailAddress: string;
  verifiedEmailAddress: string | null;
  connectionMismatch: boolean;
  messagesTotal: number | null;
  lastSyncAt: string | null;
  connectedAt: string;
};

type SyncSettings = {
  syncCron: string;
  schedulerEnabled: boolean;
  updatedAt: string;
};

type SyncResult = {
  messagesAdded: number;
  messagesSkipped: number;
  errors: string[];
};

type SyncHistoryRun = {
  id: string;
  trigger: "cron" | "manual" | "clear_all";
  startedAt: string;
  finishedAt: string | null;
  messagesAdded: number;
  messagesSkipped: number;
  errors: string | null;
};

type AllowlistImportPreview = {
  threadCount: number;
  emailCount: number;
  importedThreadCount: number;
  importedEmailCount: number;
};

function formatSyncTrigger(trigger: SyncHistoryRun["trigger"]): string {
  if (trigger === "cron") return "Cron job";
  if (trigger === "clear_all") return "Clear all";
  return "Manual";
}

function formatSyncRunResult(run: SyncHistoryRun): {
  label: string;
  className: string;
} {
  if (run.trigger === "clear_all") {
    const emails = `${run.messagesAdded.toLocaleString()} email${run.messagesAdded === 1 ? "" : "s"}`;
    const threads = `${run.messagesSkipped.toLocaleString()} thread${run.messagesSkipped === 1 ? "" : "s"}`;
    return {
      label: `Deleted ${emails}, ${threads}`,
      className: "text-red-800",
    };
  }
  if (run.errors) {
    const interrupted = run.errors.toLowerCase().includes("interrupted");
    return {
      label: interrupted ? "Interrupted" : "Failed",
      className: interrupted ? "text-amber-800" : "text-red-800",
    };
  }
  if (!run.finishedAt) {
    return { label: "Running…", className: "text-slate-600" };
  }
  const count = `${run.messagesAdded.toLocaleString()} email${run.messagesAdded === 1 ? "" : "s"}`;
  return { label: count, className: "text-slate-600" };
}

type EmailSettingsTab = "connections" | "sync" | "allowlist";

function formatSettingsDate(value: string | null) {
  if (!value) return "Never";
  return formatDateTime(value);
}

function formatEmailAndThreadCount(
  emailCount: number,
  threadCount: number | null,
): string {
  const emails = emailCount.toLocaleString();
  if (threadCount == null) return emails;
  return `${emails} (${threadCount.toLocaleString()})`;
}

export function EmailSettingsClient(props: {
  initialError?: string | null;
  initialConnected?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<EmailSettingsTab>("connections");
  const [candidates, setCandidates] = useState<AllowlistCandidate[]>([]);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    props.initialError ?? null,
  );

  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [syncSchedule, setSyncSchedule] = useState<SyncSchedule>(
    DEFAULT_SYNC_SCHEDULE,
  );
  const [customCron, setCustomCron] = useState<string | null>(null);
  const [schedulerEnabled, setSchedulerEnabled] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [addSenderOpen, setAddSenderOpen] = useState(false);
  const [addSenderError, setAddSenderError] = useState<string | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);
  const [candidateSort, setCandidateSort] =
    useState<AllowlistCandidateSort>("personal-count-desc");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(() => new Set());
  const [syncHistory, setSyncHistory] = useState<SyncHistoryRun[]>([]);
  const [importPreview, setImportPreview] = useState<AllowlistImportPreview | null>(
    null,
  );
  const [importPreviewLoading, setImportPreviewLoading] = useState(false);
  const [importPreviewUnavailable, setImportPreviewUnavailable] = useState(false);

  const savedAllowlistEmails = useMemo(
    () => candidates.filter((candidate) => candidate.saved).map((candidate) => candidate.email),
    [candidates],
  );

  const previewEmails = useMemo(() => {
    if (selectedEmails.size > 0) {
      return [...selectedEmails].sort((left, right) => left.localeCompare(right));
    }
    return savedAllowlistEmails;
  }, [savedAllowlistEmails, selectedEmails]);

  const previewEmailsKey = useMemo(() => previewEmails.join("\0"), [previewEmails]);
  const [backfillRemainingPreview, setBackfillRemainingPreview] =
    useState<AllowlistImportPreview | null>(null);
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0);

  const sortedCandidates = useMemo(() => {
    const next = [...candidates];
    switch (candidateSort) {
      case "count-desc":
        return next.sort((a, b) => {
          const countDiff = b.messageCount - a.messageCount;
          return countDiff !== 0 ? countDiff : a.email.localeCompare(b.email);
        });
      case "count-asc":
        return next.sort((a, b) => {
          const countDiff = a.messageCount - b.messageCount;
          return countDiff !== 0 ? countDiff : a.email.localeCompare(b.email);
        });
      case "personal-count-desc":
        return next.sort((a, b) => {
          const countDiff =
            (b.personalFromCount ?? -1) - (a.personalFromCount ?? -1);
          return countDiff !== 0 ? countDiff : a.email.localeCompare(b.email);
        });
      case "personal-count-asc":
        return next.sort((a, b) => {
          const left = a.personalFromCount ?? Number.MAX_SAFE_INTEGER;
          const right = b.personalFromCount ?? Number.MAX_SAFE_INTEGER;
          const countDiff = left - right;
          return countDiff !== 0 ? countDiff : a.email.localeCompare(b.email);
        });
      default:
        return next.sort((a, b) => a.email.localeCompare(b.email));
    }
  }, [candidateSort, candidates]);

  const gmailFilterText = useMemo(
    () =>
      formatGmailOrEmailList(
        sortedCandidates.map((candidate) => candidate.email),
      ),
    [sortedCandidates],
  );

  const selectedFilterText = useMemo(
    () => formatGmailOrEmailList([...selectedEmails]),
    [selectedEmails],
  );

  const allVisibleSelected =
    sortedCandidates.length > 0 &&
    sortedCandidates.every((candidate) => selectedEmails.has(candidate.email));

  const schedulePreview = useMemo(() => {
    if (customCron) {
      return describeSyncCron(customCron);
    }
    return describeSyncSchedule(syncSchedule);
  }, [customCron, syncSchedule]);

  const loadData = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [candidatesRes, connectionsRes, settingsRes, syncHistoryRes] =
        await Promise.all([
          fetch("/api/email/allowlist/candidates"),
          fetch("/api/email/connections"),
          fetch("/api/email/settings"),
          fetch("/api/email/sync/history"),
        ]);

      if (
        !candidatesRes.ok ||
        !connectionsRes.ok ||
        !settingsRes.ok ||
        !syncHistoryRes.ok
      ) {
        throw new Error("Could not load email settings.");
      }

      const candidatesData = (await candidatesRes.json()) as AllowlistCandidate[];
      const connectionsData = (await connectionsRes.json()) as {
        connections: ConnectionInfo[];
        scheduler: { running: boolean };
      };
      const settingsData = (await settingsRes.json()) as SyncSettings;
      const syncHistoryData = (await syncHistoryRes.json()) as {
        runs: SyncHistoryRun[];
      };

      setCandidates(candidatesData);
      setConnections(
        connectionsData.connections.filter(
          (connection) => connection.accountType === "personal_backfill",
        ),
      );
      setSchedulerRunning(connectionsData.scheduler.running);
      setSettings(settingsData);
      const parsed = parseSyncSchedule(settingsData.syncCron);
      if (parsed.kind === "preset") {
        setSyncSchedule(parsed.schedule);
        setCustomCron(null);
      } else {
        setSyncSchedule(DEFAULT_SYNC_SCHEDULE);
        setCustomCron(parsed.cron);
      }
      setSchedulerEnabled(settingsData.schedulerEnabled);
      setSyncHistory(syncHistoryData.runs);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not load settings.",
      );
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (props.initialConnected) {
      setStatusMessage(`Connected ${props.initialConnected.replace("_", " ")} account.`);
    }
  }, [props.initialConnected]);

  useEffect(() => {
    if (activeTab !== "allowlist") return;

    let cancelled = false;
    const controller = new AbortController();

    async function fetchImportPreview(
      emails: string[],
      options?: { remaining?: boolean },
    ): Promise<AllowlistImportPreview | "unavailable" | null> {
      if (emails.length === 0) return null;

      const response = await fetch("/api/email/allowlist/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails,
          remaining: options?.remaining ?? false,
        }),
        signal: controller.signal,
      });

      if (response.status === 503) return "unavailable";
      if (!response.ok) throw new Error("Could not load import preview.");
      return (await response.json()) as AllowlistImportPreview;
    }

    async function loadImportPreview() {
      setImportPreviewLoading(true);
      setImportPreviewUnavailable(false);

      const shouldLoadBackfillRemaining = savedAllowlistEmails.length > 0;

      try {
        const [mainPreview, remainingPreview] = await Promise.all([
          fetchImportPreview(previewEmails),
          shouldLoadBackfillRemaining
            ? fetchImportPreview(savedAllowlistEmails, { remaining: true })
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        if (mainPreview === "unavailable") {
          setImportPreview(null);
          setImportPreviewUnavailable(true);
        } else {
          setImportPreview(mainPreview);
        }

        if (shouldLoadBackfillRemaining) {
          setBackfillRemainingPreview(
            remainingPreview === "unavailable" ? null : remainingPreview,
          );
        } else {
          setBackfillRemainingPreview(null);
        }
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setImportPreview(null);
        setBackfillRemainingPreview(null);
      } finally {
        if (!cancelled) {
          setImportPreviewLoading(false);
        }
      }
    }

    void loadImportPreview();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeTab, previewEmailsKey, previewRefreshNonce, savedAllowlistEmails]);

  async function addSender(event: React.FormEvent) {
    event.preventDefault();
    setBusyAction("add-sender");
    setAddSenderError(null);

    try {
      const response = await fetch("/api/email/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          displayName: newDisplayName,
          notes: newNotes,
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Could not add sender.");
      }

      const entry = (await response.json()) as AllowlistEntry;
      setCandidates((current) =>
        current
          .map((candidate) =>
            candidate.email === entry.email
              ? {
                  ...candidate,
                  saved: true,
                  id: entry.id,
                  displayName: entry.displayName,
                  notes: entry.notes,
                  addedAt: entry.addedAt,
                }
              : candidate,
          )
          .concat(
            current.some((candidate) => candidate.email === entry.email)
              ? []
              : [
                  {
                    email: entry.email,
                    messageCount: 0,
                    threadCount: 0,
                    personalFromCount: null,
                    personalThreadCount: null,
                    saved: true,
                    id: entry.id,
                    displayName: entry.displayName,
                    notes: entry.notes,
                    addedAt: entry.addedAt,
                  },
                ],
          )
          .sort((a, b) => a.email.localeCompare(b.email)),
      );
      setNewEmail("");
      setNewDisplayName("");
      setNewNotes("");
      setAddSenderOpen(false);
      setAddSenderError(null);
      setStatusMessage("Sender added to allowlist.");
      setPreviewRefreshNonce((current) => current + 1);
    } catch (error) {
      setAddSenderError(
        error instanceof Error ? error.message : "Could not add sender.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function copyToClipboard(key: string, text: string) {
    if (!text.trim()) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 2000);
    } catch {
      setErrorMessage("Could not copy to clipboard.");
    }
  }

  function toggleSelectedEmail(email: string) {
    setSelectedEmails((current) => {
      const next = new Set(current);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  }

  function selectAllVisibleEmails() {
    setSelectedEmails(new Set(sortedCandidates.map((candidate) => candidate.email)));
  }

  function clearSelectedEmails() {
    setSelectedEmails(new Set());
  }

  async function saveDiscoveredSender(email: string) {
    setBusyAction(`save-${email}`);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/email/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Could not save sender.");
      }

      const entry = (await response.json()) as AllowlistEntry;
      setCandidates((current) =>
        current.map((candidate) =>
          candidate.email === entry.email
            ? {
                ...candidate,
                saved: true,
                id: entry.id,
                displayName: entry.displayName,
                notes: entry.notes,
                addedAt: entry.addedAt,
              }
            : candidate,
        ),
      );
      setStatusMessage(`Saved ${entry.email} to the allowlist.`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not save sender.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function removeSender(id: string, email: string) {
    setBusyAction(`remove-${id}`);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/email/allowlist/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not remove sender.");
      setCandidates((current) =>
        current
          .map((candidate) =>
            candidate.id === id
              ? {
                  ...candidate,
                  saved: false,
                  id: null,
                  displayName: null,
                  notes: null,
                  addedAt: null,
                }
              : candidate,
          )
          .filter(
            (candidate) => candidate.messageCount > 0 || candidate.saved,
          ),
      );
      setStatusMessage(`Removed ${email} from the allowlist.`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not remove sender.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusyAction("save-settings");
    setErrorMessage(null);

    try {
      const syncCron = customCron ?? syncScheduleToCron(syncSchedule);
      const response = await fetch("/api/email/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncCron,
          schedulerEnabled,
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Could not save sync settings.");
      }
      setStatusMessage("Automatic sync settings updated.");
      await loadData({ silent: true });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not save settings.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function runSync() {
    setBusyAction("sync");
    setErrorMessage(null);

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 120_000);
      const response = await fetch("/api/email/sync", {
        method: "POST",
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      const result = (await response.json()) as SyncResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Sync failed.");
      setStatusMessage(
        result.messagesAdded > 0
          ? `Personal Gmail sync complete: ${result.messagesAdded} added, ${result.messagesSkipped} skipped. View them on the Emails page.`
          : `Personal Gmail sync complete: no new allowlist messages (${result.messagesSkipped} skipped). Open Emails to view your inbox.`,
      );
      if (result.errors?.length) {
        setErrorMessage(result.errors.join("\n"));
      }
      await loadData({ silent: true });
      setPreviewRefreshNonce((current) => current + 1);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setErrorMessage(
          "Sync is taking longer than expected. The first sync can take several minutes while allowlist mail is imported.",
        );
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Sync failed.");
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmClearAllEmails() {
    setBusyAction("clear-all");
    setClearError(null);

    try {
      const response = await fetch("/api/email/clear-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        deletedEmails?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Could not delete imported emails.");
      }

      setConfirmClearOpen(false);
      setStatusMessage(
        `Deleted ${result.deletedEmails ?? 0} imported emails. Run Sync now to re-import allowlist mail from personal Gmail.`,
      );
      await loadData({ silent: true });
      setPreviewRefreshNonce((current) => current + 1);
    } catch (error) {
      setClearError(
        error instanceof Error ? error.message : "Could not delete imported emails.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function backfillAllAllowlist() {
    setBusyAction("backfill-all");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/email/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = (await response.json()) as SyncResult & { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Could not backfill allowlist mail.");
      }
      setStatusMessage(
        `Backfill complete: ${result.messagesAdded.toLocaleString()} message${result.messagesAdded === 1 ? "" : "s"} added, ${result.messagesSkipped.toLocaleString()} skipped.`,
      );
      if (result.errors?.length) {
        setErrorMessage(result.errors.join("\n"));
      }
      await loadData({ silent: true });
      setPreviewRefreshNonce((current) => current + 1);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not backfill allowlist mail.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function importSenderThread(senderEmail: string) {
    setBusyAction(`import-thread-${senderEmail}`);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/email/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderEmail }),
      });
      const result = (await response.json()) as SyncResult & { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Could not import thread history.");
      }
      setStatusMessage(
        `Imported ${result.messagesAdded} message${result.messagesAdded === 1 ? "" : "s"} from ${senderEmail} (${result.messagesSkipped} skipped).`,
      );
      if (result.errors?.length) {
        setErrorMessage(result.errors.join("\n"));
      }
      await loadData({ silent: true });
      setPreviewRefreshNonce((current) => current + 1);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not import thread history.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  const personalConnection = connections.find(
    (connection) => connection.accountType === "personal_backfill",
  );

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Loading email settings and personal Gmail counts…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {(statusMessage || errorMessage) && (
        <div className="space-y-2">
          {statusMessage ? (
            <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
              {statusMessage}
            </div>
          ) : null}
          {errorMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 whitespace-pre-wrap">
              {errorMessage}
            </div>
          ) : null}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <EmailSettingsTabs activeTab={activeTab} onChange={setActiveTab} />

        <div className="p-5">
          {activeTab === "connections" ? (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Gmail connections
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Connect your personal Gmail for ongoing sync and historical
                import.
              </p>

              <div className="mt-4 max-w-xl">
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <h3 className="font-medium text-slate-900">Personal Gmail</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Read-only access imports allowlist-matching mail directly
                    from your personal inbox. Sync now and automatic sync both
                    use this connection.
                  </p>
                  {personalConnection ? (
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      <p>
                        {personalConnection.verifiedEmailAddress ??
                          personalConnection.emailAddress}
                      </p>
                      {personalConnection.connectionMismatch ? (
                        <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-900">
                          OAuth token mismatch: stored as{" "}
                          {personalConnection.emailAddress}
                          {personalConnection.verifiedEmailAddress
                            ? `, but token is for ${personalConnection.verifiedEmailAddress}`
                            : ""}
                          . Reconnect and choose the correct Google account.
                        </p>
                      ) : null}
                      {personalConnection.messagesTotal != null ? (
                        <p>
                          {personalConnection.messagesTotal.toLocaleString()}{" "}
                          messages in mailbox
                        </p>
                      ) : null}
                      <p>Last sync: {formatSettingsDate(personalConnection.lastSyncAt)}</p>
                      <p>
                        Connected: {formatSettingsDate(personalConnection.connectedAt)}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">Not connected</p>
                  )}
                  <a
                    href="/api/email/oauth/start?accountType=personal_backfill"
                    className="mt-3 inline-flex rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
                  >
                    {personalConnection ? "Reconnect" : "Connect Gmail"}
                  </a>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "sync" ? (
            <div>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  Sync controls
                </h2>
                <button
                  type="button"
                  onClick={() => void runSync()}
                  disabled={busyAction !== null || !personalConnection}
                  className="shrink-0 rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {busyAction === "sync" ? "Syncing…" : "Sync now"}
                </button>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Sync now pulls new allowlist mail from personal Gmail. The first
                run imports matching messages; later runs only fetch mail since
                the last sync. Use <strong>Import thread</strong> on a sender row
                in the Sender allowlist tab to import full conversation history
                for one sender.
              </p>

              <form
                onSubmit={saveSettings}
                className="mt-5 rounded-lg border border-slate-100 bg-slate-50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-slate-900">Automatic sync</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {schedulerEnabled
                        ? `${schedulePreview} — same incremental personal Gmail sync as Sync now.`
                        : "Automatic sync is off. Use Sync now for new allowlist mail."}
                    </p>
                    {schedulerEnabled ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Uses your computer&apos;s local timezone while the app is
                        running.
                        {settings
                          ? ` Scheduler ${schedulerRunning ? "active" : "inactive"} · last updated ${formatSettingsDate(settings.updatedAt)}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={schedulerEnabled}
                      onChange={(event) =>
                        setSchedulerEnabled(event.target.checked)
                      }
                      className="rounded border-slate-300"
                    />
                    Enable automatic sync
                  </label>
                </div>

                {schedulerEnabled ? (
                  <div className="mt-4 flex flex-wrap items-end gap-4">
                    <label className="block min-w-[10rem] flex-1 text-sm">
                      <span className="mb-1 block font-medium text-slate-800">
                        Frequency
                      </span>
                      <select
                        value={syncSchedule.frequency}
                        onChange={(event) => {
                          setCustomCron(null);
                          setSyncSchedule((current) => ({
                            ...current,
                            frequency: event.target
                              .value as SyncSchedule["frequency"],
                          }));
                        }}
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                      >
                        <option value="daily">Every day</option>
                        <option value="weekdays">Weekdays only</option>
                        <option value="weekly">Once a week</option>
                      </select>
                    </label>

                    <label className="block min-w-[8rem] flex-1 text-sm">
                      <span className="mb-1 block font-medium text-slate-800">
                        Time
                      </span>
                      <input
                        type="time"
                        value={timeInputFromSchedule(syncSchedule)}
                        onChange={(event) => {
                          setCustomCron(null);
                          setSyncSchedule((current) =>
                            scheduleFromTimeInput(event.target.value, current),
                          );
                        }}
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                      />
                    </label>

                    {syncSchedule.frequency === "weekly" ? (
                      <label className="block min-w-[8rem] flex-1 text-sm">
                        <span className="mb-1 block font-medium text-slate-800">
                          Day
                        </span>
                        <select
                          value={syncSchedule.dayOfWeek}
                          onChange={(event) => {
                            setCustomCron(null);
                            setSyncSchedule((current) => ({
                              ...current,
                              dayOfWeek: Number(event.target.value),
                            }));
                          }}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                        >
                          <option value={1}>Monday</option>
                          <option value={2}>Tuesday</option>
                          <option value={3}>Wednesday</option>
                          <option value={4}>Thursday</option>
                          <option value={5}>Friday</option>
                          <option value={6}>Saturday</option>
                          <option value={0}>Sunday</option>
                        </select>
                      </label>
                    ) : null}

                    <button
                      type="submit"
                      disabled={busyAction !== null}
                      className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busyAction === "save-settings"
                        ? "Saving…"
                        : "Save automatic sync"}
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={busyAction !== null}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busyAction === "save-settings"
                        ? "Saving…"
                        : "Save automatic sync"}
                    </button>
                  </div>
                )}

                {customCron ? (
                  <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    Your saved schedule uses a custom pattern. Choose a frequency
                    and time above to replace it with a standard schedule.
                  </p>
                ) : null}
              </form>

              <div className="mt-5">
                <h3 className="font-medium text-slate-900">Sync history</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Recent manual and scheduled syncs, plus inbox resets. Check that
                  syncs ran when expected and how many allowlist messages were
                  imported each time.
                </p>
                <div className="mt-3 max-h-[300px] overflow-y-auto rounded-lg border border-slate-200">
                  <table className="w-full table-fixed text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
                      <tr className="border-b border-slate-200">
                        <th className="px-3 py-2 text-left">Started</th>
                        <th className="w-28 px-3 py-2 text-left">Trigger</th>
                        <th className="w-36 px-3 py-2 text-right">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {syncHistory.length === 0 ? (
                        <tr>
                          <td
                            colSpan={3}
                            className="px-3 py-4 text-center text-slate-500"
                          >
                            No syncs recorded yet.
                          </td>
                        </tr>
                      ) : (
                        syncHistory.map((run) => (
                          <tr key={run.id}>
                            <td className="px-3 py-2 text-slate-800">
                              {formatSettingsDate(run.startedAt)}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {formatSyncTrigger(run.trigger)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              {(() => {
                                const result = formatSyncRunResult(run);
                                return (
                                  <span
                                    className={result.className}
                                    title={run.errors ?? undefined}
                                  >
                                    {result.label}
                                  </span>
                                );
                              })()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-8 rounded-lg border border-red-200 bg-red-50/40 p-4">
                <h3 className="font-medium text-red-900">Reset imported inbox</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Delete every imported email, thread, and email analysis from this
                  app. Sync history is kept and records this reset. Gmail
                  connections, the sender allowlist, and messages in Gmail are not
                  changed. The next personal Gmail sync re-imports allowlist mail
                  into the app.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setClearError(null);
                    setConfirmClearOpen(true);
                  }}
                  disabled={busyAction !== null}
                  className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  Delete all imported emails
                </button>
              </div>
            </div>
          ) : null}

          {activeTab === "allowlist" ? (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Sender allowlist
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Unique From addresses seen in imported mail. Counts show emails
                with thread totals in parentheses for the app and personal Gmail
                (From only). Save unsaved senders, then use <strong>Import thread</strong> on a row to pull
                full conversations for that sender, including replies Sync now
                does not fetch on its own.
              </p>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">Estimated next sync import</p>
                    <p className="mt-1 text-slate-600">
                      {selectedEmails.size > 0
                        ? `Based on ${selectedEmails.size.toLocaleString()} selected sender${selectedEmails.size === 1 ? "" : "s"}.`
                        : savedAllowlistEmails.length > 0
                          ? `Based on ${savedAllowlistEmails.length.toLocaleString()} saved allowlist sender${savedAllowlistEmails.length === 1 ? "" : "s"}.`
                          : "Save senders to the allowlist to see import estimates."}
                    </p>
                    {importPreviewLoading ? (
                      <p className="mt-2 text-slate-500">Calculating…</p>
                    ) : importPreviewUnavailable ? (
                      <p className="mt-2 text-slate-500">
                        Connect personal Gmail to see import estimates.
                      </p>
                    ) : importPreview && previewEmails.length > 0 ? (
                      <>
                        <p className="mt-2 tabular-nums text-slate-800">
                          <span className="font-medium text-teal-900">
                            {importPreview.threadCount.toLocaleString()} thread
                            {importPreview.threadCount === 1 ? "" : "s"}
                          </span>
                          {" · "}
                          <span className="font-medium text-teal-900">
                            {importPreview.emailCount.toLocaleString()} email
                            {importPreview.emailCount === 1 ? "" : "s"}
                          </span>
                          {" would be imported on the next sync."}
                        </p>
                        <p className="mt-2 tabular-nums text-slate-800">
                          <span className="font-medium text-teal-900">
                            {importPreview.importedThreadCount.toLocaleString()} thread
                            {importPreview.importedThreadCount === 1 ? "" : "s"}
                          </span>
                          {" · "}
                          <span className="font-medium text-teal-900">
                            {importPreview.importedEmailCount.toLocaleString()} email
                            {importPreview.importedEmailCount === 1 ? "" : "s"}
                          </span>
                          {" already in the system."}
                        </p>
                      </>
                    ) : null}
                  </div>

                  <div className="min-w-0 border-t border-slate-200 pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                    <p className="font-medium text-slate-900">Backfill all allowlist</p>
                    <p className="mt-1 text-slate-600">
                      {savedAllowlistEmails.length === 0
                        ? "Save senders to the allowlist before backfilling."
                        : importPreviewUnavailable
                          ? "Connect personal Gmail to backfill historical mail."
                          : importPreviewLoading
                            ? "Calculating remaining import…"
                            : backfillRemainingPreview
                              ? `Sync now only fetches new mail since your last sync. This searches personal Gmail for all ${savedAllowlistEmails.length.toLocaleString()} saved sender${savedAllowlistEmails.length === 1 ? "" : "s"} and imports historical threads not yet in the app. Already-imported messages are skipped. Approximately `
                              : `Searches personal Gmail for all ${savedAllowlistEmails.length.toLocaleString()} saved sender${savedAllowlistEmails.length === 1 ? "" : "s"} and imports historical threads not yet in the app.`}
                      {backfillRemainingPreview &&
                      !importPreviewLoading &&
                      !importPreviewUnavailable ? (
                        <>
                          <span className="font-medium tabular-nums text-teal-900">
                            {backfillRemainingPreview.threadCount.toLocaleString()} thread
                            {backfillRemainingPreview.threadCount === 1 ? "" : "s"}
                          </span>
                          {" · "}
                          <span className="font-medium tabular-nums text-teal-900">
                            {backfillRemainingPreview.emailCount.toLocaleString()} email
                            {backfillRemainingPreview.emailCount === 1 ? "" : "s"}
                          </span>
                          {" remain unsynced."}
                        </>
                      ) : null}
                    </p>
                    <button
                      type="button"
                      onClick={() => void backfillAllAllowlist()}
                      disabled={
                        busyAction !== null ||
                        !personalConnection ||
                        savedAllowlistEmails.length === 0 ||
                        importPreviewUnavailable
                      }
                      className="mt-3 rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                    >
                      {busyAction === "backfill-all"
                        ? "Backfilling…"
                        : "Backfill all allowlist"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                  <p>
                    {sortedCandidates.length.toLocaleString()} sender address
                    {sortedCandidates.length === 1 ? "" : "es"}
                  </p>
                  {selectedEmails.size > 0 ? (
                    <p className="font-medium text-teal-800">
                      {selectedEmails.size.toLocaleString()} selected
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddSenderError(null);
                      setAddSenderOpen(true);
                    }}
                    disabled={busyAction !== null}
                    className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                  >
                    Add sender
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      allVisibleSelected
                        ? clearSelectedEmails()
                        : selectAllVisibleEmails()
                    }
                    disabled={sortedCandidates.length === 0 || busyAction !== null}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {allVisibleSelected ? "Clear selection" : "Select all"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void copyToClipboard("gmail-filter-selected", selectedFilterText)
                    }
                    disabled={
                      selectedEmails.size === 0 ||
                      !selectedFilterText ||
                      busyAction !== null
                    }
                    className="rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-50"
                  >
                    {copiedKey === "gmail-filter-selected"
                      ? "Copied selection"
                      : "Copy selected filter"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard("gmail-filter", gmailFilterText)}
                    disabled={!gmailFilterText || busyAction !== null}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {copiedKey === "gmail-filter" ? "Copied filter" : "Copy all filter"}
                  </button>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">Sort by</span>
                    <select
                      value={candidateSort}
                      onChange={(event) =>
                        setCandidateSort(event.target.value as AllowlistCandidateSort)
                      }
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5"
                    >
                      <option value="email-asc">Email (A–Z)</option>
                      <option value="count-desc">Most in app</option>
                      <option value="count-asc">Fewest in app</option>
                      <option value="personal-count-desc">Most in personal Gmail</option>
                      <option value="personal-count-asc">Fewest in personal Gmail</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="mt-3 max-h-[500px] overflow-y-auto rounded-lg border border-slate-100">
                <table className="w-full table-fixed text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
                    <tr className="border-b border-slate-100">
                      <th className="w-10 px-4 py-2" aria-hidden="true" />
                      <th className="px-4 py-2 text-left">Sender</th>
                      <th className="w-32 px-4 py-2 text-right">In app</th>
                      <th className="w-32 px-4 py-2 text-right">Personal</th>
                      <th className="w-64 px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedCandidates.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-slate-600">
                          No sender addresses yet. Sync mail or add a sender manually.
                        </td>
                      </tr>
                    ) : (
                      sortedCandidates.map((candidate) => (
                        <tr key={candidate.email} className="align-top">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedEmails.has(candidate.email)}
                              onChange={() => toggleSelectedEmail(candidate.email)}
                              className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                              aria-label={`Select ${candidate.email}`}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="min-w-0">
                              <p className="break-all font-medium text-slate-900">
                                {candidate.displayName
                                  ? `${candidate.displayName} · `
                                  : ""}
                                {candidate.email}
                              </p>
                              {candidate.notes ? (
                                <p className="mt-1 text-slate-600">{candidate.notes}</p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                            {formatEmailAndThreadCount(
                              candidate.messageCount,
                              candidate.threadCount,
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                            {candidate.personalFromCount == null
                              ? "—"
                              : formatEmailAndThreadCount(
                                  candidate.personalFromCount,
                                  candidate.personalThreadCount,
                                )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-nowrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  void copyToClipboard(
                                    `email-${candidate.email}`,
                                    candidate.email,
                                  )
                                }
                                disabled={busyAction !== null}
                                aria-label={
                                  copiedKey === `email-${candidate.email}`
                                    ? "Copied email"
                                    : `Copy ${candidate.email}`
                                }
                                title={
                                  copiedKey === `email-${candidate.email}`
                                    ? "Copied"
                                    : "Copy email"
                                }
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                              >
                                {copiedKey === `email-${candidate.email}` ? (
                                  <CheckIcon className="text-teal-700" />
                                ) : (
                                  <CopyIcon />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveDiscoveredSender(candidate.email)}
                                disabled={candidate.saved || busyAction !== null}
                                aria-label={
                                  candidate.saved
                                    ? `${candidate.email} saved to allowlist`
                                    : `Save ${candidate.email} to allowlist`
                                }
                                title={
                                  busyAction === `save-${candidate.email}`
                                    ? "Saving…"
                                    : candidate.saved
                                      ? "Saved"
                                      : "Save to allowlist"
                                }
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-teal-700 bg-teal-700 text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {busyAction === `save-${candidate.email}` ? (
                                  <span className="text-xs font-semibold">…</span>
                                ) : candidate.saved ? (
                                  <CheckIcon />
                                ) : (
                                  <SaveIcon />
                                )}
                              </button>
                              {candidate.saved && candidate.id ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void importSenderThread(candidate.email)}
                                    disabled={busyAction !== null}
                                    title={`Import every message in threads from ${candidate.email}`}
                                    className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    {busyAction === `import-thread-${candidate.email}`
                                      ? "Importing…"
                                      : "Import thread"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void removeSender(candidate.id!, candidate.email)
                                    }
                                    disabled={busyAction !== null}
                                    aria-label={`Remove ${candidate.email} from allowlist`}
                                    title="Remove from allowlist"
                                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    <TrashIcon />
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        title="Delete all imported emails?"
        description={
          <>
            <p>
              This permanently removes all emails, threads, attachment caches, and
              email extractions from the app database. A clear-all entry is added
              to sync history so the next large re-import is easier to understand.
            </p>
            <p className="mt-2">
              Messages in Gmail are <strong>not</strong> deleted. After this,
              use <strong>Sync now</strong> to pull allowlist mail from personal
              Gmail again.
            </p>
            {clearError ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
                {clearError}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete all imported emails"
        busy={busyAction === "clear-all"}
        busyLabel="Deleting…"
        onConfirm={() => void confirmClearAllEmails()}
        onCancel={() => {
          if (busyAction !== "clear-all") {
            setConfirmClearOpen(false);
            setClearError(null);
          }
        }}
      />

      {addSenderOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => {
              if (busyAction !== "add-sender") {
                setAddSenderOpen(false);
                setAddSenderError(null);
              }
            }}
            disabled={busyAction === "add-sender"}
            aria-label="Close dialog"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-sender-dialog-title"
            className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h2
              id="add-sender-dialog-title"
              className="text-lg font-semibold text-slate-900"
            >
              Add sender
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Add an email address to the allowlist before it appears in imported
              mail.
            </p>
            <form onSubmit={addSender} className="mt-4 space-y-3">
              <input
                required
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                placeholder="Email address"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={newDisplayName}
                onChange={(event) => setNewDisplayName(event.target.value)}
                placeholder="Display name (optional)"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={newNotes}
                onChange={(event) => setNewNotes(event.target.value)}
                placeholder="Notes (optional)"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              {addSenderError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  {addSenderError}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (busyAction !== "add-sender") {
                      setAddSenderOpen(false);
                      setAddSenderError(null);
                    }
                  }}
                  disabled={busyAction === "add-sender"}
                  className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction !== null}
                  className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {busyAction === "add-sender" ? "Adding…" : "Add sender"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmailSettingsTabs({
  activeTab,
  onChange,
}: {
  activeTab: EmailSettingsTab;
  onChange: (tab: EmailSettingsTab) => void;
}) {
  const tabs: Array<{ id: EmailSettingsTab; label: string }> = [
    { id: "connections", label: "Gmail connections" },
    { id: "sync", label: "Sync controls" },
    { id: "allowlist", label: "Sender allowlist" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Email settings sections"
      className="flex gap-1 border-b border-slate-200 px-5"
    >
      {tabs.map((tab) => {
        const selected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={[
              "-mb-px border-b-2 px-3 py-3 text-sm font-medium transition-colors",
              selected
                ? "border-teal-600 text-teal-800"
                : "border-transparent text-slate-500 hover:border-slate-200 hover:text-slate-800",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 0V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3m0 0h6"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`h-4 w-4 ${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}
