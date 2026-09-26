export const runtime = "nodejs";

import { claimLivePresenter, releaseLivePresenter } from "@/lib/meeting-v2/live-room";
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

  let body: { action?: unknown };
  try {
    body = (await req.json()) as { action?: unknown };
  } catch {
    return liveRoomJson({ error: "Malformed JSON body." }, null, 400);
  }

  if (body.action !== "claim" && body.action !== "release") {
    return liveRoomJson({ error: "action must be claim or release." }, null, 400);
  }

  try {
    const { participant, cookieToSet } = await resolveLiveParticipant();
    const snapshot =
      body.action === "claim"
        ? await claimLivePresenter(id, participant)
        : await releaseLivePresenter(id, participant);
    return liveRoomJson(snapshot, cookieToSet);
  } catch (error) {
    return liveRoomErrorResponse(error);
  }
}
