export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  deleteFloorPlanFamily,
  updateFloorPlanFamily,
} from "@/lib/building/floor-plans";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Family request failed.";
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
      sortOrder?: number;
      scaleDenominator?: number | null;
      kind?: string;
    };
    const family = await updateFloorPlanFamily(id, {
      name: typeof body.name === "string" ? body.name : undefined,
      sortOrder:
        typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
          ? body.sortOrder
          : undefined,
      scaleDenominator:
        body.scaleDenominator === null
          ? null
          : typeof body.scaleDenominator === "number" &&
              Number.isFinite(body.scaleDenominator)
            ? body.scaleDenominator
            : undefined,
      kind:
        body.kind === "architectural" || body.kind === "mechanical"
          ? body.kind
          : undefined,
    });
    return NextResponse.json(family);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  const { id } = await context.params;
  try {
    await deleteFloorPlanFamily(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
