import { getSessionUser } from "@/lib/auth/session";

/** Returns the current app user id when auth is enabled, otherwise null. */
export async function getAnalysisActorUserId(): Promise<string | null> {
  const user = await getSessionUser();
  return user?.id ?? null;
}
