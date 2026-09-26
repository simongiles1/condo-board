export const runtime = "nodejs";

import { presentLivePage } from "@/lib/meeting-v2/live-room";
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

  let body: { page?: unknown };
  try {
    body = (await req.json()) as { page?: unknown };
  } catch {
    return liveRoomJson({ error: "Malformed JSON body." }, null, 400);
  }

  const page = body.page === null ? null : body.page;
  if (page !== null && (typeof page !== "number" || !Number.isInteger(page))) {
    return liveRoomJson({ error: "page must be a whole number or null." }, null, 400);
  }

  try {
    const { participant, cookieToSet } = await resolveLiveParticipant();
    const snapshot = await presentLivePage(id, participant, page);
    return liveRoomJson(snapshot, cookieToSet);
  } catch (error) {
    return liveRoomErrorResponse(error);
  }
}
