import { cookies } from "next/headers";

import { AppShell } from "@/components/AppShell";
import { getSessionUser, isAuthEnabled } from "@/lib/auth/session";
import { NAV_COLLAPSED_COOKIE } from "@/lib/nav/structure";
import type { ReactNode } from "react";

export async function AppShellWrapper({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const collapsed = cookieStore.get(NAV_COLLAPSED_COOKIE)?.value === "1";

  if (!isAuthEnabled()) {
    return (
      <AppShell role="admin" user={null} collapsed={collapsed}>
        {children}
      </AppShell>
    );
  }

  const user = await getSessionUser();
  return (
    <AppShell
      role={user?.role ?? null}
      user={
        user
          ? {
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
            }
          : null
      }
      collapsed={collapsed}
    >
      {children}
    </AppShell>
  );
}
