export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  loadEquipmentRegistry,
  manualMergeEquipment,
} from "@/lib/equipment/registry";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const url = new URL(request.url);
  const limit = Math.min(
    2000,
    Math.max(1, Number(url.searchParams.get("limit") ?? 500) || 500),
  );

  try {
    const { equipment, stats } = await loadEquipmentRegistry({ limit });
    return NextResponse.json({ equipment, stats });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load equipment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  let body: {
    action?: string;
    sourceEquipmentId?: string;
    targetEquipmentId?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action !== "merge") {
    return NextResponse.json(
      { error: "Unsupported action. Use action: \"merge\"." },
      { status: 400 },
    );
  }

  const result = await manualMergeEquipment({
    sourceId: body.sourceEquipmentId ?? "",
    targetId: body.targetEquipmentId ?? "",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, survivorId: result.survivorId });
}
