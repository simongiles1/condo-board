"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  EntityEditFields,
  type EntityEditDraft,
} from "@/components/EntityEditFields";
import { EntityKindBadgeSelect } from "@/components/EntityKindBadgeSelect";
import { FormDialog } from "@/components/FormDialog";
import type { ApprovedOrganizationCard } from "@/lib/entities/entity-review";
import {
  applyEntityKindChange,
  joinPersonName,
  targetEntityTypeFromKind,
} from "@/lib/entities/entity-review";
import {
  organizationRoleLabel,
  type OrganizationRoleOption,
} from "@/lib/vendors/organization-roles";

function buildDraft(org: ApprovedOrganizationCard): EntityEditDraft {
  return {
    entityKind: "organization",
    firstName: "",
    lastName: "",
    organizationRole: org.organizationRole ?? "vendor",
    emailValue: org.contactEmail ?? "",
    phoneValue: org.phone ?? "",
    linkedOrgName: "",
    personRole: "",
    orgValue: org.name,
  };
}

export function EditableApprovedOrganizationsGrid({
  organizations,
  customOrganizationRoles = [],
}: {
  organizations: ApprovedOrganizationCard[];
  customOrganizationRoles?: OrganizationRoleOption[];
}) {
  const router = useRouter();
  const [editingOrg, setEditingOrg] = useState<ApprovedOrganizationCard | null>(
    null,
  );
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customRoles, setCustomRoles] = useState(customOrganizationRoles);
  const [draft, setDraft] = useState<EntityEditDraft | null>(null);

  useEffect(() => {
    setCustomRoles(customOrganizationRoles);
  }, [customOrganizationRoles]);

  function openEdit(org: ApprovedOrganizationCard) {
    setEditingOrg(org);
    setDraft(buildDraft(org));
    setError(null);
  }

  function closeEdit() {
    if (busyName) return;
    setEditingOrg(null);
    setDraft(null);
    setError(null);
  }

  async function saveOrganization() {
    if (!editingOrg || !draft) return;

    setBusyName(editingOrg.name);
    setError(null);

    try {
      if (editingOrg.mentionIds.length > 0) {
        const response = await fetch("/api/insights/entity-review", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mentionIds: editingOrg.mentionIds,
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
            organizationRole:
              draft.entityKind === "organization"
                ? draft.organizationRole
                : undefined,
            linkedOrgName:
              draft.entityKind === "contact"
                ? draft.linkedOrgName.trim() || undefined
                : undefined,
            personRole:
              draft.entityKind === "contact"
                ? draft.personRole.trim() || undefined
                : undefined,
            emailValue: draft.emailValue.trim() || undefined,
            phoneValue: draft.phoneValue.trim() || undefined,
            vendorId: editingOrg.vendorId ?? undefined,
          }),
        });

        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not save organization");
        }
      } else if (editingOrg.vendorId) {
        if (draft.entityKind === "contact") {
          throw new Error(
            "Vendor-only records cannot be converted to contacts here.",
          );
        }

        const response = await fetch(`/api/insights/vendors/${editingOrg.vendorId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.orgValue.trim(),
            organizationRole: draft.organizationRole,
          }),
        });

        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not save organization");
        }
      }

      closeEdit();
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save organization",
      );
    } finally {
      setBusyName(null);
    }
  }

  if (organizations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="text-sm text-slate-600">No approved organizations yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {organizations.map((org) => (
          <div
            key={org.name}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-slate-900">{org.name}</h3>
                {org.organizationRole ? (
                  <p className="mt-1 text-sm text-slate-600">
                    {organizationRoleLabel(org.organizationRole, customRoles)}
                  </p>
                ) : null}
                {org.contactEmail ? (
                  <p className="mt-1 text-sm text-slate-600">
                    Email:{" "}
                    <span className="font-medium">{org.contactEmail}</span>
                  </p>
                ) : null}
                {org.phone ? (
                  <p className="mt-1 text-sm text-slate-600">
                    Phone: <span className="font-medium">{org.phone}</span>
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                disabled={busyName === org.name}
                onClick={() => openEdit(org)}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      <FormDialog
        open={Boolean(editingOrg && draft)}
        title="Edit organization"
        description={editingOrg?.name}
        busy={busyName === editingOrg?.name}
        error={error}
        onClose={closeEdit}
        onSubmit={() => void saveOrganization()}
      >
        {draft ? (
          <>
            <div className="mb-3">
              <EntityKindBadgeSelect
                value={draft.entityKind}
                disabled={busyName === editingOrg?.name}
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
              customRoles={customRoles}
              onCustomRolesChange={setCustomRoles}
              showVendorCandidateHint
              showEmailPhone={Boolean(editingOrg?.mentionIds.length)}
            />
          </>
        ) : null}
      </FormDialog>
    </div>
  );
}
