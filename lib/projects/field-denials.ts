/** Persist and apply project metadata negative associations (severed field links). */

import { randomUUID } from "crypto";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { projectFieldDenials } from "@/lib/db/schema";
import {
  projectIdentityKey,
  cardPassesNameMintingGate,
  type ProjectEntityCard,
} from "@/lib/email-analysis/project-highlight-shared";
import { resolveProjectSurvivorKey } from "@/lib/projects/manual-merge";
import { normalizeProjectPhase } from "@/lib/projects/project-phase";
import {
  mergeProjectAliasLists,
  normalizeProjectNameKey,
  projectMultiValueContains,
  removeProjectMultiValue,
} from "@/lib/projects/project-multi-values";
import {
  normalizeProjectYearHint,
  yearsMatch,
} from "@/lib/projects/project-year-range";

export { projectIdentityKey };

export const PROJECT_DENIABLE_FIELDS = [
  "name",
  "year_hint",
  "phase",
  "contractor",
  "location",
  "equipment_mentions",
  "name_alias",
] as const;

export type ProjectDeniableField = (typeof PROJECT_DENIABLE_FIELDS)[number];

export type ProjectFieldDenial = {
  id: string;
  projectKey: string;
  field: ProjectDeniableField;
  deniedValue: string;
  nameKey: string | null;
  createdAt: string;
};

export function isProjectDeniableField(
  value: string,
): value is ProjectDeniableField {
  return (PROJECT_DENIABLE_FIELDS as readonly string[]).includes(value);
}

export function normalizeProjectDeniedValue(
  field: ProjectDeniableField,
  value: string,
): string {
  const trimmed = value.trim();
  if (field === "year_hint") {
    return normalizeProjectYearHint(trimmed) ?? trimmed.toLowerCase();
  }
  if (field === "phase") {
    return normalizeProjectPhase(trimmed) ?? trimmed.toLowerCase();
  }
  if (
    field === "contractor" ||
    field === "location" ||
    field === "equipment_mentions"
  ) {
    return trimmed.toLowerCase();
  }
  if (field === "name" || field === "name_alias") {
    return normalizeProjectNameKey(trimmed) || trimmed.toLowerCase();
  }
  return trimmed.toLowerCase();
}

function fieldValueMatchesDenial(
  card: ProjectEntityCard,
  denial: ProjectFieldDenial,
): boolean {
  if (denial.field === "name_alias") {
    return (card.aliases ?? []).some(
      (alias) =>
        normalizeProjectDeniedValue("name_alias", alias) === denial.deniedValue,
    );
  }
  if (
    denial.field === "contractor" ||
    denial.field === "location" ||
    denial.field === "equipment_mentions"
  ) {
    return projectMultiValueContains(card[denial.field], denial.deniedValue);
  }
  if (denial.field === "year_hint") {
    return yearsMatch(card.year_hint, denial.deniedValue);
  }
  const raw = card[denial.field];
  if (!raw?.trim()) return false;
  return normalizeProjectDeniedValue(denial.field, raw) === denial.deniedValue;
}

/**
 * Pairwise match: denied value on this project only.
 * Prefer name_key so denying a contractor does not strip it from unrelated cards.
 */
export function projectCardMatchesFieldDenial(
  card: ProjectEntityCard,
  denial: ProjectFieldDenial,
  mergeMap: Map<string, string>,
): boolean {
  if (!fieldValueMatchesDenial(card, denial)) return false;

  if (denial.nameKey) {
    return normalizeProjectNameKey(card.name) === denial.nameKey;
  }

  const cardKey = projectIdentityKey(card);
  return (
    resolveProjectSurvivorKey(cardKey, mergeMap) ===
    resolveProjectSurvivorKey(denial.projectKey, mergeMap)
  );
}

