export const runtime = "nodejs";

import { getLiveRoomSnapshot } from "@/lib/meeting-v2/live-room";
import {
  liveRoomErrorResponse,
  liveRoomJson,
} from "@/lib/meeting-v2/live-participant";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const snapshot = await getLiveRoomSnapshot(id);
    return liveRoomJson(snapshot, null);
  } catch (error) {
    return liveRoomErrorResponse(error);
  }
}
