export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import path from "path";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { actionItems, meetings } from "@/lib/db/schema";
import { parseTodosMarkdown } from "@/lib/todos-parser";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const db = getDb();

    const [existing] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, id));

    if (!existing) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    await db.delete(meetings).where(eq(meetings.id, id));

    const uploadRoot = path.join(process.cwd(), "uploads", id);
    try {
      await rm(uploadRoot, { recursive: true, force: true });
    } catch (fsError) {
      console.warn("[meetings:delete] upload cleanup", fsError);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[meetings:delete]", error);
    return NextResponse.json(
      { error: "Could not delete meeting workspace." },
      { status: 500 },
    );
  }
}

type PatchBody = {
  minutesContent?: string;
  todosContent?: string;
  /** When omitted, existing structured JSON is preserved. */
  minutesJson?: string | null;
  status?: "draft" | "finalized";
};

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let body: PatchBody;

  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, {
      status: 400,
    });
  }

  const minutesContent = typeof body.minutesContent === "string"
    ? body.minutesContent
    : "";

  const todosContent = typeof body.todosContent === "string"
    ? body.todosContent
    : "";

  if (!minutesContent.trim() || !todosContent.trim()) {
    return NextResponse.json(
      { error: "minutesContent and todosContent must include text." },
      { status: 400 },
    );
  }

  const status =
    body.status === "draft" || body.status === "finalized"
      ? body.status
      : undefined;

  if (!status) {
    return NextResponse.json(
      { error: "status draft|finalized is required" },
      { status: 400 },
    );
  }

  try {
    const db = getDb();

    const [existing] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, id));

    if (!existing) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    if (existing.status === "finalized") {
      return NextResponse.json(
        { error: "Finalized meetings are locked for edits via API." },
        { status: 409 },
      );
    }

    if (status === "draft") {
      const draftUpdate: {
        minutesContent: string;
        todosContent: string;
        status: "draft";
        minutesJson?: string | null;
      } = {
        minutesContent,
        todosContent,
        status: "draft",
      };
      if (body.minutesJson !== undefined) {
        draftUpdate.minutesJson = body.minutesJson;
      }

      const [saved] = await db
        .update(meetings)
        .set(draftUpdate)
        .where(eq(meetings.id, id))
        .returning();

      return NextResponse.json(saved);
    }

    const todos = parseTodosMarkdown(todosContent).map((row) => ({
      id: randomUUID(),
      meetingId: id,
      assignee: row.assignee,
      role: row.role,
      description: row.description,
      deadline: row.deadline ?? null,
      completed: false,
      completedAt: null,
    }));

    const finalizedAt = new Date().toISOString();

    const finalizedUpdate: {
      minutesContent: string;
      todosContent: string;
      status: "finalized";
      finalizedAt: string;
      minutesJson?: string | null;
    } = {
      minutesContent,
      todosContent,
      status: "finalized",
      finalizedAt,
    };
    if (body.minutesJson !== undefined) {
      finalizedUpdate.minutesJson = body.minutesJson;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(meetings)
        .set(finalizedUpdate)
        .where(eq(meetings.id, id));

      await tx.delete(actionItems).where(eq(actionItems.meetingId, id));

      if (todos.length) {
        await tx.insert(actionItems).values(todos);
      }
    });

    const [saved] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, id));

    return NextResponse.json(saved ?? null);
  } catch (error) {
    console.error("[meetings:patch]", error);
    return NextResponse.json(
      { error: "Could not persist meeting workspace." },
      { status: 500 },
    );
  }
}
