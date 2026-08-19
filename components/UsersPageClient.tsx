"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UserRolesAccessPanel } from "@/components/UserRolesAccessPanel";
import { roleLabel, USER_ROLES, type UserRole } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/format/datetime";
import {
  parseUsersAdminTab,
  splitNavHref,
  USERS_ADMIN_TABS,
  type UsersAdminTab,
} from "@/lib/nav/structure";

type AppUserRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  createdAt: string;
};

export function UsersPageClient({
  currentUserId,
  initialTab,
}: {
  currentUserId: string;
  initialTab?: string;
}) {
  const router = useRouter();
  const resolvedTab = parseUsersAdminTab(initialTab);
  const [view, setView] = useState<UsersAdminTab>(resolvedTab);
  const [users, setUsers] = useState<AppUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUserRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setView(resolvedTab);
  }, [resolvedTab]);

  function selectView(tab: UsersAdminTab) {
    setView(tab);
    router.replace(`/admin/system/users?tab=${tab}`, { scroll: false });
  }

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

  async function confirmDeleteUser() {
    if (!deleteTarget) return;

    setSavingUserId(deleteTarget.id);
    setDeleteError(null);
    setError(null);

    try {
      const response = await fetch(`/api/users/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to delete user.");
      }

      setUsers((current) =>
        current.filter((user) => user.id !== deleteTarget.id),
      );
      setDeleteTarget(null);
    } catch (deleteUserError) {
      setDeleteError(
        deleteUserError instanceof Error
          ? deleteUserError.message
          : "Failed to delete user.",
      );
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        <p className="mt-1 text-sm text-slate-600">
          {view === "roles"
            ? "What each role can access in the app."
            : "Manage accounts and roles. Only super admins can access this page."}
        </p>
        <div
          className="mt-4 inline-flex max-w-full flex-wrap rounded-xl border border-slate-200 bg-slate-100 p-1"
          role="tablist"
          aria-label="Users views"
        >
          {USERS_ADMIN_TABS.map((tab) => {
            const tabId = parseUsersAdminTab(splitNavHref(tab.href).tab);
            const selected = view === tabId;
            return (
              <button
                key={tab.href}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectView(tabId)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  selected
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {view === "roles" ? <UserRolesAccessPanel /> : null}

      {view === "users" && loading ? (
        <p className="text-sm text-slate-600">Loading users…</p>
      ) : null}

      {view === "users" && !loading ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {error ? (
        <div className="shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm">
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
              <th className="px-4 py-3 text-right font-medium text-slate-700">Actions</th>
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
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget(user);
                    }}
                    disabled={
                      savingUserId === user.id || user.id === currentUserId
                    }
                    className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={
          deleteTarget
            ? `Delete ${deleteTarget.email}?`
            : "Delete user?"
        }
        description={
          <>
            <p>
              Are you sure you want to delete this user? This permanently removes
              their account, password reset tokens, and clears their name from
              analysis history.
            </p>
            <p className="mt-2">
              Imported emails, building data, and other shared app content are{" "}
              <strong>not</strong> deleted.
            </p>
            {deleteError ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
                {deleteError}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete user"
        busy={deleteTarget !== null && savingUserId === deleteTarget.id}
        busyLabel="Deleting…"
        onConfirm={() => void confirmDeleteUser()}
        onCancel={() => {
          if (!deleteTarget || savingUserId !== deleteTarget.id) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      />
    </div>
  );
}
