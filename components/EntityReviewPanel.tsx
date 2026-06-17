"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { entityTypeBadgeClass } from "@/lib/email/entity-dedup";
import {
  extractEmailFromText,
  findMatchingApprovedOrganization,
  getExtractedOrgNameForGroup,
  joinPersonName,
  sortEntityReviewGroupsForApproval,
  splitPersonName,
  type ApprovedOrganizationOption,
  type EntityReviewGroup,
} from "@/lib/entities/entity-review";
import {
  isCondoCorporation,
  organizationRoleLabel,
  type OrganizationRoleOption,
} from "@/lib/vendors/organization-roles";
import { OrganizationRoleSelect } from "@/components/OrganizationRoleSelect";

type GroupDraft = {
  firstName: string;
  lastName: string;
  emailValue: string;
  linkedOrgName: string;
  personRole: string;
  phoneValue: string;
  orgValue: string;
  organizationRole: string;
};

type SessionApprovedOrganization = ApprovedOrganizationOption;

function isOrganizationOnlyGroup(group: EntityReviewGroup): boolean {
  return Boolean(group.org) && !group.person;
}

function isPersonContactGroup(group: EntityReviewGroup): boolean {
  return Boolean(group.person);
}

function defaultOrganizationRole(group: EntityReviewGroup): string {
  const orgName = group.org?.value ?? "";
  if (isCondoCorporation(orgName)) return "condo_corporation";
  if (group.vendorCandidate) return "vendor";
  return "property_manager";
}

function buildDraft(
  group: EntityReviewGroup,
  availableOrganizations: ApprovedOrganizationOption[],
): GroupDraft {
  const { firstName, lastName } = splitPersonName(group.person?.value ?? "");
  const contextText = [
    group.linkContext,
    group.person?.contexts.join(" "),
    group.org?.contexts.join(" "),
  ]
    .filter(Boolean)
    .join(" ");

  const extractedOrgName = getExtractedOrgNameForGroup(group);
  const matchingOrg = findMatchingApprovedOrganization(
    extractedOrgName,
    availableOrganizations,
  );

  return {
    firstName,
    lastName,
    emailValue: extractEmailFromText(contextText),
    linkedOrgName: matchingOrg?.name ?? "",
    personRole: group.personTitle?.trim() ?? "",
    phoneValue: group.phone?.value ?? "",
    orgValue: group.org?.value ?? extractedOrgName,
    organizationRole: defaultOrganizationRole(group),
  };
}

function groupTitle(group: EntityReviewGroup): string {
  return (
    group.person?.value ??
    group.org?.value ??
    group.unit?.value ??
    "Contact"
  );
}

