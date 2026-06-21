"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  EntityEditFields,
  type EntityEditDraft,
} from "@/components/EntityEditFields";
import { EntityKindBadgeSelect } from "@/components/EntityKindBadgeSelect";
import { FormDialog } from "@/components/FormDialog";
import { EntityContextSnippet } from "@/components/EntityContextSnippet";
import { entityTypeBadgeClass } from "@/lib/email/entity-dedup";
import { InsightSourceEmailsBadge } from "@/components/InsightSourceEmailsBadge";
import type { BuildingEmailReference } from "@/lib/building/resolve-source-email";
import {
  applyEntityKindChange,
  entityKindFromGroup,
  findMatchingApprovedOrganization,
  isOrganizationOnlyGroup,
  isPersonContactGroup,
  joinPersonName,
  splitPersonName,
  targetEntityTypeFromKind,
  type ApprovedOrganizationOption,
  type EntityReviewGroup,
} from "@/lib/entities/entity-review";
import {
  organizationRoleLabel,
  type OrganizationRoleOption,
} from "@/lib/vendors/organization-roles";

function groupTitle(group: EntityReviewGroup): string {
  return (
    group.person?.value ??
    group.org?.value ??
    group.unit?.value ??
    "Contact"
  );
}

function buildDraftFromGroup(
  group: EntityReviewGroup,
  approvedOrganizations: ApprovedOrganizationOption[],
): EntityEditDraft {
  const { firstName, lastName } = splitPersonName(group.person?.value ?? "");
  const linkedOrgName =
    group.person
      ? (findMatchingApprovedOrganization(
          group.org?.value ?? group.extractedOrgName ?? "",
          approvedOrganizations,
        )?.name ??
        group.extractedOrgName?.trim() ??
        group.org?.value?.trim() ??
        "")
      : "";

  return {
    entityKind: entityKindFromGroup(group),
    firstName,
    lastName,
    emailValue: group.contactEmails?.[0] ?? "",
    linkedOrgName,
    personRole: group.personTitle?.trim() ?? "",
    phoneValue: group.phone?.value ?? "",
    orgValue: group.org?.value ?? "",
    organizationRole: group.org
      ? (findMatchingApprovedOrganization(
          group.org.value,
          approvedOrganizations,
        )?.organizationRole ??
        "vendor")
      : "vendor",
  };
}

