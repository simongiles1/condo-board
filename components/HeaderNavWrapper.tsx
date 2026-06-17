import { getSessionUser, isAuthEnabled } from "@/lib/auth/session";

import { HeaderNav } from "./HeaderNav";

export async function HeaderNavWrapper() {
  if (!isAuthEnabled()) {
    // Dev mode without auth: show full app nav except super-admin-only pages.
    return <HeaderNav role="admin" />;
  }

  const user = await getSessionUser();
  return <HeaderNav role={user?.role ?? null} />;
}
