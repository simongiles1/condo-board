/** Persist and apply project metadata positive associations (moved field links). */

import { randomUUID } from "crypto";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { projectFieldAttachments } from "@/lib/db/schema";
import type { ProjectEntityCard } from "@/lib/email-analysis/project-highlight-shared";
import {
  deleteProjectFieldDenial,
  isProjectDeniableField,
  normalizeProjectDeniedValue,
  projectIdentityKey,
  recordProjectFieldDenial,
  stripDeniedFieldsFromProjectCard,
  type ProjectFieldDenial,
} from "@/lib/projects/field-denials";
import { resolveProjectSurvivorKey } from "@/lib/projects/manual-merge";
import {
  mergeProjectAliasLists,
  mergeProjectMultiValues,
  normalizeProjectNameKey,
} from "@/lib/projects/project-multi-values";

export const PROJECT_MOVABLE_FIELDS = [
  "name_alias",
  "contractor",
  "location",
  "equipment_mentions",
] as const;

export type ProjectMovableField = (typeof PROJECT_MOVABLE_FIELDS)[number];

export type ProjectFieldAttachment = {
  id: string;
  projectKey: string;
  field: ProjectMovableField;
  attachedValue: string;
  valueKey: string;
  nameKey: string | null;
  createdAt: string;
};

export function isProjectMovableField(
  value: string,
): value is ProjectMovableField {
  return (PROJECT_MOVABLE_FIELDS as readonly string[]).includes(value);
}

export function projectCardMatchesAttachmentTarget(
  card: ProjectEntityCard,
  attachment: Pick<ProjectFieldAttachment, "projectKey" | "nameKey">,
  mergeMap: Map<string, string>,
): boolean {
  if (attachment.nameKey) {
    return normalizeProjectNameKey(card.name) === attachment.nameKey;
  }
  const cardKey = projectIdentityKey(card);
  return (
    resolveProjectSurvivorKey(cardKey, mergeMap) ===
    resolveProjectSurvivorKey(attachment.projectKey, mergeMap)
  );
}

function attachFieldToProjectCard(
  card: ProjectEntityCard,
  field: ProjectMovableField,
  displayValue: string,
): ProjectEntityCard {
  const trimmed = displayValue.trim();
  if (!trimmed) return card;
  if (field === "name_alias") {
    return {
      ...card,
      aliases: mergeProjectAliasLists(card.name, card.aliases, [trimmed]),
    };
  }
  return {
    ...card,
    [field]: mergeProjectMultiValues(card[field], trimmed),
  };
}

export function applyProjectFieldAttachmentsToCards(
  cards: ProjectEntityCard[],
  attachments: ProjectFieldAttachment[],
  mergeMap: Map<string, string> = new Map(),
): ProjectEntityCard[] {
  if (attachments.length === 0) return cards;
  return cards.map((card) => {
    let next = card;
    for (const attachment of attachments) {
      if (!projectCardMatchesAttachmentTarget(next, attachment, mergeMap)) {
        continue;
      }
      next = attachFieldToProjectCard(
        next,
        attachment.field,
        attachment.attachedValue,
      );
    }
    return next;
  });
}

/**
 * Apply a single move in memory: deny on source, attach on target.
 * Mirrors persist + reload without touching the database.
 */
export function applyProjectFieldMoveToCards(params: {
  cards: ProjectEntityCard[];
  field: ProjectMovableField;
  value: string;
  sourceProjectKey: string;
  sourceNameKey?: string | null;
  targetProjectKey: string;
  targetNameKey?: string | null;
  mergeMap?: Map<string, string>;
}): ProjectEntityCard[] {
  const mergeMap = params.mergeMap ?? new Map();
  const deniedValue = normalizeProjectDeniedValue(params.field, params.value);
  const denial: ProjectFieldDenial = {
    id: "move",
    projectKey: params.sourceProjectKey,
    field: params.field,
    deniedValue,
    nameKey: params.sourceNameKey?.trim() || null,
    createdAt: "",
  };
  const stripped = params.cards.map((card) =>
    stripDeniedFieldsFromProjectCard(card, [denial], mergeMap),
  );
  const attachment: ProjectFieldAttachment = {
    id: "move",
    projectKey: params.targetProjectKey,
    field: params.field,
    attachedValue: params.value.trim(),
    valueKey: deniedValue,
    nameKey: params.targetNameKey?.trim() || null,
    createdAt: "",
  };
  return applyProjectFieldAttachmentsToCards(stripped, [attachment], mergeMap);
}

export async function loadProjectFieldAttachments(): Promise<
  ProjectFieldAttachment[]
