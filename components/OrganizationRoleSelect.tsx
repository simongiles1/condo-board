"use client";

import { useMemo, useState } from "react";

import { AddOrganizationRoleDialog } from "@/components/AddOrganizationRoleDialog";
import {
  ADD_ORGANIZATION_ROLE_OPTION_VALUE,
  mergeOrganizationRoles,
  type OrganizationRoleOption,
} from "@/lib/vendors/organization-roles";

type Props = {
  value: string;
  onChange: (roleId: string) => void;
  customRoles: OrganizationRoleOption[];
  onCustomRolesChange: (roles: OrganizationRoleOption[]) => void;
  className?: string;
};

export function OrganizationRoleSelect({
  value,
  onChange,
  customRoles,
  onCustomRolesChange,
  className,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const roleOptions = useMemo(
    () => mergeOrganizationRoles(customRoles),
    [customRoles],
  );

  async function handleAddRole(label: string) {
    setBusy(true);

    try {
      const response = await fetch("/api/insights/organization-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });

      const payload = (await response.json()) as {
        error?: string;
        role?: OrganizationRoleOption;
      };

      if (!response.ok || !payload.role) {
        throw new Error(payload.error ?? "Could not add organization role");
      }

      const role = payload.role;
      onCustomRolesChange(
        customRoles.some((entry) => entry.id === role.id)
          ? customRoles
          : [...customRoles, role].sort((a, b) => a.label.localeCompare(b.label)),
      );
      onChange(role.id);
      setDialogOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <select
        value={value}
        onChange={(event) => {
          if (event.target.value === ADD_ORGANIZATION_ROLE_OPTION_VALUE) {
            setDialogOpen(true);
            return;
          }
          onChange(event.target.value);
        }}
        className={className}
      >
        {roleOptions.map((role) => (
          <option key={role.id} value={role.id}>
            {role.label}
          </option>
        ))}
        <option value={ADD_ORGANIZATION_ROLE_OPTION_VALUE}>+ Add new role…</option>
      </select>

      <AddOrganizationRoleDialog
        open={dialogOpen}
        busy={busy}
        onClose={() => {
          if (!busy) setDialogOpen(false);
        }}
        onSubmit={handleAddRole}
      />
    </>
  );
}
