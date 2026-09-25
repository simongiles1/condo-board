import { randomUUID } from "crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSessionUser, type AppUser } from "@/lib/auth/session";
import { LiveRoomError, type LiveParticipant } from "@/lib/meeting-v2/live-room";

/** Browser identity used when auth is off, so a refresh rejoins as the same participant. */
export const LIVE_PARTICIPANT_COOKIE = "condo_board_live_participant";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Logged-in user, or a stable browser id when auth is disabled.
 */
export async function resolveLiveParticipant(): Promise<{
  participant: LiveParticipant;
  cookieToSet: string | null;
}> {
  const user = await getSessionUser();
  if (user) {
    return { participant: participantFromUser(user), cookieToSet: null };
  }

  const cookieStore = await cookies();
  const existing = cookieStore.get(LIVE_PARTICIPANT_COOKIE)?.value ?? "";
  if (UUID_RE.test(existing)) {
    return {
      participant: {
        identity: existing,
        displayName: "Local participant",
        userId: null,
      },
      cookieToSet: null,
    };
  }

  const identity = randomUUID();
  return {
    participant: {
      identity,
      displayName: "Local participant",
      userId: null,
    },
    cookieToSet: identity,
  };
}

/**
 * JSON response for a live-room route, attaching a new browser identity when needed.
 */
export function liveRoomJson(
  body: unknown,
  cookieToSet: string | null,
  status = 200,
): NextResponse {
  const response = NextResponse.json(body, { status });
  if (cookieToSet) {
    response.cookies.set(LIVE_PARTICIPANT_COOKIE, cookieToSet, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}

/**
 * Maps a live-room failure to an HTTP response without leaking credentials.
 */
export function liveRoomErrorResponse(error: unknown): NextResponse {
  if (error instanceof LiveRoomError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[meetings/v2/live]", error);
  return NextResponse.json({ error: "Could not open the live room." }, { status: 500 });
}

function participantFromUser(user: AppUser): LiveParticipant {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return {
    identity: user.id,
    displayName: name || user.email,
    userId: user.id,
  };
}
