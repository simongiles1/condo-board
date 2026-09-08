export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  parseEntityListLimit,
  parseEntityListOffset,
} from "@/lib/entities/registry-page";
import { harvestEquipmentMentions } from "@/lib/equipment/equipment-harvest-worker";
import {
  loadEquipmentRegistry,
  manualMergeEquipment,
} from "@/lib/equipment/registry";
import { seedBuildingEquipmentRegistry } from "@/lib/equipment/seed-registry";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const url = new URL(request.url);
  const limit = parseEntityListLimit(url.searchParams.get("limit"));
  const offset = parseEntityListOffset(url.searchParams.get("offset"));

  try {
    const { equipment, stats } = await loadEquipmentRegistry({
      limit,
      offset,
    });
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
    limit?: number;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action === "seed_canonical") {
    try {
      const result = await seedBuildingEquipmentRegistry();
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load canonical equipment register.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (body.action === "harvest_mentions") {
    try {
      const result = await harvestEquipmentMentions({
        limit: body.limit ?? 10_000,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not harvest equipment mentions.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (body.action !== "merge") {
    return NextResponse.json(
      {
        error:
          'Unsupported action. Use action: "merge", "seed_canonical", or "harvest_mentions".',
      },
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
