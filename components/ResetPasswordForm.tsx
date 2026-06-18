"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function ResetPasswordFormInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const raw = await response.text();
      let body: { error?: string } = {};
      if (raw) {
        try {
          body = JSON.parse(raw) as typeof body;
        } catch {
          throw new Error(
            `Reset failed (${response.status}). Server returned a non-JSON response.`,
          );
        }
      } else if (!response.ok) {
        throw new Error(`Reset failed (${response.status}).`);
      }

      if (!response.ok) {
        throw new Error(body.error ?? "Could not reset password.");
      }

      window.location.assign("/");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not reset password.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Reset password</h1>
        <p className="text-sm text-slate-600">
          This reset link is missing or invalid. Request a new one from the forgot
          password page.
        </p>
        <Link
          href="/forgot-password"
          className="inline-flex rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
        >
          Request reset link
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Choose a new password</h1>
        <p className="mt-1 text-sm text-slate-600">
          Enter a new password for your account.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-800">New password</span>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          autoComplete="new-password"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-800">
          Confirm new password
        </span>
        <input
          type="password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          autoComplete="new-password"
        />
      </label>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
      >
        {loading ? "Saving…" : "Update password"}
      </button>

      <p className="text-center text-sm text-slate-600">
        <Link href="/login" className="font-medium text-teal-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Loading…
        </div>
      }
    >
      <ResetPasswordFormInner />
    </Suspense>
  );
}
