export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { createFloorPlanFamily } from "@/lib/building/floor-plans";
import { parseFloorPlanDrawingSet } from "@/lib/building/floor-plan-shared";

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  try {
    const body = (await request.json()) as { name?: string; kind?: string };
    const name = typeof body.name === "string" ? body.name : "";
    const family = await createFloorPlanFamily(
      name,
      parseFloorPlanDrawingSet(body.kind),
    );
    return NextResponse.json(family, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create family.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
