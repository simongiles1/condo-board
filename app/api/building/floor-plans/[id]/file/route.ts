export const runtime = "nodejs";

import { readFile } from "fs/promises";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { getFloorPlanFile } from "@/lib/building/floor-plans";
import { parseFloorPlanFileKind } from "@/lib/building/floor-plan-shared";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  const { id } = await context.params;
  const kind = parseFloorPlanFileKind(
    new URL(request.url).searchParams.get("kind"),
  );
  try {
    const file = await getFloorPlanFile(id, kind);
    const bytes = await readFile(file.path);
    const filename = file.filename.replace(/[\r\n"]/g, "");
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load PDF.";
    const status = /not found|not ready/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
