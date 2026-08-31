export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { saveFloorPlanAnnotations } from "@/lib/building/floor-plans";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { annotations?: unknown };
    if (!Array.isArray(body.annotations)) {
      return NextResponse.json(
        { error: "annotations must be an array." },
        { status: 400 },
      );
    }
    const plan = await saveFloorPlanAnnotations(id, body.annotations);
    return NextResponse.json(plan);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save annotations.";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
