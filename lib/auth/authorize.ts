import { NextResponse } from "next/server";

import {
  hasMinRole,
  type UserRole,
} from "@/lib/auth/roles";
import { getSessionLookup, type AppUser } from "@/lib/auth/session";

export type SessionUser = AppUser;

export async function requireSession(): Promise<
  SessionUser | NextResponse<{ error: string }>
> {
  const result = await getSessionLookup();
  if (result.status === "ok") return result.user;
  if (result.status === "unavailable") {
    return NextResponse.json({ error: result.message }, { status: 503 });
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
