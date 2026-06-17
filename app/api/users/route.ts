export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireRole } from "@/lib/auth/authorize";
import { listAppUsers } from "@/lib/auth/session";

export async function GET() {
  const user = await requireRole("super_admin");
  if (isErrorResponse(user)) return user;

  const users = await listAppUsers();
  return NextResponse.json({ users });
}
