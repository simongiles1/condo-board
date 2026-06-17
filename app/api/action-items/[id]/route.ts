export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { actionItems, extractedActionItems } from "@/lib/db/schema";

type Payload = {
  completed?: boolean;
};

function parseActionItemRouteId(raw: string): {
  source: "meeting" | "email";
  id: string;
} {
  if (raw.startsWith("email-")) {
    return { source: "email", id: raw.slice("email-".length) };
  }
  if (raw.startsWith("meeting-")) {
    return { source: "meeting", id: raw.slice("meeting-".length) };
  }
  return { source: "meeting", id: raw };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const { source, id } = parseActionItemRouteId(rawId);
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

    const completedAt = completed ? new Date().toISOString() : null;

    if (source === "email") {
      const [updated] = await db
        .update(extractedActionItems)
        .set({ completed, completedAt })
        .where(eq(extractedActionItems.id, id))
        .returning();

      if (!updated) {
        return NextResponse.json({ error: "Action item not found" }, {
          status: 404,
        });
      }

      return NextResponse.json(updated);
    }

    const [updated] = await db
      .update(actionItems)
      .set({ completed, completedAt })
      .where(eq(actionItems.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Action item not found" }, {
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
