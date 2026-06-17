import { getSessionUser, isAuthEnabled } from "@/lib/auth/session";

import { AuthNavActions } from "./AuthNavActions";

export async function AuthNav() {
  const user = isAuthEnabled() ? await getSessionUser() : null;
  return (
    <AuthNavActions email={user?.email ?? null} role={user?.role ?? null} />
  );
}
