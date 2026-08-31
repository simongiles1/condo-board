/** Client-safe project mention staging helpers (no DB). */

import {
  cardPassesNameMintingGate,
  projectIdentityKey,
  type ProjectEntityCard,
} from "@/lib/email-analysis/project-highlight-shared";
import {
  normalizeProjectNameKey,
  normalizeProjectYearHint,
} from "@/lib/projects/project-multi-values";

export const PROJECT_MENTION_STATUSES = [
  "unresolved",
  "provisional",
  "confirmed",
] as const;

export type ProjectMentionResolutionStatus =
  (typeof PROJECT_MENTION_STATUSES)[number];

export type ProjectMentionCard = {
  raw_name: string;
  contractor: string | null;
  year_hint: string | null;
  phase: string | null;
  location: string | null;
};

export function cardToProjectMentionCard(
  card: ProjectEntityCard,
): ProjectMentionCard | null {
  const rawName = card.name?.trim() || null;
  if (!rawName) return null;
  return {
    raw_name: rawName,
    contractor: card.contractor?.trim() || null,
    year_hint: normalizeProjectYearHint(card.year_hint),
    phase: card.phase?.trim() || null,
    location: card.location?.trim() || null,
  };
}

/** Stable per-email identity for upsert. Does not include resolution fields. */
export function projectMentionFingerprint(card: ProjectMentionCard): string {
  return [
    normalizeProjectNameKey(card.raw_name),
    card.year_hint?.trim() ?? "",
    normalizeProjectNameKey(card.contractor),
  ].join("|");
}

export function projectMentionIdentityKey(card: ProjectMentionCard): string {
  return projectIdentityKey({
    name: card.raw_name,
    year_hint: card.year_hint,
    phase: card.phase,
    contractor: card.contractor,
    location: card.location,
    equipment_mentions: null,
    scope: null,
    aliases: [],
  });
}

export function projectMentionIsMinted(
  card: ProjectMentionCard,
  orgNameKeys: ReadonlySet<string> = new Set(),
): boolean {
  return cardPassesNameMintingGate(
    { name: card.raw_name, contractor: card.contractor },
    orgNameKeys,
  );
}
