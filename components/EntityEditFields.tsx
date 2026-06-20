"use client";

import { OrganizationRoleSelect } from "@/components/OrganizationRoleSelect";
import type { ApprovedOrganizationOption } from "@/lib/entities/entity-review";
import {
  isCondoCorporation,
  type OrganizationRoleOption,
} from "@/lib/vendors/organization-roles";

export type EntityEditDraft = {
  entityKind: EditableEntityKind;
  firstName: string;
  lastName: string;
  emailValue: string;
  linkedOrgName: string;
  personRole: string;
  phoneValue: string;
  orgValue: string;
  organizationRole: string;
};

type Props = {
  draft: EntityEditDraft;
  onChange: (patch: Partial<EntityEditDraft>) => void;
  orgOptions?: ApprovedOrganizationOption[];
  customRoles: OrganizationRoleOption[];
  onCustomRolesChange: (roles: OrganizationRoleOption[]) => void;
  fieldLabelClassName?: string;
  inputClassName?: string;
  emailPlaceholder?: string;
  phonePlaceholder?: string;
  showVendorCandidateHint?: boolean;
  showEmailPhone?: boolean;
};

const DEFAULT_FIELD_LABEL =
  "text-xs font-medium uppercase tracking-wide text-slate-500";
const DEFAULT_INPUT =
  "mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-900";

function halfWidthFieldClassName() {
  return "block min-w-[10rem] max-w-full flex-[1_1_calc(50%-0.75rem)] space-y-0.5";
}

export function EntityEditFields({
  draft,
  onChange,
  orgOptions = [],
  customRoles,
  onCustomRolesChange,
  fieldLabelClassName = DEFAULT_FIELD_LABEL,
  inputClassName = DEFAULT_INPUT,
  emailPlaceholder = "name@company.com",
  phonePlaceholder = "Optional phone number",
  showVendorCandidateHint = false,
  showEmailPhone = true,
}: Props) {
  const isContact = draft.entityKind === "contact";
  const isOrganization = draft.entityKind === "organization";

  return (
    <div className="space-y-3">
      {isContact ? (
        <>
          <div className="flex flex-wrap gap-3">
            <label className={halfWidthFieldClassName()}>
              <span className={fieldLabelClassName}>First name</span>
              <input
                type="text"
                value={draft.firstName}
                onChange={(event) => onChange({ firstName: event.target.value })}
                className={inputClassName}
              />
            </label>
            <label className={halfWidthFieldClassName()}>
              <span className={fieldLabelClassName}>Last name</span>
              <input
                type="text"
                value={draft.lastName}
                onChange={(event) => onChange({ lastName: event.target.value })}
                className={inputClassName}
              />
            </label>
          </div>
          <label className="block space-y-0.5">
            <span className={fieldLabelClassName}>Organization</span>
            <select
              value={draft.linkedOrgName}
              onChange={(event) =>
                onChange({ linkedOrgName: event.target.value })
              }
              className={inputClassName}
            >
              <option value="">— Select organization —</option>
              {orgOptions.map((org) => (
                <option key={org.name} value={org.name}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-0.5">
            <span className={fieldLabelClassName}>Role / title</span>
            <input
              type="text"
              value={draft.personRole}
              onChange={(event) => onChange({ personRole: event.target.value })}
              className={inputClassName}
            />
          </label>
        </>
      ) : null}

      {isOrganization ? (
        <div className="flex flex-wrap gap-3">
          <label className={halfWidthFieldClassName()}>
            <span className={fieldLabelClassName}>Organization name</span>
            <input
              type="text"
              value={draft.orgValue}
              onChange={(event) => onChange({ orgValue: event.target.value })}
              className={inputClassName}
            />
          </label>
          <label className={halfWidthFieldClassName()}>
            <span className={fieldLabelClassName}>Organization role</span>
            <OrganizationRoleSelect
              value={draft.organizationRole}
              onChange={(organizationRole) => onChange({ organizationRole })}
              customRoles={customRoles}
              onCustomRolesChange={onCustomRolesChange}
              className={inputClassName}
            />
            {showVendorCandidateHint && isCondoCorporation(draft.orgValue) ? (
              <p className="mt-0.5 text-xs text-slate-600">
                Condominium corporation — use Ignore to skip future extractions.
              </p>
            ) : null}
          </label>
        </div>
      ) : null}

      {showEmailPhone ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-0.5">
            <span className={fieldLabelClassName}>Email</span>
            <input
              type="email"
              value={draft.emailValue}
              placeholder={emailPlaceholder}
              onChange={(event) => onChange({ emailValue: event.target.value })}
              className={inputClassName}
            />
          </label>
          <label className="block space-y-0.5">
            <span className={fieldLabelClassName}>Phone number</span>
            <input
              type="text"
              value={draft.phoneValue}
              placeholder={phonePlaceholder}
              onChange={(event) => onChange({ phoneValue: event.target.value })}
              className={inputClassName}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
