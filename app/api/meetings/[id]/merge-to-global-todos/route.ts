export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import { generateGlobalTodosMerge } from "@/lib/gemini/client";
import { parseGlobalTodosMergeResponse } from "@/lib/gemini/parse-output";
import { GLOBAL_TODOS_MERGE_SYSTEM_PROMPT } from "@/lib/gemini/prompts";
import { omissionsModelOverridesFromBody } from "@/lib/settings/model-settings";
import {
  buildGlobalTodosMergePrompt,
  fetchGlobalTodoRows,
  globalTodosToMarkdown,
  persistGlobalTodosMerge,
} from "@/lib/todos/global-todos";
import { markMeetingTodosMerged } from "@/lib/todos/mark-merged";
import { parseTodosMarkdown } from "@/lib/todos-parser";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const { modelTodos } = omissionsModelOverridesFromBody(body);

  try {
    const db = getDb();

    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, id));

    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    const todosMarkdown =
      typeof body.todosContent === "string" && body.todosContent.trim()
        ? body.todosContent.trim()
        : meeting.todosContent;

    const meetingTodos = parseTodosMarkdown(todosMarkdown);
    if (!meetingTodos.length) {
      return NextResponse.json(
        { error: "Meeting has no todo items to merge." },
        { status: 400 },
      );
    }

    const existing = await fetchGlobalTodoRows();
    const globalMarkdown = globalTodosToMarkdown(existing);

    const userText = buildGlobalTodosMergePrompt({
      globalMarkdown,
      meetingTitle: meeting.title,
      meetingDate: meeting.meetingDate,
      meetingTodosMarkdown: todosMarkdown,
    });

    const generation = await generateGlobalTodosMerge({
      systemInstruction: GLOBAL_TODOS_MERGE_SYSTEM_PROMPT,
      userText,
      modelName: modelTodos,
    });

    const parsed = parseGlobalTodosMergeResponse(generation.text);

    if (!parsed.result) {
      return NextResponse.json(
        {
          error: "AI merge failed validation.",
          details: parsed.errors,
          warnings: parsed.warnings,
        },
        { status: 422 },
      );
    }

    const { count } = await persistGlobalTodosMerge({
      existing,
      merged: parsed.result.todos,
      sourceMeetingId: meeting.id,
    });

    const mergedAt = new Date().toISOString();
    const markedTodosContent = markMeetingTodosMerged(todosMarkdown);

    await db
      .update(meetings)
      .set({
        todosContent: markedTodosContent,
        globalTodosMergedAt: mergedAt,
      })
      .where(eq(meetings.id, id));

    return NextResponse.json({
      ok: true,
      count,
      todosContent: markedTodosContent,
      globalTodosMergedAt: mergedAt,
      changes: parsed.result.changes_summary,
      warnings: parsed.warnings,
      modelName: generation.modelName,
      usage: generation.usage,
    });
  } catch (error) {
    console.error("[meetings:merge-to-global-todos]", error);
    const message =
      error instanceof Error ? error.message : "Could not merge todos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
