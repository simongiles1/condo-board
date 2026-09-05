import { mkdir, writeFile } from "fs/promises";
import path from "path";

import {
  getRemoteSourcePullConfig,
  isRemoteSourcePullEnabled,
} from "@/lib/dev/remote-source-pull";
import {
  listMeetingSourceFileTargets,
  type MeetingSourceFileKind,
  type MeetingSourceFileTarget,
} from "@/lib/meeting-v2/meeting-source-files";

export type PullMeetingSourcesResult = {
  pulled: Array<{
    kind: MeetingSourceFileKind;
    relativePath: string;
    sizeBytes: number;
  }>;
  skipped: Array<{
    kind: MeetingSourceFileKind;
    reason: string;
  }>;
  errors: Array<{
    kind: MeetingSourceFileKind;
    error: string;
  }>;
};

async function fetchRemoteSourceFile(
  productionUrl: string,
  token: string,
  meetingId: string,
  kind: MeetingSourceFileKind,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const url = `${productionUrl}/api/internal/meetings/${meetingId}/source-files/${kind}`;
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network error";
    return { ok: false, error: `Could not reach production (${detail}).` };
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    const detail = payload?.error ?? `HTTP ${response.status}`;
    if (response.status === 401) {
      return {
        ok: false,
        error:
          "Production rejected the pull token. Set the same FILE_PULL_TOKEN in Coolify and redeploy the app with the internal source-files API.",
      };
    }
    return { ok: false, error: detail };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    return { ok: false, error: "Production returned an empty file." };
  }

  return { ok: true, buffer: bytes };
}

async function writeLocalSourceFile(
  target: MeetingSourceFileTarget,
  buffer: Buffer,
): Promise<void> {
  const absolute = path.resolve(process.cwd(), target.relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer);
}

export async function pullMeetingSourcesFromProduction(
  meetingId: string,
  options?: { kinds?: MeetingSourceFileKind[] },
): Promise<
  | { ok: true; result: PullMeetingSourcesResult }
  | { ok: false; status: number; error: string }
> {
  if (!isRemoteSourcePullEnabled()) {
    return {
      ok: false,
      status: 400,
      error:
        "Remote source pull is not configured. Set PRODUCTION_APP_URL and FILE_PULL_TOKEN in .env.local (development only).",
    };
  }

  const { productionUrl, token } = getRemoteSourcePullConfig();
  if (!productionUrl || !token) {
    return {
      ok: false,
      status: 400,
      error: "Remote source pull is missing PRODUCTION_APP_URL or FILE_PULL_TOKEN.",
    };
  }

  const listed = await listMeetingSourceFileTargets(meetingId);
  if (!listed.ok) {
    return listed;
  }

  const requestedKinds = options?.kinds ? new Set(options.kinds) : null;
  const targets = listed.targets.filter((target) =>
    requestedKinds ? requestedKinds.has(target.kind) : true,
  );

  const result: PullMeetingSourcesResult = {
    pulled: [],
    skipped: [],
    errors: [],
  };

  for (const target of targets) {
    if (target.existsLocally) {
      result.skipped.push({
        kind: target.kind,
        reason: "Already on disk.",
      });
      continue;
    }

    const remote = await fetchRemoteSourceFile(
      productionUrl,
      token,
      meetingId,
      target.kind,
    );
    if (!remote.ok) {
      result.errors.push({
        kind: target.kind,
        error: remote.error,
      });
      continue;
    }

    try {
      await writeLocalSourceFile(target, remote.buffer);
      result.pulled.push({
        kind: target.kind,
        relativePath: target.relativePath,
        sizeBytes: remote.buffer.byteLength,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "write failed";
      result.errors.push({
        kind: target.kind,
        error: detail,
      });
    }
  }

  if (
    result.pulled.length === 0 &&
    result.errors.length > 0 &&
    result.skipped.length === 0
  ) {
    return {
      ok: false,
      status: 502,
      error: result.errors.map((entry) => `${entry.kind}: ${entry.error}`).join(" "),
    };
  }

  return { ok: true, result };
}
