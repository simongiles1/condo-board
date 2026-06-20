"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PendingAdditionalEmail } from "@/lib/entities/contact-emails";
import { EntityContextSnippet } from "@/components/EntityContextSnippet";

export function AdditionalEmailReviewPanel({
  pendingEmails,
}: {
  pendingEmails: PendingAdditionalEmail[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(pendingEmails.map((item) => [item.id, item.email])),
  );

  const visibleItems = pendingEmails.filter((item) => !removedIds.has(item.id));
  if (visibleItems.length === 0) return null;

  async function submitItem(
    item: PendingAdditionalEmail,
    rejectAdditionalEmail: boolean,
  ) {
    setBusyId(item.id);
    setError(null);

    try {
      const response = await fetch("/api/insights/entity-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalType: "additional_email",
          contactEmailId: item.id,
          emailValue: drafts[item.id]?.trim() || undefined,
          rejectAdditionalEmail,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not update additional email");
      }

      setRemovedIds((current) => new Set(current).add(item.id));
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not update additional email",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Additional emails ({visibleItems.length})
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          These addresses belong to contacts you already approved, but showed up
          from a different email in newly analyzed mail. Confirm to add them to
          that contact.
        </p>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="space-y-3">
        {visibleItems.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-sky-200 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <h3 className="font-semibold text-slate-900">{item.personName}</h3>
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 ring-1 ring-sky-200">
                  Additional email
                </span>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => submitItem(item, true)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => submitItem(item, false)}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  Add email
                </button>
              </div>
            </div>

            {item.existingEmails.length > 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                Known emails:{" "}
                <span className="font-medium">{item.existingEmails.join(", ")}</span>
              </p>
            ) : null}

            <label className="mt-3 block space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Email to add
              </span>
              <input
                type="email"
                value={drafts[item.id] ?? item.email}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [item.id]: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
              />
            </label>

            {item.context ? (
              <EntityContextSnippet text={item.context} />
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
