export const runtime = "nodejs";

import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  buildConceptRoutingPreview,
  getRoutableConceptDestinations,
  parseConceptRoutingConfig,
} from "@/lib/email/concept-routing";
import { getDb } from "@/lib/db";
import {
  discoveredFacts,
  extractionSkillAuditLog,
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
  const [row] = await db
    .select()
    .from(extractionSkillEntries)
    .where(eq(extractionSkillEntries.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Skill entry not found." }, { status: 404 });
  }

  const factRows = await db
    .select()
    .from(discoveredFacts)
    .where(eq(discoveredFacts.conceptId, id))
    .orderBy(desc(discoveredFacts.createdAt));

  const suggestedFields = parseJson<
    Array<{ name: string; type?: string; description?: string }>
  >(row.suggestedFieldsJson, []);

  const facts = factRows.map((fact) => ({
    id: fact.id,
    payload: parseJson<Record<string, unknown>>(fact.payloadJson, {}),
    sourceQuote: fact.sourceQuote,
    confidence: fact.confidence,
    createdAt: fact.createdAt,
  }));

  const routing = parseConceptRoutingConfig(row);

  const routingPreview = buildConceptRoutingPreview({
    conceptName: row.conceptName,
    config: routing,
    suggestedFieldNames: suggestedFields.map((field) => field.name),
    facts,
  });

  const routingHistory = await db
    .select()
    .from(extractionSkillAuditLog)
    .where(eq(extractionSkillAuditLog.entryId, id))
    .orderBy(desc(extractionSkillAuditLog.createdAt));

  return NextResponse.json({
    entry: {
      id: row.id,
      conceptName: row.conceptName,
      description: row.description,
      suggestedFields,
      exampleQuotes: parseJson(row.exampleQuotesJson, []),
      exampleEmailIds: parseJson(row.exampleEmailIdsJson, []),
      occurrenceCount: row.occurrenceCount,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      status: row.status,
      mergedIntoId: row.mergedIntoId,
      category: row.category,
      userNotes: row.userNotes,
      routing,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    facts,
    routingPreview,
    routableDestinations: getRoutableConceptDestinations(),
    routingHistory: routingHistory
      .filter((item) => item.action === "routing_configured")
      .map((item) => ({
        id: item.id,
        action: item.action,
        details: parseJson<Record<string, unknown>>(item.detailsJson, {}),
        createdAt: item.createdAt,
      })),
  });
}
