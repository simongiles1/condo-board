export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireRole } from "@/lib/auth/authorize";
import { isUserRole } from "@/lib/auth/roles";
import { updateUserNames, updateUserRole } from "@/lib/auth/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await requireRole("super_admin");
  if (isErrorResponse(actor)) return actor;

  const { id } = await context.params;
  let body: {
    role?: string;
    firstName?: string | null;
    lastName?: string | null;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const hasRole = body.role !== undefined;
  const hasFirstName = body.firstName !== undefined;
  const hasLastName = body.lastName !== undefined;

  if (!hasRole && !hasFirstName && !hasLastName) {
    return NextResponse.json(
      { error: "At least one field to update is required." },
      { status: 400 },
    );
  }

  if (hasRole) {
    if (!body.role || !isUserRole(body.role)) {
      return NextResponse.json({ error: "A valid role is required." }, { status: 400 });
    }

    const roleResult = await updateUserRole({
      userId: id,
      role: body.role,
      actorId: actor.id,
    });

    if ("error" in roleResult) {
      return NextResponse.json({ error: roleResult.error }, { status: 400 });
    }
  }

  if (hasFirstName || hasLastName) {
    const nameResult = await updateUserNames({
      userId: id,
      ...(hasFirstName ? { firstName: body.firstName ?? null } : {}),
      ...(hasLastName ? { lastName: body.lastName ?? null } : {}),
    });

    if ("error" in nameResult) {
      return NextResponse.json({ error: nameResult.error }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
