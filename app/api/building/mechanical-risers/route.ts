export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  ensureMechanicalRiser,
  reclassifyMechanicalRisers,
  updateMechanicalRiser,
} from "@/lib/building/floor-plans";

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  try {
    const body = (await request.json()) as {
      typeId?: unknown;
      label?: unknown;
      number?: unknown;
    };
    if (typeof body.typeId !== "string") {
      return NextResponse.json(
        { error: "typeId is required." },
        { status: 400 },
      );
    }
    const result = await ensureMechanicalRiser(body.typeId, body.label ?? body.number);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save riser.";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

function parseRiserIds(body: { id?: unknown; ids?: unknown }): string[] {
  if (Array.isArray(body.ids)) {
    return body.ids.filter((id): id is string => typeof id === "string");
  }
  if (typeof body.id === "string") return [body.id];
  return [];
}

export async function PATCH(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  try {
    const body = (await request.json()) as {
      id?: unknown;
      ids?: unknown;
      typeId?: unknown;
      completed?: unknown;
    };
    const ids = parseRiserIds(body);
    if (ids.length === 0) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }
    if (typeof body.typeId === "string") {
      const result = await reclassifyMechanicalRisers(ids, body.typeId);
      return NextResponse.json(result);
    }
    if (typeof body.completed === "boolean") {
      if (ids.length !== 1 || typeof body.id !== "string") {
        return NextResponse.json(
          { error: "completed updates one riser id." },
          { status: 400 },
        );
      }
      const result = await updateMechanicalRiser(body.id, {
        completed: body.completed,
      });
      return NextResponse.json(result);
    }
    return NextResponse.json(
      { error: "typeId or completed is required." },
      { status: 400 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not update riser.";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