> {
  const db = getDb();
  const rows = await db.select().from(projectFieldAttachments);
  const out: ProjectFieldAttachment[] = [];
  for (const row of rows) {
    if (!isProjectMovableField(row.field)) continue;
    out.push({
      id: row.id,
      projectKey: row.projectKey,
      field: row.field,
      attachedValue: row.attachedValue,
      valueKey: row.valueKey,
      nameKey: row.nameKey?.trim() || null,
      createdAt: row.createdAt,
    });
  }
  return out;
}

export async function deleteProjectFieldAttachment(params: {
  projectId: string;
  field: ProjectMovableField;
  value: string;
}): Promise<void> {
  const projectId = params.projectId.trim();
  const valueKey = normalizeProjectDeniedValue(params.field, params.value);
  if (!projectId || !valueKey) return;
  const db = getDb();
  await db
    .delete(projectFieldAttachments)
    .where(
      and(
        eq(projectFieldAttachments.projectKey, projectId),
        eq(projectFieldAttachments.field, params.field),
        eq(projectFieldAttachments.valueKey, valueKey),
      ),
    );
}

async function recordProjectFieldAttachment(params: {
  projectId: string;
  field: ProjectMovableField;
  value: string;
  projectName?: string | null;
}): Promise<
  { ok: true; attachment: ProjectFieldAttachment } | { ok: false; error: string }
> {
  const projectId = params.projectId.trim();
  const attachedValue = params.value.trim();
  if (!projectId) {
    return { ok: false, error: "projectId is required." };
  }
  if (!attachedValue) {
    return { ok: false, error: "Cannot attach an empty value." };
  }

  const field = params.field;
  const valueKey = normalizeProjectDeniedValue(field, attachedValue);
  const nameKey = normalizeProjectNameKey(params.projectName) || null;
  const db = getDb();
  const existing = await db
    .select({ id: projectFieldAttachments.id })
    .from(projectFieldAttachments)
    .where(
      and(
        eq(projectFieldAttachments.projectKey, projectId),
        eq(projectFieldAttachments.field, field),
        eq(projectFieldAttachments.valueKey, valueKey),
      ),
    )
    .limit(1);

  const nowIso = new Date().toISOString();
  if (existing[0]) {
    await db
      .update(projectFieldAttachments)
      .set({
        attachedValue,
        nameKey,
      })
      .where(eq(projectFieldAttachments.id, existing[0].id));
    return {
      ok: true,
      attachment: {
        id: existing[0].id,
        projectKey: projectId,
        field,
        attachedValue,
        valueKey,
        nameKey,
        createdAt: nowIso,
      },
    };
  }

  const id = randomUUID();
  await db.insert(projectFieldAttachments).values({
    id,
    projectKey: projectId,
    field,
    attachedValue,
    valueKey,
    nameKey,
    createdAt: nowIso,
  });
  return {
    ok: true,
    attachment: {
      id,
      projectKey: projectId,
      field,
      attachedValue,
      valueKey,
      nameKey,
      createdAt: nowIso,
    },
  };
}

export async function moveProjectField(params: {
  sourceProjectId: string;
  targetProjectId: string;
  field: string;
  value: string;
  sourceProjectName?: string | null;
  targetProjectName?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sourceProjectId = params.sourceProjectId.trim();
  const targetProjectId = params.targetProjectId.trim();
  const value = params.value.trim();
  if (!sourceProjectId || !targetProjectId) {
    return { ok: false, error: "Source and target project ids are required." };
  }
  if (sourceProjectId === targetProjectId) {
    return { ok: false, error: "Pick a different project to move to." };
  }
  if (!isProjectMovableField(params.field)) {
    return {
      ok: false,
      error: `Unsupported field. Use one of: ${PROJECT_MOVABLE_FIELDS.join(", ")}.`,
    };
  }
  if (!isProjectDeniableField(params.field)) {
    return { ok: false, error: "That field cannot be severed from the source." };
  }
  if (!value) {
    return { ok: false, error: "Cannot move an empty value." };
  }

  const field = params.field;
  const denied = await recordProjectFieldDenial({
    projectId: sourceProjectId,
    field,
    value,
    projectName: params.sourceProjectName,
  });
  if (!denied.ok) return denied;

  await deleteProjectFieldAttachment({
    projectId: sourceProjectId,
    field,
    value,
  });
  await deleteProjectFieldDenial({
    projectId: targetProjectId,
    field,
    value,
  });
  const attached = await recordProjectFieldAttachment({
    projectId: targetProjectId,
    field,
    value,
    projectName: params.targetProjectName,
  });
  if (!attached.ok) return attached;

  return { ok: true };
}
