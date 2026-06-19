import { getSessionUser, isAuthEnabled } from "@/lib/auth/session";

import { AuthNavActions } from "./AuthNavActions";

export async function AuthNav() {
  if (isAuthEnabled()) {
    const user = await getSessionUser();
    if (!user) {
      return null;
    }
    return (
      <AuthNavActions
        email={user.email}
        firstName={user.firstName}
        lastName={user.lastName}
        role={user.role}
      />
    );
  }

  return (
    <AuthNavActions email={null} firstName={null} lastName={null} role={null} />
  );
}
