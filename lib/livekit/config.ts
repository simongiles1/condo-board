import { AutoTrackEgress, RoomEgress, S3Upload } from "livekit-server-sdk";

export type LiveKitConfig = {
  url: string;
  httpHost: string;
  apiKey: string;
  apiSecret: string;
};

export type LiveKitS3Egress = {
  accessKey: string;
  secret: string;
  region: string;
  bucket: string;
  endpoint: string;
};

/**
 * LiveKit Cloud credentials from the environment, or null when any required value is missing.
 */
export function readLiveKitConfig(): LiveKitConfig | null {
  const url = process.env.LIVEKIT_URL?.trim() ?? "";
  const apiKey = process.env.LIVEKIT_API_KEY?.trim() ?? "";
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim() ?? "";
  if (!url || !apiKey || !apiSecret) return null;

  let httpHost: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "wss:") parsed.protocol = "https:";
    else if (parsed.protocol === "ws:") parsed.protocol = "http:";
    else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    httpHost = parsed.origin;
  } catch {
    return null;
  }

  return { url, httpHost, apiKey, apiSecret };
}

/**
 * S3 destination for track egress. LiveKit Cloud rejects a recording that has no bucket.
 */
export function readLiveKitS3Egress(): LiveKitS3Egress | null {
  const bucket = process.env.LIVEKIT_EGRESS_S3_BUCKET?.trim() ?? "";
  if (!bucket) return null;
  const accessKey = process.env.LIVEKIT_EGRESS_S3_ACCESS_KEY?.trim() ?? "";
  const secret = process.env.LIVEKIT_EGRESS_S3_SECRET?.trim() ?? "";
  if (!accessKey || !secret) return null;
  return {
    accessKey,
    secret,
    bucket,
    region: process.env.LIVEKIT_EGRESS_S3_REGION?.trim() || "us-east-1",
    endpoint: process.env.LIVEKIT_EGRESS_S3_ENDPOINT?.trim() ?? "",
  };
}

/**
 * Auto track egress for a room, or null when no bucket is configured.
 * A filepath alone is not an output, and Cloud rejects the room with "egress request missing output".
 */
export function liveKitTrackEgress(): RoomEgress | null {
  const s3 = readLiveKitS3Egress();
  if (!s3) return null;
  const tracks = new AutoTrackEgress({
    filepath: "meetings/{room_name}/{publisher_identity}-{track_source}-{track_id}",
  });
  tracks.output = {
    case: "s3",
    value: new S3Upload({
      accessKey: s3.accessKey,
      secret: s3.secret,
      bucket: s3.bucket,
      region: s3.region,
      endpoint: s3.endpoint,
    }),
  };
  return new RoomEgress({ tracks });
}
