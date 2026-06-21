"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { EntityContextSnippet } from "@/components/EntityContextSnippet";
import { EntityEditFields, type EntityEditDraft } from "@/components/EntityEditFields";
import { EntityKindBadgeSelect } from "@/components/EntityKindBadgeSelect";
import { InsightSourceEmailsBadge } from "@/components/InsightSourceEmailsBadge";
import type { BuildingEmailReference } from "@/lib/building/resolve-source-email";
import {
  applyEntityKindChange,
  entityKindFromGroup,
  extractEmailFromText,
  findMatchingApprovedOrganization,
  getExtractedOrgNameForGroup,
  isPersonContactGroup,
  joinPersonName,
  sortEntityReviewGroupsForApproval,
  splitPersonName,
  targetEntityTypeFromKind,
  type ApprovedOrganizationOption,
  type EntityReviewGroup,
} from "@/lib/entities/entity-review";
import {
  isCondoCorporation,
  type OrganizationRoleOption,
} from "@/lib/vendors/organization-roles";

function actionButtonClassName(variant: "danger" | "neutral" | "primary") {
  const base =
    "rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";
  if (variant === "danger") {
    return `${base} border border-red-200 bg-white text-red-700 hover:bg-red-50`;
  }
  if (variant === "primary") {
    return `${base} bg-teal-700 font-semibold text-white hover:bg-teal-800`;
  }
  return `${base} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
}

function defaultOrganizationRole(group: EntityReviewGroup): string {
  const orgName = group.org?.value ?? "";
  if (isCondoCorporation(orgName)) return "condo_corporation";
  if (group.vendorCandidate) return "vendor";
  return "property_manager";
}

type SessionApprovedOrganization = ApprovedOrganizationOption;

function emptyDraft(): EntityEditDraft {
  return {
    entityKind: "contact",
    firstName: "",
    lastName: "",
    emailValue: "",
    linkedOrgName: "",
    personRole: "",
    phoneValue: "",
    orgValue: "",
    organizationRole: "vendor",
  };
}

function buildDraft(
  group: EntityReviewGroup,
  availableOrganizations: ApprovedOrganizationOption[],
): EntityEditDraft {
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
    entityKind: entityKindFromGroup(group),
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

function fieldLabelClassName() {
  return "text-xs font-medium uppercase tracking-wide text-slate-500";
}

function fieldInputClassName() {
  return "mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-900";
}

function updateDraft(
  setDrafts: Dispatch<SetStateAction<Record<string, EntityEditDraft>>>,
  groupKey: string,
  patch: Partial<EntityEditDraft>,
) {
  setDrafts((current) => ({
    ...current,
    [groupKey]: {
      ...(current[groupKey] ?? emptyDraft()),
      ...patch,
    },
  }));
}

export function EntityReviewPanel({
  pendingGroups,
  approvedOrganizations,
  customOrganizationRoles = [],
  onOpenSourceEmail,
}: {
  pendingGroups: Array<EntityReviewGroup & { sourceEmails?: BuildingEmailReference[] }>;
  approvedOrganizations: ApprovedOrganizationOption[];
  customOrganizationRoles?: OrganizationRoleOption[];
  onOpenSourceEmail?: (emailId: string) => void;
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
  const [drafts, setDrafts] = useState<Record<string, EntityEditDraft>>(() =>
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
  ) as Array<EntityReviewGroup & { sourceEmails?: BuildingEmailReference[] }>;

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
    action: "approve" | "exclude",
  ) {
    const draft = drafts[group.key] ?? buildDraft(group, availableOrganizations);
    const approvalType =
      action === "exclude"
        ? "exclude"
        : draft.entityKind === "contact"
          ? "person"
          : "organization";
    setBusyKey(group.key);
    setError(null);

    try {
      const response = await fetch("/api/insights/entity-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mentionIds: group.mentionIds,
          approvalType,
          targetEntityType: targetEntityTypeFromKind(draft.entityKind),
          personValue: joinPersonName(draft.firstName, draft.lastName) || undefined,
          orgValue: draft.orgValue.trim() || undefined,
          phoneValue: draft.phoneValue.trim() || undefined,
          emailValue: draft.emailValue.trim() || undefined,
          linkedOrgName: draft.linkedOrgName.trim() || undefined,
          personRole: draft.personRole.trim() || undefined,
          organizationRole:
            draft.entityKind === "organization"
              ? draft.organizationRole
              : undefined,
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
          Confirm extracted entities before they enter the knowledge base. Approve
          organizations first when needed — person cards will then offer those orgs
          in the dropdown. Change entity type if the AI misclassified a contact or
          organization. Use <span className="font-medium">Delete</span> to remove
          an unrelated extraction. Use <span className="font-medium">Ignore</span>{" "}
          to keep it on record and skip similar extractions in future emails.
        </p>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="space-y-2">
        {visibleGroups.map((group) => {
          const draft = drafts[group.key] ?? buildDraft(group, availableOrganizations);
          const extractedOrgName = getExtractedOrgNameForGroup(group);
          const extractedOrgPending =
            draft.entityKind === "contact" &&
            Boolean(extractedOrgName) &&
            !availableOrganizations.some((org) =>
              findMatchingApprovedOrganization(extractedOrgName, [org]),
            );
          const displayTitle =
            draft.entityKind === "contact"
              ? joinPersonName(draft.firstName, draft.lastName) || groupTitle(group)
              : draft.orgValue.trim() || groupTitle(group);

          return (
            <div
              key={group.key}
              className="rounded-xl border border-amber-200 bg-white p-3 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-900">{displayTitle}</h3>
                  <EntityKindBadgeSelect
                    value={draft.entityKind}
                    disabled={busyKey === group.key}
                    onChange={(entityKind) =>
                      updateDraft(
                        setDrafts,
                        group.key,
                        applyEntityKindChange(draft, entityKind),
                      )
                    }
                  />
                  {group.vendorCandidate && draft.entityKind === "organization" ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200">
                      Vendor candidate
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {onOpenSourceEmail && group.sourceEmails?.length ? (
                    <InsightSourceEmailsBadge
                      emails={group.sourceEmails}
                      onOpenEmail={onOpenSourceEmail}
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={busyKey === group.key}
                    onClick={() => deleteGroup(group)}
                    aria-label={`Delete entity: ${displayTitle}`}
                    title="Delete"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <TrashIcon />
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === group.key}
                    onClick={() => submitGroup(group, "exclude")}
                    className={actionButtonClassName("neutral")}
                  >
                    {busyKey === group.key ? "Saving…" : "Ignore"}
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === group.key}
                    onClick={() => submitGroup(group, "approve")}
                    className={actionButtonClassName("primary")}
                  >
                    {busyKey === group.key ? "Saving…" : "Approve"}
                  </button>
                </div>
              </div>

              <div className="mt-2">
                <EntityEditFields
                  draft={draft}
                  onChange={(patch) => updateDraft(setDrafts, group.key, patch)}
                  orgOptions={availableOrganizations}
                  customRoles={customRoles}
                  onCustomRolesChange={setCustomRoles}
                  fieldLabelClassName={fieldLabelClassName()}
                  inputClassName={fieldInputClassName()}
                  emailPlaceholder={
                    draft.entityKind === "contact"
                      ? "name@company.com"
                      : "info@company.com"
                  }
                  phonePlaceholder={
                    draft.entityKind === "contact"
                      ? "e.g. (905) 940-1234 ext 232"
                      : "Optional main line"
                  }
                  showVendorCandidateHint
                />
                {extractedOrgPending ? (
                  <p className="mt-2 text-xs text-amber-700">
                    Extracted as{" "}
                    <span className="font-medium">{extractedOrgName}</span> — approve
                    that organization below to link it here.
                  </p>
                ) : null}
                {availableOrganizations.length === 0 &&
                draft.entityKind === "contact" ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No organizations saved yet. Approve an organization card below to
                    link this contact.
                  </p>
                ) : null}
              </div>

              {group.linkContext ? (
                <EntityContextSnippet text={group.linkContext} />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
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
