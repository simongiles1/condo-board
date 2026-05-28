export const runtime = "nodejs";

import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { globalTodos } from "@/lib/db/schema";
import { fetchGlobalTodoRows } from "@/lib/todos/global-todos";

export async function GET() {
  const items = await fetchGlobalTodoRows();
  return NextResponse.json({ items });
}

type PostBody = {
  assignee?: string;
  role?: string;
  description?: string;
  deadline?: string | null;
};

export async function POST(request: Request) {
  let body: PostBody;

  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload" }, { status: 400 });
  }

  const assignee = typeof body.assignee === "string" ? body.assignee.trim() : "";
  const role =
    typeof body.role === "string" && body.role.trim()
      ? body.role.trim()
      : "Board member";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const deadline =
    typeof body.deadline === "string" && body.deadline.trim()
      ? body.deadline.trim()
      : null;

  if (!assignee) {
    return NextResponse.json({ error: "assignee is required" }, { status: 400 });
  }
  if (!description) {
    return NextResponse.json(
      { error: "description is required" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const id = randomUUID();

  const db = getDb();

  const [created] = await db
    .insert(globalTodos)
    .values({
      id,
      assignee,
      role,
      description,
      deadline,
      completed: false,
      completedAt: null,
      sourceMeetingId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
