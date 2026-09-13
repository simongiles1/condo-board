export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  ejectSeriesMember,
  getSeriesById,
  moveSeriesMember,
} from "@/lib/documents/series";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      contentHash?: string;
      seriesId?: string;
    };
    const contentHash = body.contentHash?.trim();
    if (!contentHash) {
      return NextResponse.json(
        { error: "contentHash is required." },
        { status: 400 },
      );
    }

    if (body.seriesId && body.seriesId !== id) {
      const target = await getSeriesById(body.seriesId);
      if (!target) {
        return NextResponse.json({ error: "Target series not found." }, { status: 404 });
      }
      await moveSeriesMember({ contentHash, seriesId: body.seriesId });
      return NextResponse.json({ ok: true, moved: true });
    }

    return NextResponse.json({ error: "seriesId is required to move a file." }, { status: 400 });
  } catch (error) {
    console.error("[documents:series:members:patch]", error);
    return NextResponse.json(
      { error: "Could not move that file." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  await context.params;
  try {
    const contentHash = new URL(request.url).searchParams.get("contentHash")?.trim();
    if (!contentHash) {
      return NextResponse.json(
        { error: "contentHash is required." },
        { status: 400 },
      );
    }
    await ejectSeriesMember(contentHash);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[documents:series:members:delete]", error);
    return NextResponse.json(
      { error: "Could not remove that file from the series." },
      { status: 500 },
    );
  }
}