export function EditableApprovedEntitiesList({
  groups,
  approvedOrganizations,
  customOrganizationRoles = [],
  onOpenSourceEmail,
}: {
  groups: Array<EntityReviewGroup & { sourceEmails?: BuildingEmailReference[] }>;
  approvedOrganizations: ApprovedOrganizationOption[];
  customOrganizationRoles?: OrganizationRoleOption[];
  onOpenSourceEmail?: (emailId: string) => void;
}) {
  const router = useRouter();
  const [editingGroup, setEditingGroup] = useState<EntityReviewGroup | null>(
    null,
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customRoles, setCustomRoles] = useState(customOrganizationRoles);
  const [draft, setDraft] = useState<EntityEditDraft | null>(null);

  useEffect(() => {
    setCustomRoles(customOrganizationRoles);
  }, [customOrganizationRoles]);

  const orgOptions = useMemo(
    () => approvedOrganizations,
    [approvedOrganizations],
  );

  function openEdit(group: EntityReviewGroup) {
    setEditingGroup(group);
    setDraft(buildDraftFromGroup(group, approvedOrganizations));
    setError(null);
  }

  function closeEdit() {
    if (busyKey) return;
    setEditingGroup(null);
    setDraft(null);
    setError(null);
  }

  async function saveGroup() {
    if (!editingGroup || !draft) return;

    setBusyKey(editingGroup.key);
    setError(null);

    try {
      const response = await fetch("/api/insights/entity-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mentionIds: editingGroup.mentionIds,
          approvalType: "edit",
          targetEntityType: targetEntityTypeFromKind(draft.entityKind),
          personValue:
            draft.entityKind === "contact"
              ? joinPersonName(draft.firstName, draft.lastName) || undefined
              : undefined,
          orgValue:
            draft.entityKind === "organization"
              ? draft.orgValue.trim() || undefined
              : undefined,
          phoneValue: draft.phoneValue.trim() || undefined,
          emailValue: draft.emailValue.trim() || undefined,
          linkedOrgName:
            draft.entityKind === "contact"
              ? draft.linkedOrgName.trim() || undefined
              : undefined,
          personRole:
            draft.entityKind === "contact"
              ? draft.personRole.trim() || undefined
              : undefined,
          organizationRole:
            draft.entityKind === "organization"
              ? draft.organizationRole
              : undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save entity");
      }

      closeEdit();
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save entity",
      );
    } finally {
      setBusyKey(null);
    }
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="text-sm text-slate-600">
          No approved contacts yet. Review extracted entities after analyzing
          emails.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {groups.map((group) => {
          const isPerson = isPersonContactGroup(group);
          const isOrg = isOrganizationOnlyGroup(group);
          const organizationRole = group.org
            ? (findMatchingApprovedOrganization(
                group.org.value,
                approvedOrganizations,
              )?.organizationRole ?? "vendor")
            : "vendor";

          return (
            <li
              key={group.key}
              className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900">
                      {groupTitle(group)}
                    </p>
                    {isPerson ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${entityTypeBadgeClass("person")}`}
                      >
                        Contact
                      </span>
                    ) : null}
                    {isOrg ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${entityTypeBadgeClass("org")}`}
                      >
                        Organization
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 space-y-1 text-sm text-slate-600">
                    {group.contactEmails?.length ? (
                      <p>
                        Emails:{" "}
                        <span className="font-medium">
                          {group.contactEmails.join(", ")}
                        </span>
                      </p>
                    ) : null}
                    {group.org && isPerson ? (
                      <p>
                        Organization:{" "}
                        <span className="font-medium">{group.org.value}</span>
                      </p>
                    ) : null}
                    {group.personTitle ? (
                      <p>
                        Role:{" "}
                        <span className="font-medium">{group.personTitle}</span>
                      </p>
                    ) : null}
                    {group.phone ? (
                      <p>
                        Phone:{" "}
                        <span className="font-medium">{group.phone.value}</span>
                      </p>
                    ) : null}
                    {isOrg ? (
                      <p>
                        Role:{" "}
                        <span className="font-medium">
                          {organizationRoleLabel(organizationRole, customRoles)}
                        </span>
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {onOpenSourceEmail && group.sourceEmails?.length ? (
                    <InsightSourceEmailsBadge
                      emails={group.sourceEmails}
                      onOpenEmail={onOpenSourceEmail}
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={busyKey === group.key}
                    onClick={() => openEdit(group)}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Edit
                  </button>
                </div>
              </div>

              {group.linkContext ? (
                <EntityContextSnippet text={group.linkContext} />
              ) : null}
            </li>
          );
        })}
      </ul>

      <FormDialog
        open={Boolean(editingGroup && draft)}
        title="Edit entity"
        description={editingGroup ? groupTitle(editingGroup) : undefined}
        busy={busyKey === editingGroup?.key}
        error={error}
        onClose={closeEdit}
        onSubmit={() => void saveGroup()}
      >
        {draft ? (
          <>
            <div className="mb-3">
              <EntityKindBadgeSelect
                value={draft.entityKind}
                disabled={busyKey === editingGroup?.key}
                onChange={(entityKind) =>
                  setDraft((current) =>
                    current
                      ? { ...current, ...applyEntityKindChange(current, entityKind) }
                      : current,
                  )
                }
              />
            </div>
            <EntityEditFields
              draft={draft}
              onChange={(patch) =>
                setDraft((current) => (current ? { ...current, ...patch } : current))
              }
              orgOptions={orgOptions}
              customRoles={customRoles}
              onCustomRolesChange={setCustomRoles}
            />
          </>
        ) : null}
      </FormDialog>
    </div>
  );
}
