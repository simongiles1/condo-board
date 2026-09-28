export const runtime = "nodejs";

import { decideLiveRecognitionCorrection } from "@/lib/meeting-v2/live-room";
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
  let body: { correctionId?: unknown; status?: unknown };
  try {
    body = (await req.json()) as { correctionId?: unknown; status?: unknown };
  } catch {
    return liveRoomJson({ error: "Malformed JSON body." }, null, 400);
  }
  if (typeof body.correctionId !== "string" || !body.correctionId.trim()) {
    return liveRoomJson({ error: "correctionId is required." }, null, 400);
  }
  if (body.status !== "accepted" && body.status !== "rejected") {
    return liveRoomJson({ error: "status must be accepted or rejected." }, null, 400);
  }
  try {
    const { participant, cookieToSet } = await resolveLiveParticipant();
    const correction = await decideLiveRecognitionCorrection(
      id,
      body.correctionId.trim(),
      participant,
      body.status,
    );
    return liveRoomJson({ correction }, cookieToSet);
  } catch (error) {
    return liveRoomErrorResponse(error);
  }
}