export function stripDeniedFieldsFromProjectCard(
  card: ProjectEntityCard,
  denials: ProjectFieldDenial[],
  mergeMap: Map<string, string>,
): ProjectEntityCard {
  if (denials.length === 0) return card;
  const next: ProjectEntityCard = {
    ...card,
    aliases: [...(card.aliases ?? [])],
  };
  for (const denial of denials) {
    if (!projectCardMatchesFieldDenial(next, denial, mergeMap)) continue;
    if (denial.field === "name_alias") {
      next.aliases = mergeProjectAliasLists(
        next.name,
        (next.aliases ?? []).filter(
          (alias) =>
            normalizeProjectDeniedValue("name_alias", alias) !==
            denial.deniedValue,
        ),
      );
      continue;
    }
    if (
      denial.field === "contractor" ||
      denial.field === "location" ||
      denial.field === "equipment_mentions"
    ) {
      next[denial.field] = removeProjectMultiValue(
        next[denial.field],
        denial.deniedValue,
      );
      continue;
    }
    next[denial.field] = null;
  }
  return next;
}

export function applyProjectFieldDenialsToCards(
  cards: ProjectEntityCard[],
  denials: ProjectFieldDenial[],
  mergeMap: Map<string, string> = new Map(),
): ProjectEntityCard[] {
  if (denials.length === 0) return cards;
  return cards
    .map((card) => stripDeniedFieldsFromProjectCard(card, denials, mergeMap))
    .filter((card) => cardPassesNameMintingGate(card));
}

export async function loadProjectFieldDenials(): Promise<ProjectFieldDenial[]> {
  const db = getDb();
  const rows = await db.select().from(projectFieldDenials);
  const out: ProjectFieldDenial[] = [];
  for (const row of rows) {
    if (!isProjectDeniableField(row.field)) continue;
    out.push({
      id: row.id,
      projectKey: row.projectKey,
      field: row.field,
      deniedValue: row.deniedValue,
      nameKey: row.nameKey?.trim() || null,
      createdAt: row.createdAt,
    });
  }
  return out;
}

export async function recordProjectFieldDenial(params: {
  projectId: string;
  field: string;
  value: string;
  projectName?: string | null;
}): Promise<
  | { ok: true; denial: ProjectFieldDenial }
  | { ok: false; error: string }
> {
  const projectId = params.projectId.trim();
  const rawValue = params.value.trim();
  if (!projectId) {
    return { ok: false, error: "projectId is required." };
  }
  if (!isProjectDeniableField(params.field)) {
    return {
      ok: false,
      error: `Unsupported field. Use one of: ${PROJECT_DENIABLE_FIELDS.join(", ")}.`,
    };
  }
  if (!rawValue) {
    return { ok: false, error: "Cannot sever an empty value." };
  }

  const field = params.field;
  const deniedValue = normalizeProjectDeniedValue(field, rawValue);
  const nameKey =
    normalizeProjectNameKey(params.projectName) ||
    (field === "name" ? normalizeProjectNameKey(rawValue) : "") ||
    null;

  const db = getDb();
  const existing = await db
    .select({ id: projectFieldDenials.id })
    .from(projectFieldDenials)
    .where(
      and(
        eq(projectFieldDenials.projectKey, projectId),
        eq(projectFieldDenials.field, field),
        eq(projectFieldDenials.deniedValue, deniedValue),
      ),
    )
    .limit(1);

  const nowIso = new Date().toISOString();
  if (existing[0]) {
    await db
      .update(projectFieldDenials)
      .set({ nameKey })
      .where(eq(projectFieldDenials.id, existing[0].id));
    return {
      ok: true,
      denial: {
        id: existing[0].id,
        projectKey: projectId,
        field,
        deniedValue,
        nameKey,
        createdAt: nowIso,
      },
    };
  }

  const id = randomUUID();
  await db.insert(projectFieldDenials).values({
    id,
    projectKey: projectId,
    field,
    deniedValue,
    nameKey,
    createdAt: nowIso,
  });

  return {
    ok: true,
    denial: {
      id,
      projectKey: projectId,
      field,
      deniedValue,
      nameKey,
      createdAt: nowIso,
    },
  };
}
