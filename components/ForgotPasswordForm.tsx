"use client";

import Link from "next/link";
import { useState } from "react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    setDevResetUrl(null);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const raw = await response.text();
      let body: { error?: string; message?: string; devResetUrl?: string } = {};
      if (raw) {
        try {
          body = JSON.parse(raw) as typeof body;
        } catch {
          throw new Error(
            `Request failed (${response.status}). Server returned a non-JSON response.`,
          );
        }
      } else if (!response.ok) {
        throw new Error(`Request failed (${response.status}).`);
      }

      if (!response.ok) {
        throw new Error(body.error ?? "Could not send reset link.");
      }

      setMessage(
        body.message ??
          "If an account exists for that email, a reset link has been sent.",
      );
      if (body.devResetUrl) {
        setDevResetUrl(body.devResetUrl);
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not send reset link.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Forgot password</h1>
        <p className="mt-1 text-sm text-slate-600">
          Enter your email and we&apos;ll send a link to choose a new password.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </div>
      ) : null}

      {devResetUrl ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-medium">Local dev — email not configured</p>
          <p className="mt-1">
            Use this one-time reset link (also logged in the server terminal):
          </p>
          <a
            href={devResetUrl}
            className="mt-2 block break-all font-medium text-teal-800 underline"
          >
            {devResetUrl}
          </a>
        </div>
      ) : null}

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-800">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          autoComplete="email"
        />
      </label>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
      >
        {loading ? "Sending…" : "Send reset link"}
      </button>

      <p className="text-center text-sm text-slate-600">
        Remember your password?{" "}
        <Link href="/login" className="font-medium text-teal-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
