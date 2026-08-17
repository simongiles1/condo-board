export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  checkDoclingSidecarHealth,
  convertWithDoclingSidecar,
  listNonTextRoutePageNos,
  listTextRoutePageNos,
  readDoclingLabState,
} from "@/lib/email/docling-lab";

type RouteContext = {
  params: Promise<{ hash: string }>;
};

const HASH_RE = /^[a-f0-9]{64}$/i;

function parsePages(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const pages = raw
    .map((p) => (typeof p === "number" ? p : Number(p)))
    .filter((p) => Number.isInteger(p) && p >= 1);
  return pages.length > 0 ? pages : undefined;
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { hash } = await context.params;
    const contentHash = hash.trim().toLowerCase();
    if (!HASH_RE.test(contentHash)) {
      return NextResponse.json(
        { error: "Invalid content hash." },
        { status: 400 },
      );
    }

    const state = await readDoclingLabState(contentHash);
    if (!state) {
      return NextResponse.json(
        { contentHash, markdown: null, pages: [], cached: false },
        { status: 404 },
      );
    }

    const [textPages, skippedPages] = await Promise.all([
      listTextRoutePageNos(contentHash),
      listNonTextRoutePageNos(contentHash),
    ]);

    return NextResponse.json({
      contentHash: state.contentHash,
      markdown: state.markdown,
      pages: state.pages,
      requestedPages: textPages,
      skippedPages,
      cached: state.cached,
    });
  } catch (error) {
    console.error("[analysis:extraction:docling:get]", error);
    return NextResponse.json(
      { error: "Could not read Docling cache." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { hash } = await context.params;
    const contentHash = hash.trim().toLowerCase();
    if (!HASH_RE.test(contentHash)) {
      return NextResponse.json(
        { error: "Invalid content hash." },
        { status: 400 },
      );
    }

    const url = new URL(request.url);
    let force = url.searchParams.get("force") === "1";
    let pages: number[] | undefined;
    try {
      const body = (await request.json()) as {
        force?: unknown;
        pages?: unknown;
      };
      if (body?.force === true) force = true;
      pages = parsePages(body?.pages);
    } catch {
      // empty body is fine
    }

    const health = await checkDoclingSidecarHealth();
    if (!health.ok) {
      return NextResponse.json(
        {
          error:
            `Docling sidecar not reachable at ${health.sidecarUrl}. ` +
            `Run \`npm run docling:sidecar\` in another terminal.` +
            (health.detail ? ` (${health.detail})` : ""),
        },
        { status: 503 },
      );
    }

    const result = await convertWithDoclingSidecar({
      contentHash,
      pages,
      force,
    });
    return NextResponse.json({
      contentHash: result.contentHash,
      markdown: result.markdown,
      pages: result.pages,
      requestedPages: result.requestedPages,
      skippedPages: result.skippedPages,
      elapsedMs: result.elapsedMs,
      pageCount: result.pageCount,
      cached: result.cached,
      sidecarUrl: result.sidecarUrl,
    });
  } catch (error) {
    console.error("[analysis:extraction:docling:post]", error);
    const message =
      error instanceof Error ? error.message : "Docling conversion failed.";
    const unavailable =
      message.includes("unreachable") || message.includes("not found");
    const badRequest = message.includes("No text-route pages");
    return NextResponse.json(
      { error: message },
      { status: badRequest ? 400 : unavailable ? 503 : 500 },
    );
  }
}
