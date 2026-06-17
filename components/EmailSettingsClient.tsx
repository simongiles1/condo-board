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
  personalFromCount: number | null;
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
  accountType: "personal_backfill" | "dedicated";
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

type ForwardRunStatus = {
  id: string;
  status:
    | "queued"
    | "running"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";
  targetEmail: string;
  sourceQuery: string;
  totalQueued: number;
  forwardedCount: number;
  skippedCount: number;
  failedCount: number;
  pendingCount: number;
  chunkSize: number;
  chunkDelayMs: number;
  nextChunkAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  isActive: boolean;
  phase:
    | "idle"
    | "forwarding"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled";
  lastProcessedAt: string | null;
  progressPercent: number;
  recentActivity: Array<{
    gmailMessageId: string;
    status: "pending" | "forwarded" | "skipped" | "failed";
    processedAt: string | null;
    error: string | null;
  }>;
  messagesMatched: number;
  threadsMatched: number | null;
};

function formatForwardPhase(phase: ForwardRunStatus["phase"]): string {
  switch (phase) {
    case "forwarding":
      return "Forwarding batch now";
    case "waiting":
      return "Waiting between batches";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Idle";
  }
}

function formatPersonalGmailMatchSummary(
  messagesMatched: number,
  threadsMatched: number | null,
): string {
  const messages = `${messagesMatched.toLocaleString()} message${messagesMatched === 1 ? "" : "s"}`;
  if (threadsMatched == null) {
    return messages;
  }
  const threads = `${threadsMatched.toLocaleString()} thread${threadsMatched === 1 ? "" : "s"}`;
  return `${messages} in ${threads}`;
}

