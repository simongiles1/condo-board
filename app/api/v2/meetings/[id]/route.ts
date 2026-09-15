export const runtime = "nodejs";

import { rm } from "fs/promises";
import path from "path";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { meetings, meetingsV2 } from "@/lib/db/schema";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let body: { title?: unknown };
  try {
    body = (await req.json()) as { title?: unknown };
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }

  try {
    const db = getDb();
    const updatedAt = new Date().toISOString();

    const [existingV2] = await db
      .select({ id: meetingsV2.id })
      .from(meetingsV2)
      .where(eq(meetingsV2.id, id));

    const [existingLegacy] = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(eq(meetings.id, id));

    if (!existingV2 && !existingLegacy) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    if (existingV2) {
      await db
        .update(meetingsV2)
        .set({ title, updatedAt })
        .where(eq(meetingsV2.id, id));
    }

    if (existingLegacy) {
      await db.update(meetings).set({ title }).where(eq(meetings.id, id));
    }

    return NextResponse.json({ ok: true, title });
  } catch (error) {
    console.error("[meetings/v2:patch]", error);
    return NextResponse.json(
      { error: "Could not rename meeting workspace." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const db = getDb();

    const [existingV2] = await db
      .select({ id: meetingsV2.id })
      .from(meetingsV2)
      .where(eq(meetingsV2.id, id));

    const [existingLegacy] = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(eq(meetings.id, id));

    if (!existingV2 && !existingLegacy) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    if (existingV2) {
      await db.delete(meetingsV2).where(eq(meetingsV2.id, id));
    }

    if (existingLegacy) {
      await db.delete(meetings).where(eq(meetings.id, id));
    }

    const uploadRoot = path.join(process.cwd(), "uploads", id);
    try {
      await rm(uploadRoot, { recursive: true, force: true });
    } catch (fsError) {
      console.warn("[meetings/v2:delete] upload cleanup", fsError);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[meetings/v2:delete]", error);
    return NextResponse.json(
      { error: "Could not delete meeting workspace." },
      { status: 500 },
    );
  }
}
