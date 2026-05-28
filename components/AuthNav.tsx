import { getSessionUser, isAuthEnabled } from "@/lib/auth/session";

import { AuthNavActions } from "./AuthNavActions";

export async function AuthNav() {
  if (!isAuthEnabled()) return null;

  const user = await getSessionUser();
  return <AuthNavActions email={user?.email ?? null} />;
}
