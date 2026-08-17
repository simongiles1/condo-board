export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  EXTRACTION_PROCESS_MAX_HASHES,
  getExtractionCostSummary,
  getExtractionFilterCounts,
  isExtractionListFilter,
  isExtractionListKind,
  isExtractionListSort,
  listExtractionDocuments,
  processSelectedExtractionsions,
  type ExtractionListFilter,
  type ExtractionListKind,
} from "@/lib/email/attachment-extraction-lab";

function parseFilter(value: string | null): ExtractionListFilter {
  if (value && isExtractionListFilter(value)) return value;
  return "needs_work";
}

function parseKind(value: string | null): ExtractionListKind {
  if (value && isExtractionListKind(value)) return value;
  return "all";
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const url = new URL(request.url);
    const filter = parseFilter(url.searchParams.get("filter"));
    const kind = parseKind(url.searchParams.get("kind"));
    const sortRaw = url.searchParams.get("sort") ?? "filename_asc";
    const sort = isExtractionListSort(sortRaw) ? sortRaw : "filename_asc";
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const search = url.searchParams.get("search") ?? undefined;
    const includeCosts = url.searchParams.get("costs") !== "0";

    const [list, costs, filterCounts] = await Promise.all([
      listExtractionDocuments({
        filter,
        kind,
        sort,
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
        search,
      }),
      includeCosts ? getExtractionCostSummary() : Promise.resolve(null),
      getExtractionFilterCounts({ filter, search }),
    ]);

    return NextResponse.json({
      ...list,
      costs,
      filterCounts,
    });
  } catch (error) {
    console.error("[analysis:extraction:list]", error);
    return NextResponse.json(
      { error: "Could not list extraction documents." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = (await request.json()) as {
      contentHashes?: unknown;
    };
    const raw = Array.isArray(body.contentHashes) ? body.contentHashes : [];
    const contentHashes = raw.filter(
      (h): h is string => typeof h === "string" && h.trim().length > 0,
    );

    if (contentHashes.length === 0) {
      return NextResponse.json(
        { error: "Select at least one file to process." },
        { status: 400 },
      );
    }
    if (contentHashes.length > EXTRACTION_PROCESS_MAX_HASHES) {
      return NextResponse.json(
        {
          error: `Select at most ${EXTRACTION_PROCESS_MAX_HASHES} files per run.`,
        },
        { status: 400 },
      );
    }

    const result = await processSelectedExtractionsions(contentHashes);
    const costs = await getExtractionCostSummary();
    return NextResponse.json({ result, costs });
  } catch (error) {
    console.error("[analysis:extraction:process]", error);
    const message =
      error instanceof Error ? error.message : "Could not process extractions.";
    const missingConfig =
      message.includes("CLOUDFLARE_") || message.includes("GEMINI_");
    return NextResponse.json(
      { error: message },
      { status: missingConfig ? 503 : 500 },
    );
  }
}
