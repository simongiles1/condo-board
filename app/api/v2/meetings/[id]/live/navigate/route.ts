export const runtime = "nodejs";

import { recordLiveNavigation } from "@/lib/meeting-v2/live-room";
import {
  liveRoomErrorResponse,
  liveRoomJson,
  resolveLiveParticipant,
} from "@/lib/meeting-v2/live-participant";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let body: { agendaItemId?: unknown };
  try {
    body = (await req.json()) as { agendaItemId?: unknown };
  } catch {
    return liveRoomJson({ error: "Malformed JSON body." }, null, 400);
  }

  const agendaItemId = typeof body.agendaItemId === "string" ? body.agendaItemId.trim() : "";
  if (!agendaItemId) {
    return liveRoomJson({ error: "agendaItemId is required." }, null, 400);
  }

  try {
    const { participant, cookieToSet } = await resolveLiveParticipant();
    const snapshot = await recordLiveNavigation(id, agendaItemId, participant);
    return liveRoomJson(snapshot, cookieToSet);
  } catch (error) {
    return liveRoomErrorResponse(error);
  }
}
