export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { deleteFloorPlan, updateFloorPlan } from "@/lib/building/floor-plans";
import { parseFloorNumber } from "@/lib/building/floor-plan-shared";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Floor plan request failed.";
  const status = /not found/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      name?: string;
      notes?: string;
      floorNumber?: unknown;
      sortOrder?: number;
      familyId?: string;
    };
    let floorNumber: number | undefined;
    if (body.floorNumber !== undefined) {
      const parsed = parseFloorNumber(body.floorNumber);
      if (parsed == null) {
        return NextResponse.json(
          { error: "Floor number must be an integer." },
          { status: 400 },
        );
      }
      floorNumber = parsed;
    }
    const plan = await updateFloorPlan(id, {
      name: typeof body.name === "string" ? body.name : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      floorNumber,
      sortOrder:
        typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
          ? body.sortOrder
          : undefined,
      familyId: typeof body.familyId === "string" ? body.familyId : undefined,
    });
    return NextResponse.json(plan);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  const { id } = await context.params;
  try {
    await deleteFloorPlan(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
