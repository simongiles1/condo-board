import { NextResponse } from "next/server";

import type { MeetingV2Detail } from "@/lib/meeting-v2/service";
import { loadMeetingV2Detail } from "@/lib/meeting-v2/service";

const STATUS_CACHE_TTL_MS = 3_000;

type StatusCacheEntry = {
  expiresAt: number;
  promise?: Promise<MeetingV2Detail>;
  data?: MeetingV2Detail;
};

const statusCache = new Map<string, StatusCacheEntry>();

async function loadMeetingV2Status(id: string): Promise<MeetingV2Detail> {
  const now = Date.now();
  const cached = statusCache.get(id);
  if (cached?.data && cached.expiresAt > now) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const promise = loadMeetingV2Detail(id);
  statusCache.set(id, { expiresAt: now + STATUS_CACHE_TTL_MS, promise });

  try {
    const detail = await promise;
    statusCache.set(id, {
      expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
      data: detail,
    });
    return detail;
  } catch (error) {
    statusCache.delete(id);
    throw error;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const detail = await loadMeetingV2Status(id);
    return NextResponse.json(detail);
  } catch (err) {
    console.error("[meetings/v2/status] Failed:", err);
    return NextResponse.json({ error: "Failed to fetch status" }, { status: 500 });
  }
}
