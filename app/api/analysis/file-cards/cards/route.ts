export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  listFileCards,
  updateFileCardRating,
} from "@/lib/rag/file-card-runs";

export async function GET(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId") || undefined;
    const ratingRaw = searchParams.get("rating");
    const rating = ratingRaw === "up" || ratingRaw === "down" ? ratingRaw : undefined;
    const limitRaw = Number(searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

    const cards = await listFileCards({ runId, rating, limit });
    return NextResponse.json({ cards });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not list file cards.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = await request.json();
    const contentHash = typeof body.contentHash === "string" ? body.contentHash.trim() : "";
    if (!contentHash) {
      return NextResponse.json({ error: "contentHash is required" }, { status: 400 });
    }

    const rating =
      body.rating === "up" || body.rating === "down" || body.rating === null
        ? body.rating
        : undefined;

    const notes = typeof body.notes === "string" || body.notes === null ? body.notes : undefined;

    await updateFileCardRating({ contentHash, rating, notes });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not update file card rating.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
