export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  getThreadProcessedDataSummary,
  purgeThreadProcessedData,
} from "@/lib/analysis/purge-thread-processed-data";
import {
  THREAD_PROCESSED_DATA_CATEGORIES,
  type ThreadProcessedDataCategory,
} from "@/lib/analysis/thread-processed-data-categories";
import { getDb } from "@/lib/db";
import { emailThreads } from "@/lib/db/schema";

function parseCategories(value: unknown): ThreadProcessedDataCategory[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ThreadProcessedDataCategory =>
      typeof entry === "string" &&
      (THREAD_PROCESSED_DATA_CATEGORIES as readonly string[]).includes(entry),
  );
}

async function assertThreadExists(threadId: string) {
  const db = getDb();
  const [thread] = await db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(eq(emailThreads.id, threadId));
  return thread;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const thread = await assertThreadExists(id);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }

    const summary = await getThreadProcessedDataSummary(id);
    return NextResponse.json({ threadId: id, ...summary });
  } catch (error) {
    console.error("[email:threads:processed-data:get]", error);
    return NextResponse.json(
      { error: "Could not load thread processed data summary." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const thread = await assertThreadExists(id);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }

    const body = (await req.json()) as { categories?: unknown };
    const categories = parseCategories(body.categories);

    if (categories.length === 0) {
      return NextResponse.json(
        { error: "Select at least one extraction category to delete." },
        { status: 400 },
      );
    }

    const summary = await getThreadProcessedDataSummary(id);
    const result = await purgeThreadProcessedData({
      threadId: id,
      categories,
      categoriesWithData: summary.categoriesWithData,
    });

    return NextResponse.json({ ok: true, threadId: id, ...result });
  } catch (error) {
    console.error("[email:threads:processed-data:delete]", error);
    const message =
      error instanceof Error
        ? error.message
        : "Could not delete thread processed data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