function mergeOrganizationOptions(
  base: ApprovedOrganizationOption[],
  session: SessionApprovedOrganization[],
): ApprovedOrganizationOption[] {
  const merged = new Map<string, ApprovedOrganizationOption>();

  for (const org of [...base, ...session]) {
    const key = org.name.trim().toLowerCase();
    if (!key) continue;
    merged.set(key, org);
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function updateDraft(
  setDrafts: Dispatch<SetStateAction<Record<string, GroupDraft>>>,
  groupKey: string,
  patch: Partial<GroupDraft>,
) {
  setDrafts((current) => ({
    ...current,
    [groupKey]: {
      ...(current[groupKey] ?? {
        firstName: "",
        lastName: "",
        emailValue: "",
        linkedOrgName: "",
        personRole: "",
        phoneValue: "",
        orgValue: "",
        organizationRole: "vendor",
      }),
      ...patch,
    },
  }));
}

export function EntityReviewPanel({
  pendingGroups,
  approvedOrganizations,
  customOrganizationRoles = [],
}: {
  pendingGroups: EntityReviewGroup[];
  approvedOrganizations: ApprovedOrganizationOption[];
  customOrganizationRoles?: OrganizationRoleOption[];
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removedGroupKeys, setRemovedGroupKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [sessionApprovedOrgs, setSessionApprovedOrgs] = useState<
    SessionApprovedOrganization[]
  >([]);
  const [customRoles, setCustomRoles] = useState<OrganizationRoleOption[]>(
    () => customOrganizationRoles,
  );
  const [drafts, setDrafts] = useState<Record<string, GroupDraft>>(() =>
    Object.fromEntries(
      pendingGroups.map((group) => [
        group.key,
        buildDraft(group, approvedOrganizations),
      ]),
    ),
  );

  useEffect(() => {
    setCustomRoles(customOrganizationRoles);
  }, [customOrganizationRoles]);

  const availableOrganizations = useMemo(
    () => mergeOrganizationOptions(approvedOrganizations, sessionApprovedOrgs),
    [approvedOrganizations, sessionApprovedOrgs],
  );

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const group of pendingGroups) {
        if (!next[group.key]) {
          next[group.key] = buildDraft(group, availableOrganizations);
        }
      }
      return next;
    });
  }, [pendingGroups, availableOrganizations]);

  useEffect(() => {
    setDrafts((current) => {
      let changed = false;
      const next = { ...current };

      for (const group of pendingGroups) {
        if (!isPersonContactGroup(group)) continue;

        const draft = next[group.key];
        if (!draft || draft.linkedOrgName.trim()) continue;

        const extractedOrgName = getExtractedOrgNameForGroup(group);
        const matchingOrg = findMatchingApprovedOrganization(
          extractedOrgName,
          availableOrganizations,
        );
        if (!matchingOrg) continue;

        next[group.key] = {
          ...draft,
          linkedOrgName: matchingOrg.name,
        };
        changed = true;
      }

      return changed ? next : current;
    });
  }, [availableOrganizations, pendingGroups]);

  const visibleGroups = sortEntityReviewGroupsForApproval(
    pendingGroups.filter((group) => !removedGroupKeys.has(group.key)),
  );

  if (visibleGroups.length === 0) return null;

  async function deleteGroup(group: EntityReviewGroup) {
    setBusyKey(group.key);
    setError(null);

    try {
      const response = await fetch("/api/insights/entity-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mentionIds: group.mentionIds,
          approvalType: "delete",
        }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not delete entity");
      }

      setRemovedGroupKeys((current) => new Set(current).add(group.key));
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete entity",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function submitGroup(
    group: EntityReviewGroup,
    approvalType: "person" | "organization" | "exclude",
  ) {
    const draft = drafts[group.key] ?? buildDraft(group, availableOrganizations);
    setBusyKey(group.key);
    setError(null);

    try {
      const response = await fetch("/api/insights/entity-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mentionIds: group.mentionIds,
          approvalType,
          personValue: joinPersonName(draft.firstName, draft.lastName) || undefined,
          orgValue: draft.orgValue.trim() || undefined,
          phoneValue: draft.phoneValue.trim() || undefined,
          emailValue: draft.emailValue.trim() || undefined,
          linkedOrgName: draft.linkedOrgName.trim() || undefined,
          personRole: draft.personRole.trim() || undefined,
          organizationRole:
            approvalType === "organization" ? draft.organizationRole : undefined,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        organization?: SessionApprovedOrganization;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not approve entity");
      }

      if (payload.organization) {
        setSessionApprovedOrgs((current) => {
          const key = payload.organization!.name.trim().toLowerCase();
          if (current.some((org) => org.name.trim().toLowerCase() === key)) {
            return current;
          }
          return [...current, payload.organization!];
        });
      }

      setRemovedGroupKeys((current) => new Set(current).add(group.key));
      router.refresh();
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "Could not approve entity",
      );
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Entity review ({visibleGroups.length})
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Confirm extracted contacts before they enter the knowledge base. Approve
          organizations first when needed — person cards will then offer those orgs
          in the dropdown. Use <span className="font-medium">Delete</span> to
          remove an unrelated extraction from the database. Use{" "}
          <span className="font-medium">Ignore</span> to keep it on record and
          skip similar contacts in future emails.
        </p>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="space-y-3">
        {visibleGroups.map((group) => {
          const draft = drafts[group.key] ?? buildDraft(group, availableOrganizations);
          const extractedOrgName = getExtractedOrgNameForGroup(group);
          const extractedOrgPending =
            Boolean(extractedOrgName) &&
            !availableOrganizations.some((org) =>
              findMatchingApprovedOrganization(extractedOrgName, [org]),
            );

          if (isPersonContactGroup(group)) {
            return (
              <div
                key={group.key}
                className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-900">
                    {groupTitle(group)}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${entityTypeBadgeClass("person")}`}
                  >
                    Contact
                  </span>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      First name
                    </span>
                    <input
                      type="text"
                      value={draft.firstName}
                      onChange={(event) =>
                        updateDraft(setDrafts, group.key, {
                          firstName: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Last name
                    </span>
                    <input
                      type="text"
                      value={draft.lastName}
                      onChange={(event) =>
                        updateDraft(setDrafts, group.key, {
                          lastName: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Organization
                    </span>
                    <select
                      value={draft.linkedOrgName}
                      onChange={(event) =>
                        updateDraft(setDrafts, group.key, {
                          linkedOrgName: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    >
                      <option value="">— Select organization —</option>
                      {availableOrganizations.map((org) => (
                        <option key={org.name} value={org.name}>
                          {org.name}
                          {org.organizationRole
                            ? ` (${organizationRoleLabel(org.organizationRole, customRoles)})`
                            : ""}
                        </option>
                      ))}
                    </select>
                    {availableOrganizations.length === 0 ? (
                      <p className="mt-1 text-xs text-slate-500">
                        No organizations saved yet. Approve an organization card
                        below to link this contact.
                      </p>
                    ) : null}
                    {extractedOrgPending ? (
                      <p className="mt-1 text-xs text-amber-700">
                        Extracted as{" "}
                        <span className="font-medium">{extractedOrgName}</span> —
                        approve that organization below to link it here.
                      </p>
                    ) : null}
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Role / title
                    </span>
                    <input
                      type="text"
                      value={draft.personRole}
                      placeholder="e.g. Property Manager"
                      onChange={(event) =>
                        updateDraft(setDrafts, group.key, {
                          personRole: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>

                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Email
                    </span>
                    <input
                      type="email"
                      value={draft.emailValue}
                      placeholder="name@company.com"
                      onChange={(event) =>
                        updateDraft(setDrafts, group.key, {
                          emailValue: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>

                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Phone number
                    </span>
                    <input
                      type="text"
                      value={draft.phoneValue}
                      placeholder="e.g. (905) 940-1234 ext 232"
                      onChange={(event) =>
                        updateDraft(setDrafts, group.key, {
                          phoneValue: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                </div>

                {group.linkContext ? (
                  <p className="mt-3 whitespace-pre-wrap border-l-2 border-slate-200 pl-2 text-xs leading-relaxed text-slate-600">
                    {group.linkContext}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busyKey === group.key}
                      onClick={() => deleteGroup(group)}
                      className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyKey === group.key ? "Saving…" : "Delete"}
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === group.key}
                      onClick={() => submitGroup(group, "exclude")}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyKey === group.key ? "Saving…" : "Ignore — don't extract again"}
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={busyKey === group.key}
                    onClick={() => submitGroup(group, "person")}
                    className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busyKey === group.key ? "Saving…" : "Approve contact"}
                  </button>
                </div>
              </div>
            );
          }

          if (isOrganizationOnlyGroup(group)) {
            return (
              <div
                key={group.key}
                className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-900">
                    {groupTitle(group)}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${entityTypeBadgeClass("org")}`}
                  >
                    Organization
                  </span>
                  {group.vendorCandidate ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200">
                      Vendor candidate
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Organization name
                    </span>
                    <input
                      type="text"
                      value={draft.orgValue}
                      onChange={(event) =>
                        updateDraft(setDrafts, group.key, {
                          orgValue: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>

                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Organization role
                    </span>
                    <OrganizationRoleSelect
                      value={draft.organizationRole}
                      onChange={(organizationRole) =>
                        updateDraft(setDrafts, group.key, { organizationRole })
                      }
                      customRoles={customRoles}
                      onCustomRolesChange={setCustomRoles}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                    {isCondoCorporation(draft.orgValue) ? (
                      <p className="mt-1 text-xs text-slate-600">
                        This looks like a condominium corporation number (e.g. TSCC
                        ####), not an external vendor or contact. Use{" "}
                        <span className="font-medium">Condominium corporation</span>{" "}
                        or <span className="font-medium">Ignore</span> to skip future
                        extractions.
                      </p>
                    ) : null}
                  </label>

                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Email
                    </span>
                    <input
                      type="email"
                      value={draft.emailValue}
                      placeholder="info@company.com"
                      onChange={(event) =>
                        updateDraft(setDrafts, group.key, {
                          emailValue: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>

                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Phone number
                    </span>
                    <input
                      type="text"
                      value={draft.phoneValue}
                      placeholder="Optional main line"
                      onChange={(event) =>
                        updateDraft(setDrafts, group.key, {
                          phoneValue: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                </div>

                {group.linkContext ? (
                  <p className="mt-3 whitespace-pre-wrap border-l-2 border-slate-200 pl-2 text-xs leading-relaxed text-slate-600">
                    {group.linkContext}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busyKey === group.key}
                      onClick={() => deleteGroup(group)}
                      className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyKey === group.key ? "Saving…" : "Delete"}
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === group.key}
                      onClick={() => submitGroup(group, "exclude")}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyKey === group.key ? "Saving…" : "Ignore — don't extract again"}
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={busyKey === group.key}
                    onClick={() => submitGroup(group, "organization")}
                    className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busyKey === group.key ? "Saving…" : "Approve organization"}
                  </button>
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>
    </section>
  );
}
