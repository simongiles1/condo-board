import { NextResponse } from "next/server";

import {
  createItemDebugRun,
  listItemDebugWorkspace,
} from "@/lib/meeting-v2/item-debug";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await params;
    const workspace = await listItemDebugWorkspace(id, itemId);
    return NextResponse.json(workspace, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[v2/item-debug GET]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load item debug workspace" },
      { status: 500 },
    );
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await params;
    const run = await createItemDebugRun(id, itemId);
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    console.error("[v2/item-debug POST]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create debug run" },
      { status: 500 },
    );
  }
}
