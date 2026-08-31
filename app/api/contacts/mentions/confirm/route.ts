import { NextResponse } from "next/server";

import { confirmContactMention } from "@/lib/contacts/mention-queue";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { mentionId?: string; personId?: string } = {};
  try {
    body = (await req.json()) as { mentionId?: string; personId?: string };
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }
  const mentionId = body.mentionId?.trim() ?? "";
  const personId = body.personId?.trim() ?? "";
  if (!mentionId || !personId) {
    return NextResponse.json(
      { error: "mentionId and personId are required." },
      { status: 400 },
    );
  }
  const result = await confirmContactMention({ mentionId, personId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
