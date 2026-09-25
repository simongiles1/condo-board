export const runtime = "nodejs";

import { joinLiveRoom } from "@/lib/meeting-v2/live-room";
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
    const joined = await joinLiveRoom(id, participant);
    return liveRoomJson(
      {
        token: joined.token,
        serverUrl: joined.serverUrl,
        identity: participant.identity,
        displayName: participant.displayName,
        snapshot: joined.snapshot,
      },
      cookieToSet,
    );
  } catch (error) {
    return liveRoomErrorResponse(error);
  }
}
