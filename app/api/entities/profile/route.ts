export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE } from "@/lib/contacts/registry-evidence-shared";
import {
  isEntityProfileKind,
  type EntityProfileKind,
} from "@/lib/entities/entity-profile-shared";
import { loadEntityProfile } from "@/lib/entities/load-entity-profile";

function parsePositiveInt(raw: string | null, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export async function GET(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const url = new URL(request.url);
  const kindRaw = url.searchParams.get("kind")?.trim() ?? "";
  const id = url.searchParams.get("id")?.trim() ?? "";
  const nameHint = url.searchParams.get("name")?.trim() || null;
  const scopeRaw = url.searchParams.get("scope")?.trim() ?? "";
  const page = parsePositiveInt(url.searchParams.get("page"), 1);

  if (!isEntityProfileKind(kindRaw)) {
    return NextResponse.json(
      { error: "kind must be person, organization, project, equipment, or event." },
      { status: 400 },
    );
  }
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const kind: EntityProfileKind = kindRaw;
  try {
    const profile = await loadEntityProfile(kind, id, {
      page,
      scope: scopeRaw === "all" ? "all" : "content",
      nameHint,
    });
    if (!profile) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json({
      profile,
      pageSize: CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE,
    });
  } catch (error) {
    console.error("[entities:profile]", error);
    return NextResponse.json(
      { error: "Could not load profile." },
      { status: 500 },
    );
  }
}
