import { redirect } from "next/navigation";

import { UsersPageClient } from "@/components/UsersPageClient";
import { getSessionUser, isAuthEnabled } from "@/lib/auth/session";

export default async function UsersPage() {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const user = await getSessionUser();
  if (!user || user.role !== "super_admin") {
    redirect("/");
  }

  return <UsersPageClient currentUserId={user.id} />;
}
