export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { saveFloorPlanCrop } from "@/lib/building/floor-plans";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    };
    const x = Number(body.x);
    const y = Number(body.y);
    const width = Number(body.width);
    const height = Number(body.height);
    if (![x, y, width, height].every(Number.isFinite)) {
      return NextResponse.json(
        { error: "Crop x, y, width, and height are required." },
        { status: 400 },
      );
    }
    const plan = await saveFloorPlanCrop(id, { x, y, width, height });
    return NextResponse.json(plan);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not crop floor plan.";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
