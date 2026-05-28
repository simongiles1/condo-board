export const runtime = "nodejs";

import { NotesPageClient } from "./NotesPageClient";
import { fetchDevNotes } from "@/lib/notes/fetch-notes";

export default async function NotesPage() {
  const items = await fetchDevNotes();
  return <NotesPageClient items={items} />;
}
