export const runtime = "nodejs";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  bumpSkillVersion,
  getAllSkillEntries,
  recordConceptRoutingDecision,
  type SkillStatus,
} from "@/lib/email-analysis/extraction-skill";
import {
  inferConceptFieldMapping,
  serializeConceptRoutingPatch,
  SKILL_ONLY_DESTINATION_ID,
  type ConceptFieldMapping,
} from "@/lib/email/concept-routing";
import { getDb } from "@/lib/db";
import {
  discoveredFacts,
  extractionSkillEntries,
} from "@/lib/db/schema";

type PatchBody = {
  id?: string;
  conceptName?: string;
  description?: string;
  suggestedFields?: Array<{ name: string; type?: string; description?: string }>;
  category?: string | null;
  userNotes?: string | null;
  status?: SkillStatus;
  mergeIntoId?: string;
  routingDestinationId?: string;
  fieldMapping?: ConceptFieldMapping;
};

function normalizeStatus(value: string | null): SkillStatus | undefined {
  if (value === "active" || value === "archived" || value === "merged") {
    return value;
  }
  return undefined;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = normalizeStatus(url.searchParams.get("status"));
  const entries = await getAllSkillEntries(status);

  return NextResponse.json({ entries });
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as PatchBody;
    if (!body.id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }

    const db = getDb();
    const [entry] = await db
      .select()
      .from(extractionSkillEntries)
      .where(eq(extractionSkillEntries.id, body.id))
      .limit(1);

    if (!entry) {
      return NextResponse.json({ error: "Skill entry not found." }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (body.mergeIntoId) {
      if (body.mergeIntoId === body.id) {
        return NextResponse.json(
          { error: "Cannot merge a skill entry into itself." },
          { status: 400 },
        );
      }

      const [target] = await db
        .select()
        .from(extractionSkillEntries)
        .where(eq(extractionSkillEntries.id, body.mergeIntoId))
        .limit(1);

      if (!target) {
        return NextResponse.json(
          { error: "Merge target not found." },
          { status: 404 },
        );
      }

      await db
        .update(discoveredFacts)
        .set({ conceptId: target.id })
        .where(eq(discoveredFacts.conceptId, entry.id));
      await db
        .update(extractionSkillEntries)
        .set({ status: "merged", mergedIntoId: target.id, updatedAt: now })
        .where(eq(extractionSkillEntries.id, entry.id));

      await bumpSkillVersion(`merged_skill_entry:${entry.conceptName}`);
      revalidatePath("/admin/concepts");
      return NextResponse.json({ ok: true });
    }

    await db
      .update(extractionSkillEntries)
      .set({
        conceptName: body.conceptName?.trim() || entry.conceptName,
        description: body.description?.trim() || entry.description,
        suggestedFieldsJson:
          body.suggestedFields !== undefined
            ? JSON.stringify(body.suggestedFields)
            : entry.suggestedFieldsJson,
        category:
          body.category !== undefined ? body.category : entry.category,
        userNotes:
          body.userNotes !== undefined ? body.userNotes : entry.userNotes,
        status: body.status ?? entry.status,
        ...(body.routingDestinationId !== undefined
          ? serializeConceptRoutingPatch({
              destinationId: body.routingDestinationId,
              fieldMapping:
                body.fieldMapping ??
                inferConceptFieldMapping({
                  suggestedFieldNames: parseJson<Array<{ name: string }>>(
                    entry.suggestedFieldsJson,
                    [],
                  ).map((field) => field.name),
                  payloads: [],
                  existingMapping: parseJson<ConceptFieldMapping>(
                    entry.fieldMappingJson,
                    {},
                  ),
                }),
            })
          : {}),
        updatedAt: now,
      })
      .where(eq(extractionSkillEntries.id, entry.id));

    if (body.routingDestinationId !== undefined) {
      await recordConceptRoutingDecision({
        entryId: entry.id,
        destinationId: body.routingDestinationId || SKILL_ONLY_DESTINATION_ID,
        fieldMapping:
          body.fieldMapping ??
          inferConceptFieldMapping({
            suggestedFieldNames: parseJson<Array<{ name: string }>>(
              entry.suggestedFieldsJson,
              [],
            ).map((field) => field.name),
            payloads: [],
            existingMapping: parseJson<ConceptFieldMapping>(
              entry.fieldMappingJson,
              {},
            ),
          }),
      });
    }

    const isRoutingOnly =
      body.routingDestinationId !== undefined &&
      body.conceptName === undefined &&
      body.description === undefined &&
      body.suggestedFields === undefined &&
      body.category === undefined &&
      body.userNotes === undefined &&
      body.status === undefined;

    if (!isRoutingOnly) {
      await bumpSkillVersion(`updated_skill_entry:${entry.conceptName}`);
    }
    revalidatePath("/admin/concepts");

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update skill entry.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
