import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { reevaluateAgendaItem, runMeetingV2Pipeline } from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [runMeetingV2Pipeline, reevaluateAgendaItem],
});
