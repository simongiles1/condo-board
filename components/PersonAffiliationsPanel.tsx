"use client";

import { useEffect, useState, useTransition } from "react";

import type { AffiliationRow } from "@/lib/affiliations/shared";

type OrgOption = {
  id: string;
  displayName: string;
  email: string | null;
};

export function PersonAffiliationsPanel({
  personId,
  currentOrganizationName,
  onChanged,
}: {
  personId: string;
  currentOrganizationName: string | null;
  onChanged?: () => void;
}) {
  const [affiliations, setAffiliations] = useState<AffiliationRow[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [manualOrgId, setManualOrgId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  async function refreshAffiliations() {
    const res = await fetch(
      `/api/affiliations?view=person&personId=${encodeURIComponent(personId)}`,
    );
    if (!res.ok) {
      setMessage("Failed to load affiliations.");
      return;
    }
    const json = (await res.json()) as { affiliations: AffiliationRow[] };
    setAffiliations(json.affiliations);
    setLoaded(true);
  }

  async function refreshOrgs() {
    const res = await fetch("/api/affiliations?view=organizations");
    if (!res.ok) return;
    const json = (await res.json()) as { organizations: OrgOption[] };
    setOrgs(json.organizations);
  }

  useEffect(() => {
    setLoaded(false);
    setMessage(null);
    setManualOrgId("");
    startTransition(async () => {
      await Promise.all([refreshAffiliations(), refreshOrgs()]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when person changes
  }, [personId]);

  function runAction(
    label: string,
    body: Record<string, unknown>,
    successMessage: (json: Record<string, unknown>) => string,
  ) {
    startTransition(async () => {
      setMessage(`${label}…`);
      const res = await fetch("/api/affiliations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as Record<string, unknown> & {
        error?: string;
      };
      if (!res.ok) {
        setMessage(json.error ?? `${label} failed.`);
        return;
      }
      setMessage(successMessage(json));
      await refreshAffiliations();
      onChanged?.();
    });
  }

  const pendingRows = affiliations.filter((a) => a.status === "pending");
  const approvedRows = affiliations.filter((a) => a.status === "approved");
  const deniedRows = affiliations.filter((a) => a.status === "denied");

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Organizations</h3>
        {currentOrganizationName ? (
          <span className="text-xs text-slate-500">
            Current: {currentOrganizationName}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            runAction("Proposing affiliations", { action: "propose" }, (json) => {
              const domain = Number(json.domainProposed ?? 0);
              const co = Number(json.cooccurrenceProposed ?? 0);
              return `Proposed ${domain + co} links (${domain} domain, ${co} co-occurrence). Still pending human review.`;
            })
          }
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          Propose links
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            runAction(
              "Adjudicating ambiguous",
              { action: "adjudicate" },
              (json) =>
                `AI annotated ${Number(json.decided ?? 0)} people (still pending approval).`,
            )
          }
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          AI adjudicate ambiguous
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            runAction(
              "Bridging legacy links",
              { action: "bridge_legacy" },
              (json) =>
                `Legacy bridge: ${Number(json.proposed ?? 0)} proposed from Insights string links.`,
            )
          }
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          Bridge Insights links
        </button>
      </div>

      {message ? (
        <p className="mt-2 text-xs text-slate-600">{message}</p>
      ) : null}

      {!loaded && pending ? (
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      ) : null}

      {pendingRows.length > 0 ? (
        <>
          <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Pending ({pendingRows.length})
          </h4>
          <ul className="mt-1 space-y-2 text-sm">
            {pendingRows.map((row) => (
              <li
                key={row.id}
                className="rounded border border-amber-100 bg-amber-50/60 px-2 py-2"
              >
                <div className="font-medium text-slate-900">
                  {row.organizationName ?? row.organizationKey}
                </div>
                <div className="break-words text-xs text-slate-500">
                  {row.source} · {row.confidence}
                  {row.evidence.rationale
                    ? ` · ${row.evidence.rationale}`
                    : ""}
                  {row.evidence.aiAction
                    ? ` · AI: ${row.evidence.aiAction}`
                    : ""}
                </div>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      runAction(
                        "Approving",
                        { action: "approve", affiliationId: row.id },
                        () => "Approved affiliation.",
                      )
                    }
                    className="rounded bg-teal-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      runAction(
                        "Denying",
                        { action: "deny", affiliationId: row.id },
                        () => "Denied — will not re-propose.",
                      )
                    }
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Deny
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {approvedRows.length > 0 ? (
        <>
          <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Approved
          </h4>
          <ul className="mt-1 space-y-1 text-sm">
            {approvedRows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {row.organizationName ?? row.organizationKey}
                  <span className="ml-1 text-xs text-slate-500">
                    ({row.relationType})
                  </span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    runAction(
                      "Denying",
                      { action: "deny", affiliationId: row.id },
                      () => "Removed affiliation.",
                    )
                  }
                  className="text-xs text-slate-500 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {deniedRows.length > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {deniedRows.length} denied link
          {deniedRows.length === 1 ? "" : "s"} (blocked from re-propose).
        </p>
      ) : null}

      {loaded && affiliations.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          No organization links yet. Propose links or pick one manually.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={manualOrgId}
          onChange={(e) => setManualOrgId(e.target.value)}
          className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Link organization…</option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.displayName}
              {org.email ? ` (${org.email})` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || !manualOrgId}
          onClick={() =>
            runAction(
              "Linking",
              {
                action: "manual_link",
                personId,
                organizationId: manualOrgId,
              },
              () => {
                setManualOrgId("");
                return "Manual link approved.";
              },
            )
          }
          className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
        >
          Link
        </button>
      </div>
    </div>
  );
}
