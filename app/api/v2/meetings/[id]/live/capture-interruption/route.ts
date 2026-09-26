export const runtime = "nodejs";

import { recordCaptureInterruption } from "@/lib/meeting-v2/live-room";
import {
  liveRoomErrorResponse,
  liveRoomJson,
  resolveLiveParticipant,
} from "@/lib/meeting-v2/live-participant";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const { participant, cookieToSet } = await resolveLiveParticipant();
    const snapshot = await recordCaptureInterruption(id, participant);
    return liveRoomJson(snapshot, cookieToSet);
  } catch (error) {
    return liveRoomErrorResponse(error);
  }
}
