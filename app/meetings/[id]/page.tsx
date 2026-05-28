import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import MeetingEditorClient from "./MeetingEditorClient";
import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MeetingDetailPage(props: PageProps) {
  const { id } = await props.params;
  const db = getDb();

  const [record] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, id));

  if (!record) {
    notFound();
  }

  return <MeetingEditorClient meeting={record} />;
}
