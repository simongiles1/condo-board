"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OrganizationRoleSelect } from "@/components/OrganizationRoleSelect";
import type { OrganizationRoleOption } from "@/lib/vendors/organization-roles";

export type PendingVendor = {
  id: string;
  name: string;
  contactJson: string | null;
};

export function VendorReviewPanel({
  pendingVendors,
  customOrganizationRoles = [],
}: {
  pendingVendors: PendingVendor[];
  customOrganizationRoles?: OrganizationRoleOption[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { name: string; role: string }>>(
    () =>
      Object.fromEntries(
        pendingVendors.map((vendor) => [
          vendor.id,
          { name: vendor.name, role: "vendor" },
        ]),
      ),
  );
  const [customRoles, setCustomRoles] = useState<OrganizationRoleOption[]>(
    () => customOrganizationRoles,
  );

  if (pendingVendors.length === 0) return null;

  async function approveVendor(vendorId: string) {
    const draft = drafts[vendorId];
    if (!draft?.name.trim()) return;

    setBusyId(vendorId);
    setError(null);

    try {
      const response = await fetch(`/api/insights/vendors/${vendorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          organizationRole: draft.role,
          reviewStatus: "approved",
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Could not approve vendor");
      }

      router.refresh();
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "Could not approve vendor",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Vendor review ({pendingVendors.length})
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          New organizations flagged as vendors need your confirmation. Rename them,
          pick the correct role (e.g. property manager vs contractor), then approve.
        </p>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="space-y-3">
        {pendingVendors.map((vendor) => {
          const draft = drafts[vendor.id] ?? { name: vendor.name, role: "vendor" };

          return (
            <div
              key={vendor.id}
              className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm"
            >
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <label className="block space-y-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Organization name
                  </span>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [vendor.id]: { ...draft, name: event.target.value },
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                  />
                </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Role
                    </span>
                    <OrganizationRoleSelect
                      value={draft.role}
                      onChange={(role) =>
                        setDrafts((current) => ({
                          ...current,
                          [vendor.id]: { ...draft, role },
                        }))
                      }
                      customRoles={customRoles}
                      onCustomRolesChange={setCustomRoles}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>

                <button
                  type="button"
                  disabled={busyId === vendor.id || !draft.name.trim()}
                  onClick={() => approveVendor(vendor.id)}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyId === vendor.id ? "Saving…" : "Approve"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
