import { NextResponse } from "next/server";

import {
  hasMinRole,
  type UserRole,
} from "@/lib/auth/roles";
import { getSessionUser } from "@/lib/auth/session";

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

export async function requireSession(): Promise<
  SessionUser | NextResponse<{ error: string }>
> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return user;
}

export async function requireRole(
  required: UserRole,
): Promise<SessionUser | NextResponse<{ error: string }>> {
  const user = await requireSession();
  if (user instanceof NextResponse) return user;

  if (!hasMinRole(user.role, required)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return user;
}

export function isErrorResponse<T>(
  value: T | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}
