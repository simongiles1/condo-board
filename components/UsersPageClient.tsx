"use client";

import { useEffect, useState } from "react";

import { roleLabel, USER_ROLES, type UserRole } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/format/datetime";

type AppUserRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  createdAt: string;
};

export function UsersPageClient({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AppUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/users");
        const body = (await response.json()) as {
          users?: AppUserRow[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "Failed to load users.");
        }
        setUsers(body.users ?? []);
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Failed to load users.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function patchUser(
    userId: string,
    payload: {
      role?: UserRole;
      firstName?: string | null;
      lastName?: string | null;
    },
  ) {
    setSavingUserId(userId);
    setError(null);

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to update user.");
      }

      setUsers((current) =>
        current.map((user) =>
          user.id === userId
            ? {
                ...user,
                ...(payload.role !== undefined ? { role: payload.role } : {}),
                ...(payload.firstName !== undefined
                  ? { firstName: payload.firstName }
                  : {}),
                ...(payload.lastName !== undefined
                  ? { lastName: payload.lastName }
                  : {}),
              }
            : user,
        ),
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Failed to update user.",
      );
    } finally {
      setSavingUserId(null);
    }
  }

  function updateRole(userId: string, role: UserRole) {
    return patchUser(userId, { role });
  }

  function updateNameField(
    userId: string,
    field: "firstName" | "lastName",
    value: string,
    previousValue: string | null,
  ) {
    const normalized = value.trim() || null;
    if (normalized === (previousValue?.trim() || null)) {
      return;
    }

    return patchUser(userId, { [field]: normalized });
  }

  if (loading) {
    return <p className="text-sm text-slate-600">Loading users…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage accounts and roles. Only super admins can access this page.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-700">Email</th>
              <th className="px-4 py-3 text-left font-medium text-slate-700">
                First name
              </th>
              <th className="px-4 py-3 text-left font-medium text-slate-700">
                Last name
              </th>
              <th className="px-4 py-3 text-left font-medium text-slate-700">Role</th>
              <th className="px-4 py-3 text-left font-medium text-slate-700">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-3 text-slate-900">
                  {user.email}
                  {user.id === currentUserId ? (
                    <span className="ml-2 text-xs text-slate-500">(you)</span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <input
                    key={`${user.id}-first-${user.firstName ?? ""}`}
                    type="text"
                    defaultValue={user.firstName ?? ""}
                    disabled={savingUserId === user.id}
                    onBlur={(event) =>
                      void updateNameField(
                        user.id,
                        "firstName",
                        event.target.value,
                        user.firstName,
                      )
                    }
                    className="w-full min-w-[8rem] rounded-md border border-slate-300 px-2 py-1 text-sm"
                    autoComplete="off"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    key={`${user.id}-last-${user.lastName ?? ""}`}
                    type="text"
                    defaultValue={user.lastName ?? ""}
                    disabled={savingUserId === user.id}
                    onBlur={(event) =>
                      void updateNameField(
                        user.id,
                        "lastName",
                        event.target.value,
                        user.lastName,
                      )
                    }
                    className="w-full min-w-[8rem] rounded-md border border-slate-300 px-2 py-1 text-sm"
                    autoComplete="off"
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    value={user.role}
                    disabled={savingUserId === user.id}
                    onChange={(event) =>
                      void updateRole(user.id, event.target.value as UserRole)
                    }
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  >
                    {USER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {formatDateTime(user.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
