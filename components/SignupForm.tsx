"use client";

import Link from "next/link";
import { useState } from "react";

export function SignupForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, password }),
      });

      const raw = await response.text();
      let body: { error?: string } = {};
      if (raw) {
        try {
          body = JSON.parse(raw) as { error?: string };
        } catch {
          throw new Error(
            `Sign up failed (${response.status}). Server returned a non-JSON response.`,
          );
        }
      } else if (!response.ok) {
        throw new Error(`Sign up failed (${response.status}).`);
      }

      if (!response.ok) {
        throw new Error(body.error ?? "Sign up failed.");
      }

      // Full navigation so the session cookie from the signup response is sent to middleware.
      window.location.assign("/");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Sign up failed.",
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
        <h1 className="text-xl font-semibold text-slate-900">Create account</h1>
        <p className="mt-1 text-sm text-slate-600">
          Sign up to access the condo board assistant.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-800">First name</span>
          <input
            type="text"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            autoComplete="given-name"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-800">Last name</span>
          <input
            type="text"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            autoComplete="family-name"
          />
        </label>
      </div>

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

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-800">Password</span>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          autoComplete="new-password"
        />
        <span className="mt-1 block text-xs text-slate-500">
          At least 8 characters.
        </span>
      </label>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
      >
        {loading ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-teal-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
