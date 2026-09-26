import { HeadObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { readLiveKitS3Egress } from "@/lib/livekit/config";
import { parseCaptureObjectLocation } from "@/lib/meeting-v2/capture-health";

const PLAY_URL_SECONDS = 900;

export type CaptureObjectCheck = {
  opened: boolean;
  detail: string;
};

/**
 * Opens the egress object with the configured storage credentials.
 * Success means the object exists and has a non-zero size.
 */
export async function headCaptureObject(location: string): Promise<CaptureObjectCheck> {
  const storage = readLiveKitS3Egress();
  if (!storage) {
    return { opened: false, detail: "Storage is not configured." };
  }
  const target = parseCaptureObjectLocation(location, storage.bucket);
  if (!target) {
    return { opened: false, detail: "The recording location could not be read." };
  }

  try {
    const client = captureS3Client();
    const head = await client.send(
      new HeadObjectCommand({ Bucket: target.bucket, Key: target.key }),
    );
    const size = head.ContentLength ?? 0;
    if (size <= 0) {
      return { opened: false, detail: "The recording object is empty." };
    }
    return { opened: true, detail: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The recording object could not be opened.";
    return { opened: false, detail: message };
  }
}

/**
 * Short-lived URL a person can open to play one stored track file.
 * Throws when storage is not configured or the location cannot be parsed.
 */
export async function presignCaptureObject(location: string): Promise<string> {
  const storage = readLiveKitS3Egress();
  if (!storage) {
    throw new Error("Storage is not configured.");
  }
  const target = parseCaptureObjectLocation(location, storage.bucket);
  if (!target) {
    throw new Error("The recording location could not be read.");
  }
  const client = captureS3Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: target.bucket, Key: target.key }),
    { expiresIn: PLAY_URL_SECONDS },
  );
}

function captureS3Client(): S3Client {
  const storage = readLiveKitS3Egress();
  if (!storage) {
    throw new Error("Storage is not configured.");
  }
  return new S3Client({
    region: storage.region,
    endpoint: storage.endpoint || undefined,
    forcePathStyle: Boolean(storage.endpoint),
    credentials: {
      accessKeyId: storage.accessKey,
      secretAccessKey: storage.secret,
    },
  });
}