function formatCountdown(targetIso: string | null, nowMs: number): string | null {
  if (!targetIso) return null;
  const remainingMs = new Date(targetIso).getTime() - nowMs;
  if (remainingMs <= 0) return "starting next batch…";
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function EmailSettingsClient(props: {
  initialError?: string | null;
  initialConnected?: string | null;
}) {
  const [candidates, setCandidates] = useState<AllowlistCandidate[]>([]);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [expectedDedicatedEmail, setExpectedDedicatedEmail] = useState<string | null>(
    null,
  );
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
  const [clearError, setClearError] = useState<string | null>(null);
  const [candidateSort, setCandidateSort] =
    useState<AllowlistCandidateSort>("email-asc");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(() => new Set());
  const [forwardStatus, setForwardStatus] = useState<ForwardRunStatus | null>(
    null,
  );
  const [forwardNowMs, setForwardNowMs] = useState(() => Date.now());
  const [forwardStarting, setForwardStarting] = useState(false);

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

  const forwardInProgress =
    forwardStarting || (forwardStatus?.isActive ?? false);

  const forwardCountdown = useMemo(
    () =>
      forwardStatus?.phase === "waiting"
        ? formatCountdown(forwardStatus.nextChunkAt, forwardNowMs)
        : null,
    [forwardNowMs, forwardStatus?.nextChunkAt, forwardStatus?.phase],
  );

  const savedAllowlistCount = useMemo(
    () => candidates.filter((candidate) => candidate.saved).length,
    [candidates],
  );

  const schedulePreview = useMemo(() => {
    if (customCron) {
      return describeSyncCron(customCron);
    }
    return describeSyncSchedule(syncSchedule);
  }, [customCron, syncSchedule]);

  const loadForwardStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/email/forward/status");
      if (!response.ok) return;
      const data = (await response.json()) as { run: ForwardRunStatus | null };
      setForwardStatus(data.run);
    } catch {
      // Keep the last known status if polling fails briefly.
    }
  }, []);

  const loadData = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [candidatesRes, connectionsRes, settingsRes] = await Promise.all([
        fetch("/api/email/allowlist/candidates"),
        fetch("/api/email/connections"),
        fetch("/api/email/settings"),
      ]);

      if (!candidatesRes.ok || !connectionsRes.ok || !settingsRes.ok) {
        throw new Error("Could not load email settings.");
      }

      const candidatesData = (await candidatesRes.json()) as AllowlistCandidate[];
      const connectionsData = (await connectionsRes.json()) as {
        connections: ConnectionInfo[];
        expectedDedicatedEmail: string | null;
        scheduler: { running: boolean };
      };
      const settingsData = (await settingsRes.json()) as SyncSettings;

      setCandidates(candidatesData);
      setConnections(connectionsData.connections);
      setExpectedDedicatedEmail(connectionsData.expectedDedicatedEmail);
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
      await loadForwardStatus();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not load settings.",
      );
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [loadForwardStatus]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!forwardInProgress) return;

    const interval = window.setInterval(() => {
      void loadForwardStatus();
    }, 3_000);

    return () => window.clearInterval(interval);
  }, [forwardInProgress, loadForwardStatus]);

  useEffect(() => {
    if (forwardStatus?.phase !== "waiting") return;

    const interval = window.setInterval(() => {
      setForwardNowMs(Date.now());
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [forwardStatus?.phase]);

  useEffect(() => {
    if (props.initialConnected) {
      setStatusMessage(`Connected ${props.initialConnected.replace("_", " ")} account.`);
    }
  }, [props.initialConnected]);

  async function addSender(event: React.FormEvent) {
    event.preventDefault();
    setBusyAction("add-sender");
    setErrorMessage(null);

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
                    personalFromCount: null,
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
      setStatusMessage("Sender added to allowlist.");
    } catch (error) {
      setErrorMessage(
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

  async function startForwardWorkflow() {
    setBusyAction("forward-start");
    setForwardStarting(true);
    setErrorMessage(null);

    try {
      const senderEmails =
        selectedEmails.size > 0 ? [...selectedEmails] : undefined;
      const response = await fetch("/api/email/forward/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderEmails }),
      });
      const result = (await response.json()) as ForwardRunStatus & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Could not start forwarding.");
      }

      setForwardStatus(result);
      await loadForwardStatus();
      if (result.totalQueued === 0) {
        setStatusMessage(
          `Found ${formatPersonalGmailMatchSummary(result.messagesMatched, result.threadsMatched)} in personal Gmail, but ${result.skippedCount.toLocaleString()} were already forwarded.`,
        );
      } else {
        setStatusMessage(
          `Forwarding started: ${result.totalQueued.toLocaleString()} messages queued (${formatPersonalGmailMatchSummary(result.messagesMatched, result.threadsMatched)} matched in personal Gmail).`,
        );
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not start forwarding.",
      );
      await loadForwardStatus();
    } finally {
      setForwardStarting(false);
      setBusyAction(null);
    }
  }

  async function stopForwardWorkflow() {
    setBusyAction("forward-stop");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/email/forward/stop", { method: "POST" });
      const result = (await response.json()) as { run: ForwardRunStatus | null };
      if (!response.ok) {
        throw new Error("Could not stop forwarding.");
      }
      setForwardStatus(result.run);
      setStatusMessage("Forwarding workflow stopped.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not stop forwarding.",
      );
    } finally {
      setBusyAction(null);
    }
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
    } catch (error) {
      setClearError(
        error instanceof Error ? error.message : "Could not delete imported emails.",
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
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not import thread history.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  function connectionFor(type: ConnectionInfo["accountType"]) {
    return connections.find((connection) => connection.accountType === type);
  }

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

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Gmail connections</h2>
        <p className="mt-1 text-sm text-slate-600">
          Connect your personal Gmail for ongoing sync and historical import.
          The dedicated condo mailbox is optional and no longer used for sync.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(["personal_backfill", "dedicated"] as const).map((accountType) => {
            const connection = connectionFor(accountType);
            const label =
              accountType === "personal_backfill"
                ? "Personal Gmail (primary sync)"
                : "Dedicated condo mailbox (optional)";

            return (
              <div
                key={accountType}
                className="rounded-lg border border-slate-100 bg-slate-50 p-4"
              >
                <h3 className="font-medium text-slate-900">{label}</h3>
                {accountType === "personal_backfill" ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Read-only access imports allowlist-matching mail directly
                    from your personal inbox. Sync now and automatic sync both
                    use this connection.
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-slate-600">
                      Reconnect after upgrading if delete-from-Gmail fails with a
                      permissions error.
                    </p>
                    <p className="mt-1 text-xs text-amber-800">
                      If Google consent hangs on Continue, add{" "}
                      <code className="rounded bg-amber-100 px-1">
                        gmail.modify
                      </code>{" "}
                      to your Google Cloud OAuth consent screen scopes, revoke
                      Condo board at{" "}
                      <a
                        href="https://myaccount.google.com/permissions"
                        className="underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Google Account permissions
                      </a>
                      , then reconnect the dedicated mailbox if you still use it.
                    </p>
                  </>
                )}
                {connection ? (
                  <div className="mt-2 space-y-1 text-sm text-slate-700">
                    <p>
                      {connection.verifiedEmailAddress ?? connection.emailAddress}
                    </p>
                    {connection.connectionMismatch ? (
                      <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-900">
                        OAuth token mismatch: stored as {connection.emailAddress}
                        {connection.verifiedEmailAddress
                          ? `, but token is for ${connection.verifiedEmailAddress}`
                          : ""}
                        . Reconnect and choose the correct Google account
                        {expectedDedicatedEmail
                          ? ` (${expectedDedicatedEmail})`
                          : ""}
                        .
                      </p>
                    ) : null}
                    {connection.messagesTotal != null ? (
                      <p>{connection.messagesTotal.toLocaleString()} messages in mailbox</p>
                    ) : null}
                    <p>Last sync: {formatDate(connection.lastSyncAt)}</p>
                    <p>Connected: {formatDate(connection.connectedAt)}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">Not connected</p>
                )}
                <a
                  href={`/api/email/oauth/start?accountType=${accountType}`}
                  className="mt-3 inline-flex rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
                >
                  {connection ? "Reconnect" : "Connect Gmail"}
                </a>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Sync controls</h2>
            <p className="mt-1 text-sm text-slate-600">
              Sync now pulls new allowlist mail from personal Gmail. The first
              run imports matching messages; later runs only fetch mail since
              the last sync. Use <strong>Import thread</strong> on a sender row
              below to import full conversation history for one sender.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="button"
              onClick={() => void runSync()}
              disabled={
                busyAction !== null || !connectionFor("personal_backfill")
              }
              className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {busyAction === "sync" ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </div>

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
                  Uses your computer&apos;s local timezone while the app is running.
                  {settings
                    ? ` Scheduler ${schedulerRunning ? "active" : "inactive"} · last updated ${formatDate(settings.updatedAt)}`
                    : ""}
                </p>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input
                type="checkbox"
                checked={schedulerEnabled}
                onChange={(event) => setSchedulerEnabled(event.target.checked)}
                className="rounded border-slate-300"
              />
              Enable automatic sync
            </label>
          </div>

          {schedulerEnabled ? (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-800">
                  Frequency
                </span>
                <select
                  value={syncSchedule.frequency}
                  onChange={(event) => {
                    setCustomCron(null);
                    setSyncSchedule((current) => ({
                      ...current,
                      frequency: event.target.value as SyncSchedule["frequency"],
                    }));
                  }}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="daily">Every day</option>
                  <option value="weekdays">Weekdays only</option>
                  <option value="weekly">Once a week</option>
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-800">Time</span>
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
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-800">Day</span>
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
              ) : (
                <div className="hidden md:block" aria-hidden="true" />
              )}
            </div>
          ) : null}

          {customCron ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Your saved schedule uses a custom pattern. Choose a frequency and time
              above to replace it with a standard schedule.
            </p>
          ) : null}

          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={busyAction !== null}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {busyAction === "save-settings" ? "Saving…" : "Save automatic sync"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Sender allowlist</h2>
        <p className="mt-1 text-sm text-slate-600">
          Unique From addresses seen in imported mail. Counts show messages in
          the app and in personal Gmail (From only). Save unsaved senders, then
          use <strong>Import thread</strong> on a row to pull full conversations
          for that sender, including replies Sync now does not fetch on its own.
        </p>

        <form onSubmit={addSender} className="mt-4 grid gap-3 md:grid-cols-3">
          <input
            required
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            placeholder="Add address not yet in mail"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={newDisplayName}
            onChange={(event) => setNewDisplayName(event.target.value)}
            placeholder="Display name (optional)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busyAction !== null}
            className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {busyAction === "add-sender" ? "Adding…" : "Add sender"}
          </button>
          <input
            value={newNotes}
            onChange={(event) => setNewNotes(event.target.value)}
            placeholder="Notes (optional)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-3"
          />
        </form>

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
                selectedEmails.size === 0 || !selectedFilterText || busyAction !== null
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
                <th className="w-28 px-4 py-2 text-right">In app</th>
                <th className="w-28 px-4 py-2 text-right">Personal</th>
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
                    {candidate.displayName ? `${candidate.displayName} · ` : ""}
                    {candidate.email}
                  </p>
                  {candidate.notes ? (
                    <p className="mt-1 text-slate-600">{candidate.notes}</p>
                  ) : null}
                </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {candidate.messageCount.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {candidate.personalFromCount == null
                    ? "—"
                    : candidate.personalFromCount.toLocaleString()}
                </td>
                <td className="px-4 py-3">
                <div className="flex flex-nowrap items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      void copyToClipboard(`email-${candidate.email}`, candidate.email)
                    }
                    disabled={busyAction !== null}
                    aria-label={
                      copiedKey === `email-${candidate.email}`
                        ? "Copied email"
                        : `Copy ${candidate.email}`
                    }
                    title={
                      copiedKey === `email-${candidate.email}` ? "Copied" : "Copy email"
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
                        onClick={() => void removeSender(candidate.id!, candidate.email)}
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
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Forward personal mail to dedicated
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Uses your connected personal Gmail to forward full conversation
              threads that match the allowlist to{" "}
              {expectedDedicatedEmail ? (
                <strong>{expectedDedicatedEmail}</strong>
              ) : (
                "the dedicated condo mailbox"
              )}
              . Every message in a matching thread is forwarded in order so
              replies stay grouped in the dedicated inbox. Processes{" "}
              {forwardStatus?.chunkSize ?? 50} messages, waits 2 minutes, then
              continues. Select sender rows above to forward a subset, or leave
              none selected to use saved allowlist senders.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startForwardWorkflow()}
              disabled={
                forwardInProgress ||
                busyAction !== null ||
                !connectionFor("personal_backfill") ||
                (selectedEmails.size === 0 && savedAllowlistCount === 0)
              }
              className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {busyAction === "forward-start"
                ? "Starting…"
                : forwardInProgress
                  ? "Forwarding…"
                  : "Start forwarding"}
            </button>
            <button
              type="button"
              onClick={() => void stopForwardWorkflow()}
              disabled={!forwardInProgress || busyAction !== null}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {busyAction === "forward-stop" ? "Stopping…" : "Stop"}
            </button>
          </div>
        </div>

        {forwardStarting ? (
          <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950">
            <p className="font-semibold text-teal-900">
              Scanning personal Gmail and building the forward queue…
            </p>
            <p className="mt-2">
              This can take up to a minute for large mailboxes. Live progress
              will appear here as soon as the first batch starts.
            </p>
          </div>
        ) : forwardStatus ? (
          <div
            className={`mt-4 rounded-lg border p-4 text-sm ${
              forwardStatus.isActive
                ? "border-teal-200 bg-teal-50 text-teal-950"
                : forwardStatus.phase === "failed"
                  ? "border-red-200 bg-red-50 text-red-950"
                  : "border-slate-200 bg-slate-50 text-slate-700"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-slate-900">
                  {forwardStatus.isActive
                    ? formatForwardPhase(forwardStatus.phase)
                    : `Last run: ${formatForwardPhase(forwardStatus.phase)}`}
                </p>
                <p className="mt-1">
                  Sending to{" "}
                  <span className="font-medium">{forwardStatus.targetEmail}</span>
                </p>
              </div>
              {forwardStatus.isActive ? (
                <span className="inline-flex items-center rounded-full bg-teal-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                  Live
                </span>
              ) : null}
            </div>

            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs font-medium text-slate-700">
                <span>Progress</span>
                <span>{forwardStatus.progressPercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/80">
                <div
                  className="h-full rounded-full bg-teal-600 transition-all duration-500"
                  style={{ width: `${forwardStatus.progressPercent}%` }}
                />
              </div>
            </div>

            <p className="mt-3">
              Matched{" "}
              <span className="font-medium">
                {formatPersonalGmailMatchSummary(
                  forwardStatus.messagesMatched,
                  forwardStatus.threadsMatched,
                )}
              </span>{" "}
              in personal Gmail (full threads, not just allowlist hits) ·
              forwarded{" "}
              <span className="font-medium">
                {forwardStatus.forwardedCount.toLocaleString()}
              </span>{" "}
              of{" "}
              <span className="font-medium">
                {forwardStatus.totalQueued.toLocaleString()}
              </span>{" "}
              queued this run
              {forwardStatus.pendingCount > 0
                ? ` · ${forwardStatus.pendingCount.toLocaleString()} remaining`
                : ""}
              {forwardStatus.failedCount > 0
                ? ` · ${forwardStatus.failedCount.toLocaleString()} failed`
                : ""}
              {forwardStatus.skippedCount > 0
                ? ` · ${forwardStatus.skippedCount.toLocaleString()} skipped as already forwarded`
                : ""}
            </p>

            {forwardStatus.phase === "waiting" && forwardCountdown ? (
              <p className="mt-2 font-medium text-teal-900">
                Next batch in {forwardCountdown}
              </p>
            ) : null}

            {forwardStatus.lastProcessedAt ? (
              <p className="mt-1 text-slate-600">
                Last message processed {formatDate(forwardStatus.lastProcessedAt)}
              </p>
            ) : forwardStatus.isActive ? (
              <p className="mt-1 text-slate-600">
                Scanning and sending the first batch…
              </p>
            ) : null}

            {forwardStatus.lastError ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
                {forwardStatus.lastError}
              </p>
            ) : null}

            {forwardStatus.recentActivity.length > 0 ? (
              <div className="mt-4">
                <p className="font-medium text-slate-900">Recent activity</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {forwardStatus.recentActivity.map((item) => (
                    <li key={`${item.gmailMessageId}-${item.processedAt ?? "pending"}`}>
                      <span
                        className={
                          item.status === "forwarded"
                            ? "text-teal-800"
                            : item.status === "failed"
                              ? "text-red-800"
                              : "text-slate-600"
                        }
                      >
                        {item.status}
                      </span>
                      {" · "}
                      {item.gmailMessageId.slice(0, 12)}…
                      {item.processedAt
                        ? ` · ${formatDate(item.processedAt)}`
                        : ""}
                      {item.error ? ` · ${item.error}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {forwardStatus.phase === "completed" ? (
              <p className="mt-3 text-teal-900">
                Forwarding finished. Check the dedicated Gmail inbox for messages
                from your personal address, then run Sync now here.
              </p>
            ) : null}

            {!forwardStatus.isActive &&
            forwardStatus.totalQueued === 0 &&
            forwardStatus.phase === "completed" ? (
              <p className="mt-3 text-slate-700">
                No new personal Gmail messages matched the allowlist filter, or
                everything matching was already forwarded in a previous run.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-medium">No forward workflow has run yet.</p>
            <p className="mt-2">
              Click <strong>Start forwarding</strong> above. While it runs, this
              panel shows live progress, recent message IDs, and a countdown
              between 50-message batches.
            </p>
            <p className="mt-2">
              Forwarded mail arrives in the dedicated inbox from your{" "}
              <strong>personal Gmail address</strong>, not the original senders.
              Check All Mail and Spam there too.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-red-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-red-900">Reset imported inbox</h2>
        <p className="mt-1 text-sm text-slate-600">
          Delete every imported email, thread, sync run, and email analysis from
          this app. Gmail connections, the sender allowlist, and messages in
          Gmail are not changed. The next personal Gmail sync re-imports
          allowlist mail into the app.
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
      </section>

      <ConfirmDialog
        open={confirmClearOpen}
        title="Delete all imported emails?"
        description={
          <>
            <p>
              This permanently removes all emails, threads, attachment caches,
              sync history, and email extractions from the app database.
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
