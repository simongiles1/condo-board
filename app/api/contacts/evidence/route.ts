export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE,
  CONTACT_EVIDENCE_MAX_PAGE_SIZE,
  loadContactEvidence,
  type ContactEvidenceKind,
  type ContactEvidenceScope,
} from "@/lib/contacts/registry-evidence";

const KINDS = new Set<ContactEvidenceKind>([
  "title",
  "email",
  "phone",
  "person",
]);

function parsePositiveInt(
  raw: string | null,
  fallback: number,
  max?: number,
): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  if (max != null) return Math.min(max, n);
  return n;
}

export async function GET(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const url = new URL(request.url);
  const kindRaw = url.searchParams.get("kind") ?? "";
  const id = url.searchParams.get("id")?.trim() ?? "";
  const scopeRaw = url.searchParams.get("scope")?.trim() ?? "";
  const scope: ContactEvidenceScope =
    scopeRaw === "all" ? "all" : "content";
  const page = parsePositiveInt(url.searchParams.get("page"), 1);
  const pageSize = parsePositiveInt(
    url.searchParams.get("pageSize"),
    CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE,
    CONTACT_EVIDENCE_MAX_PAGE_SIZE,
  );

  if (!KINDS.has(kindRaw as ContactEvidenceKind)) {
    return NextResponse.json(
      { error: "kind must be title, email, phone, or person." },
      { status: 400 },
    );
  }
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const evidence = await loadContactEvidence({
      kind: kindRaw as ContactEvidenceKind,
      id,
      scope: kindRaw === "person" ? scope : "all",
      page,
      pageSize,
    });
    if (!evidence) {
      return NextResponse.json(
        { error: kindRaw === "person" ? "Person not found." : "Attribute not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ evidence });
  } catch (error) {
    console.error("[contacts:evidence]", error);
    return NextResponse.json(
      { error: "Could not load evidence." },
      { status: 500 },
    );
  }
}
