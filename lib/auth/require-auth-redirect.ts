import { redirect } from "next/navigation";

import { isAuthEnabled } from "@/lib/auth/config";
import { getSessionUser } from "@/lib/auth/session";

/** Redirect unauthenticated visitors to `/login` when auth is enabled. */
export async function requireAuthRedirect(nextPath?: string) {
  if (!isAuthEnabled()) return;

  const user = await getSessionUser();
  if (!user) {
    const loginPath =
      nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
        ? `/login?next=${encodeURIComponent(nextPath)}`
        : "/login";
    redirect(loginPath);
  }
}
