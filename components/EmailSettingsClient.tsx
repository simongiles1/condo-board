"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

type AllowlistEntry = {
  id: string;
  email: string;
  displayName: string | null;
  notes: string | null;
  addedAt: string;
};

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
  backfillCutoffAt: string | null;
  oldestDedicatedReceivedAt: string | null;
  updatedAt: string;
};

type SyncResult = {
  messagesAdded: number;
  messagesSkipped: number;
  errors: string[];
};

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function EmailSettingsClient(props: {
  initialError?: string | null;
  initialConnected?: string | null;
}) {
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
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
  const [backfillCutoffAt, setBackfillCutoffAt] = useState<string | null>(null);
  const [oldestDedicatedReceivedAt, setOldestDedicatedReceivedAt] = useState<
    string | null
  >(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

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
      const [allowlistRes, connectionsRes, settingsRes] = await Promise.all([
        fetch("/api/email/allowlist"),
        fetch("/api/email/connections"),
        fetch("/api/email/settings"),
      ]);

      if (!allowlistRes.ok || !connectionsRes.ok || !settingsRes.ok) {
        throw new Error("Could not load email settings.");
      }

      const allowlistData = (await allowlistRes.json()) as AllowlistEntry[];
      const connectionsData = (await connectionsRes.json()) as {
        connections: ConnectionInfo[];
        expectedDedicatedEmail: string | null;
        scheduler: { running: boolean };
      };
      const settingsData = (await settingsRes.json()) as SyncSettings;

      setAllowlist(allowlistData);
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
      setBackfillCutoffAt(settingsData.backfillCutoffAt ?? null);
      setOldestDedicatedReceivedAt(settingsData.oldestDedicatedReceivedAt ?? null);
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
      setAllowlist((current) =>
        [...current, entry].sort((a, b) => a.email.localeCompare(b.email)),
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

  async function removeSender(id: string) {
    setBusyAction(`remove-${id}`);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/email/allowlist/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not remove sender.");
      setAllowlist((current) => current.filter((entry) => entry.id !== id));
      setStatusMessage("Sender removed.");
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
          ? `Dedicated sync complete: ${result.messagesAdded} added, ${result.messagesSkipped} skipped. View them on the Emails page.`
          : `Dedicated sync complete: no new messages (${result.messagesSkipped} already ingested). Open Emails to view your inbox.`,
      );
      if (result.errors?.length) {
        setErrorMessage(result.errors.join("\n"));
      }
      await loadData({ silent: true });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setErrorMessage(
          "Sync is taking longer than expected. If you connected a personal Gmail by mistake, reconnect the dedicated condo mailbox instead.",
        );
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Sync failed.");
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function runBackfill(senderEmail?: string) {
    setBusyAction(senderEmail ? `backfill-${senderEmail}` : "backfill-all");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/email/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(senderEmail ? { senderEmail } : {}),
        }),
      });
      const result = (await response.json()) as SyncResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Backfill failed.");
      setStatusMessage(
        backfillCutoffAt
          ? `Backfill complete (on or before ${formatDate(backfillCutoffAt)}): ${result.messagesAdded} added, ${result.messagesSkipped} skipped.`
          : `Backfill complete: ${result.messagesAdded} added, ${result.messagesSkipped} skipped.`,
      );
      if (result.errors?.length) {
        setErrorMessage(result.errors.join("\n"));
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Backfill failed.",
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
        Loading email settings…
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
          Connect your dedicated condo mailbox for ongoing sync, and your personal
          Gmail for one-time historical backfill.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(["dedicated", "personal_backfill"] as const).map((accountType) => {
            const connection = connectionFor(accountType);
            const label =
              accountType === "dedicated"
                ? "Dedicated condo mailbox"
                : "Personal Gmail (backfill)";

            return (
              <div
                key={accountType}
                className="rounded-lg border border-slate-100 bg-slate-50 p-4"
              >
                <h3 className="font-medium text-slate-900">{label}</h3>
                {accountType === "dedicated" ? (
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
                      , then reconnect the dedicated mailbox first.
                    </p>
                  </>
                ) : null}
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
              Pull new messages from the dedicated condo mailbox on demand or on a
              recurring schedule.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="block text-sm">
              <span className="mb-1 block font-medium text-slate-800">
                Backfill cutoff
              </span>
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800">
                {backfillCutoffAt
                  ? formatDate(backfillCutoffAt)
                  : "Not set — run dedicated sync first"}
              </p>
              <span className="mt-1 block text-xs text-slate-500">
                {oldestDedicatedReceivedAt
                  ? `One second before the oldest dedicated sync message (${formatDate(oldestDedicatedReceivedAt)}). Personal backfill will not import mail after this point.`
                  : "After your first dedicated sync, backfill stops one second before the oldest imported message to avoid duplicates."}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runSync()}
                disabled={busyAction !== null}
                className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {busyAction === "sync" ? "Syncing…" : "Sync now"}
              </button>
              <button
                type="button"
                onClick={() => void runBackfill()}
                disabled={busyAction !== null}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {busyAction === "backfill-all" ? "Backfilling…" : "Backfill all history"}
              </button>
            </div>
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
                  ? schedulePreview
                  : "Automatic sync is turned off. Use Sync now when you want fresh mail."}
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
          Used for personal Gmail historical backfill. A match on From, To, or CC
          imports the entire Gmail thread. Set up Gmail filters on your personal
          account to autoforward these senders to the dedicated mailbox.
        </p>

        <form onSubmit={addSender} className="mt-4 grid gap-3 md:grid-cols-3">
          <input
            required
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            placeholder="sender@example.com"
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

        <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100">
          {allowlist.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-slate-600">
              No senders yet. Add condo-related contacts before running backfill.
            </li>
          ) : (
            allowlist.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {entry.displayName ? `${entry.displayName} · ` : ""}
                    {entry.email}
                  </p>
                  {entry.notes ? (
                    <p className="text-sm text-slate-600">{entry.notes}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void runBackfill(entry.email)}
                    disabled={busyAction !== null}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Backfill sender
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeSender(entry.id)}
                    disabled={busyAction !== null}
                    className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
