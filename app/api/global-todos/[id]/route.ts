export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { globalTodos } from "@/lib/db/schema";

type Payload = {
  completed?: boolean;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = getDb();

  try {
    const body = (await request.json()) as Payload;

    const completed =
      typeof body.completed === "boolean" ? body.completed : undefined;

    if (completed === undefined) {
      return NextResponse.json({ error: "completed boolean expected" }, {
        status: 400,
      });
    }

    const [updated] = await db
      .update(globalTodos)
      .set({
        completed,
        completedAt: completed ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(globalTodos.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Global todo not found" }, {
        status: 404,
      });
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload" }, {
      status: 400,
    });
  }
}
