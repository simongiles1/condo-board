export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { saveFloorPlanPin } from "@/lib/building/floor-plans";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { x?: number; y?: number };
    const x = Number(body.x);
    const y = Number(body.y);
    if (![x, y].every(Number.isFinite)) {
      return NextResponse.json(
        { error: "Pin x and y are required." },
        { status: 400 },
      );
    }
    const result = await saveFloorPlanPin(id, { x, y });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save pin.";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
