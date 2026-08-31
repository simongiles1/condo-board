export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { mergeFloorPlanSplit } from "@/lib/building/floor-plans";
import { parsePdfRect } from "@/lib/building/floor-plan-split";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      x?: number;
      y?: number;
      westCrop?: unknown;
      eastCrop?: unknown;
    };
    const x = Number(body.x);
    const y = Number(body.y);
    if (![x, y].every(Number.isFinite)) {
      return NextResponse.json(
        { error: "East offset x and y are required." },
        { status: 400 },
      );
    }
    const plan = await mergeFloorPlanSplit(id, {
      offset: { x, y },
      westCrop: parsePdfRect(body.westCrop, "West"),
      eastCrop: parsePdfRect(body.eastCrop, "East"),
    });
    return NextResponse.json(plan);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not merge sheets.";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
