export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  isPageVisionListKind,
  isPageVisionListSort,
  listPageVisionDocuments,
  type PageVisionListFilter,
  type PageVisionListKind,
} from "@/lib/email/page-vision-lab";

function parseFilter(value: string | null): PageVisionListFilter {
  if (
    value === "pending" ||
    value === "done" ||
    value === "failed" ||
    value === "all"
  ) {
    return value;
  }
  return "pending";
}

function parseKind(value: string | null): PageVisionListKind {
  if (value && isPageVisionListKind(value)) return value;
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
    const sort = isPageVisionListSort(sortRaw) ? sortRaw : "filename_asc";
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const search = url.searchParams.get("search") ?? undefined;

    const result = await listPageVisionDocuments({
      filter,
      kind,
      sort,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
      search,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[analysis:page-vision:list]", error);
    return NextResponse.json(
      { error: "Could not list page-vision documents." },
      { status: 500 },
    );
  }
}
