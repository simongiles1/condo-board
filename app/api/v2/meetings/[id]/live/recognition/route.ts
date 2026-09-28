export const runtime = "nodejs";

import { listLiveRecognitionCues, LiveRoomError, recordLiveRecognitionCue } from "@/lib/meeting-v2/live-room";
import {
  liveRoomErrorResponse,
  liveRoomJson,
  resolveLiveParticipant,
} from "@/lib/meeting-v2/live-participant";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const cues = await listLiveRecognitionCues(id);
    return liveRoomJson({ cues }, null);
  } catch (error) {
    if (error instanceof LiveRoomError && error.status === 409) {
      return liveRoomJson({ cues: [] }, null);
    }
    return liveRoomErrorResponse(error);
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: { text?: unknown; durationMs?: unknown };
  try {
    body = (await req.json()) as { text?: unknown; durationMs?: unknown };
  } catch {
    return liveRoomJson({ error: "Malformed JSON body." }, null, 400);
  }
  if (typeof body.text !== "string") {
    return liveRoomJson({ error: "text is required." }, null, 400);
  }
  const durationMs = typeof body.durationMs === "number" ? body.durationMs : 1500;
  try {
    const { participant, cookieToSet } = await resolveLiveParticipant();
    const cue = await recordLiveRecognitionCue(id, participant, {
      text: body.text,
      durationMs,
    });
    return liveRoomJson({ cue }, cookieToSet);
  } catch (error) {
    return liveRoomErrorResponse(error);
  }
}
