"use client";

import { useEffect, useId, useState } from "react";

export function ProfileDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const titleId = useId();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [chatId, setChatId] = useState("");
  const [savedChatId, setSavedChatId] = useState<string | null>(null);
  const [botConfigured, setBotConfigured] = useState(true);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStatus(null);

    void fetch("/api/profile/telegram")
      .then(async (response) => {
        const body = (await response.json()) as {
          email?: string;
          firstName?: string | null;
          lastName?: string | null;
          chatId?: string | null;
          botConfigured?: boolean;
          botUsername?: string | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "Could not load profile.");
        }
        if (cancelled) return;
        setEmail(body.email ?? "");
        setFirstName(body.firstName ?? "");
        setLastName(body.lastName ?? "");
        const next = body.chatId ?? "";
        setChatId(next);
        setSavedChatId(body.chatId ?? null);
        setBotConfigured(body.botConfigured !== false);
        setBotUsername(body.botUsername ?? null);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load profile.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/profile/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          chatId: chatId.trim() || null,
        }),
      });
      const body = (await response.json()) as {
        firstName?: string | null;
        lastName?: string | null;
        chatId?: string | null;
        botConfigured?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not save profile.");
      }
      setFirstName(body.firstName ?? "");
      setLastName(body.lastName ?? "");
      setSavedChatId(body.chatId ?? null);
      setChatId(body.chatId ?? "");
      setBotConfigured(body.botConfigured !== false);
      setStatus("Profile saved.");
      onSaved?.();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/profile/telegram/test", {
        method: "POST",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Test message failed.");
      }
      setStatus("Test message sent. Check Telegram.");
    } catch (testError) {
      setError(
        testError instanceof Error ? testError.message : "Test message failed.",
      );
    } finally {
      setTesting(false);
    }
  }

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
        aria-labelledby={titleId}
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 id={titleId} className="text-xl font-semibold text-slate-900">
            Profile
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Your name on this account, plus Telegram for harvest review prompts.
          </p>
        </div>

        <form onSubmit={(event) => void saveProfile(event)} className="px-6 py-5">
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-semibold text-slate-800">
                  First name
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
                    autoComplete="given-name"
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-800">
                  Last name
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
                    autoComplete="family-name"
                  />
                </label>
              </div>
              <label className="mt-3 block text-sm font-semibold text-slate-800">
                Email
                <input
                  value={email}
                  readOnly
                  className="mt-1 w-full cursor-default rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                  autoComplete="email"
                />
              </label>

              <label className="mt-5 block text-sm font-semibold text-slate-800">
                Telegram chat ID
                <input
                  value={chatId}
                  onChange={(event) => setChatId(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
                  placeholder="123456789"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </label>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Telegram will not accept a test until you have opened this bot
                and tapped Start. {botUsername ? (
                  <>
                    Open{" "}
                    <a
                      href={`https://t.me/${botUsername}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-teal-800 underline"
                    >
                      @{botUsername}
                    </a>
                    , tap Start, then paste the chat ID the bot replies with.
                  </>
                ) : (
                  <>
                    Open the Condo Board bot, tap Start, then paste the chat ID
                    the bot replies with.
                  </>
                )}{" "}
                Save, then send a test message.
              </p>
              {!botConfigured ? (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  Server is missing TELEGRAM_BOT_TOKEN. The chat ID can still be
                  saved; test and harvest prompts need the bot token.
                </p>
              ) : null}
              {error ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  {error}
                </p>
              ) : null}
              {status ? (
                <p className="mt-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
                  {status}
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void testConnection()}
                  disabled={testing || saving || !savedChatId}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  {testing ? "Sending…" : "Send test message"}
                </button>
                <button
                  type="submit"
                  disabled={saving || testing}
                  className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
