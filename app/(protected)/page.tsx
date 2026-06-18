export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { desc, eq } from "drizzle-orm";

import { ActionItemsList } from "@/components/ActionItemsList";
import { getDb } from "@/lib/db";
import { actionItems, extractedActionItems, meetings } from "@/lib/db/schema";

export default async function DashboardPage() {
  const db = getDb();

  const meetingBacklog = await db
    .select({
      id: actionItems.id,
      assignee: actionItems.assignee,
      role: actionItems.role,
      description: actionItems.description,
      deadline: actionItems.deadline,
      meetingTitle: meetings.title,
      meetingDate: meetings.meetingDate,
    })
    .from(actionItems)
    .innerJoin(meetings, eq(actionItems.meetingId, meetings.id))
    .where(eq(actionItems.completed, false))
    .orderBy(desc(meetings.meetingDate));

  const emailBacklog = await db
    .select()
    .from(extractedActionItems)
    .where(eq(extractedActionItems.completed, false));

  const backlog = [
    ...meetingBacklog.map((task) => ({
      id: `meeting-${task.id}`,
      assignee: task.assignee,
      role: task.role,
      description: task.description,
      deadline: task.deadline,
      meetingTitle: task.meetingTitle,
      meetingDate: task.meetingDate,
    })),
    ...emailBacklog.map((task) => ({
      id: `email-${task.id}`,
      assignee: task.assignee,
      role: "Email",
      description: task.description,
      deadline: task.deadline,
      meetingTitle: "Email extraction",
      meetingDate: task.createdAt.slice(0, 10),
    })),
  ];

  return (
    <section className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Task radar
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Unresolved checklist items ({backlog.length})
          </h1>
        </div>
      </div>
      <ActionItemsList items={backlog.map((task) => ({ ...task }))} />
    </section>
  );
}
