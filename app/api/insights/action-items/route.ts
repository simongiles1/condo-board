export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { actionItems, extractedActionItems, meetings } from "@/lib/db/schema";

export async function GET() {
  const db = getDb();

  const meetingItems = await db
    .select({
      id: actionItems.id,
      assignee: actionItems.assignee,
      description: actionItems.description,
      deadline: actionItems.deadline,
      completed: actionItems.completed,
      meetingTitle: meetings.title,
      meetingDate: meetings.meetingDate,
    })
    .from(actionItems)
    .innerJoin(meetings, eq(actionItems.meetingId, meetings.id))
    .where(eq(actionItems.completed, false));

  const emailItems = await db
    .select()
    .from(extractedActionItems)
    .where(eq(extractedActionItems.completed, false));

  return NextResponse.json({
    items: [
      ...meetingItems.map((item) => ({
        id: item.id,
        source: "meeting" as const,
        assignee: item.assignee,
        description: item.description,
        deadline: item.deadline,
        completed: item.completed,
        context: item.meetingTitle,
        contextDate: item.meetingDate,
      })),
      ...emailItems.map((item) => ({
        id: item.id,
        source: "email" as const,
        assignee: item.assignee,
        description: item.description,
        deadline: item.deadline,
        completed: item.completed,
        context: "Email extraction",
        contextDate: item.createdAt,
      })),
    ],
  });
}
