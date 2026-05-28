export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import {
  discoveredFacts,
  extractionSkillEntries,
} from "@/lib/db/schema";

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = getDb();
  const [entry] = await db
    .select()
    .from(extractionSkillEntries)
    .where(eq(extractionSkillEntries.id, id))
    .limit(1);

  if (!entry) {
    return NextResponse.json({ error: "Skill entry not found." }, { status: 404 });
  }

  const facts = await db
    .select()
    .from(discoveredFacts)
    .where(eq(discoveredFacts.conceptId, id));

  return NextResponse.json({
    entry: {
      ...entry,
      suggestedFields: parseJson(entry.suggestedFieldsJson, []),
      exampleQuotes: parseJson(entry.exampleQuotesJson, []),
      exampleEmailIds: parseJson(entry.exampleEmailIdsJson, []),
    },
    facts: facts.map((fact) => ({
      ...fact,
      payload: parseJson(fact.payloadJson, {}),
    })),
  });
}
