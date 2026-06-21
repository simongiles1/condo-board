import {
  dedupeEmailReferences,
  resolveExtractionSourceEmails,
  type BuildingEmailReference,
} from "@/lib/building/resolve-source-email";

export type { BuildingEmailReference as InsightSourceEmail };

export async function loadEmailsBySourceId(
  sourceIds: string[],
): Promise<Map<string, BuildingEmailReference>> {
  return resolveExtractionSourceEmails(sourceIds);
}

export function emailsForSourceIds(
  sourceIds: string[],
  bySourceId: Map<string, BuildingEmailReference>,
): BuildingEmailReference[] {
  return dedupeEmailReferences(
    sourceIds
      .map((id) => bySourceId.get(id))
      .filter((email): email is BuildingEmailReference => Boolean(email)),
  );
}

export function emailsForMentionIds(
  mentionIds: string[],
  mentionIdToSourceId: Map<string, string>,
  bySourceId: Map<string, BuildingEmailReference>,
): BuildingEmailReference[] {
  const sourceIds = mentionIds
    .map((id) => mentionIdToSourceId.get(id))
    .filter((id): id is string => Boolean(id));
  return emailsForSourceIds(sourceIds, bySourceId);
}

export function collectUniqueSourceIds(
  ...lists: Array<Array<string | null | undefined>>
): string[] {
  return [
    ...new Set(
      lists.flat().filter((id): id is string => Boolean(id?.trim())),
    ),
  ];
}
