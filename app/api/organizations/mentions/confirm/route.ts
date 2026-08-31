import { NextResponse } from "next/server";

import { confirmOrgMention } from "@/lib/organizations/mention-resolve";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { mentionId?: string; organizationId?: string } = {};
  try {
    body = (await req.json()) as { mentionId?: string; organizationId?: string };
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const mentionId = body.mentionId?.trim() ?? "";
  const organizationId = body.organizationId?.trim() ?? "";
  if (!mentionId || !organizationId) {
    return NextResponse.json(
      { error: "mentionId and organizationId are required." },
      { status: 400 },
    );
  }
  const result = await confirmOrgMention({ mentionId, organizationId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
