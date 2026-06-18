export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Suspense } from "react";

import { CalendarPageClient } from "@/components/CalendarPageClient";
import { loadCalendarEvents } from "@/lib/calendar/events";

export default async function CalendarPage() {
  const events = await loadCalendarEvents();

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Suspense
        fallback={
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <div className="h-7 shrink-0 animate-pulse rounded-xl bg-slate-100" />
            <div className="min-h-0 flex-1 animate-pulse rounded-xl bg-slate-100" />
          </div>
        }
      >
        <CalendarPageClient events={events} />
      </Suspense>
    </section>
  );
}
