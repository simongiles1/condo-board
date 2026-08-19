import { redirect } from "next/navigation";

import { UsersPageClient } from "@/components/UsersPageClient";
import { getSessionUser, isAuthEnabled } from "@/lib/auth/session";
import { requireAuthRedirect } from "@/lib/auth/require-auth-redirect";
import { parseUsersAdminTab } from "@/lib/nav/structure";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  await requireAuthRedirect("/admin/system/users");

  const user = await getSessionUser();
  if (!user || user.role !== "super_admin") {
    redirect("/");
  }

  const params = await searchParams;

  return (
    <UsersPageClient
      currentUserId={user.id}
      initialTab={parseUsersAdminTab(params.tab)}
    />
  );
}
