import { redirect } from "next/navigation";

import { UsersPageClient } from "@/components/UsersPageClient";
import { getSessionUser, isAuthEnabled } from "@/lib/auth/session";
import { requireAuthRedirect } from "@/lib/auth/require-auth-redirect";

export default async function UsersPage() {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  await requireAuthRedirect("/users");

  const user = await getSessionUser();
  if (!user || user.role !== "super_admin") {
    redirect("/");
  }

  return <UsersPageClient currentUserId={user.id} />;
}
