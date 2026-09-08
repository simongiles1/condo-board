/**
 * Project mention anchor extraction and resolution.
 *
 * Connects project mentions to the canonical equipment register (Stage 6).
 * Pure module with no direct database imports — fully unit-testable.
 */

import {
  decideEquipmentMentionResolution,
  stripActionPrefix,
  type EquipmentRegistryDocument,
} from "@/lib/equipment/mention-resolve-shared";
import type { ProjectAnchorType } from "@/lib/projects/mention-resolve-shared";

export type ProjectAnchorInput = {
  rawName: string;
  equipmentMentions?: string | null;
  location?: string | null;
};

export type ResolvedProjectAnchor = {
  extractedAnchorType: "equipment" | "building_area" | "service_category" | null;
  extractedAnchorHint: string | null;
  resolvedAnchorId: string | null;
};

/**
 * Resolve project anchor type, hint, and canonical id.
 *
 * Rules:
 * 1. If explicit equipment_mentions are provided:
 *    - extractedAnchorType is always "equipment"
 *    - extractedAnchorHint is the raw equipment mention
 *    - resolvedAnchorId is populated if it matches a canonical asset;
 *      otherwise null (which fails closed as ambiguous_equipment in resolution).
 * 2. If equipment_mentions is empty, inspect rawName:
 *    - If rawName matches a canonical asset, alias, or component part:
 *      extractedAnchorType is "equipment", hint is stripped action text, and
 *      resolvedAnchorId is the canonical equipment id.
 *    - If rawName is recognized as equipment but is ambiguous (e.g. missing location
 *      for garage door or multiple candidates):
 *      extractedAnchorType is "equipment", hint is stripped action text, and
 *      resolvedAnchorId is null (fails closed).
 *    - Otherwise, non-equipment work returns null anchor fields.
 */
export function resolveProjectAnchor(
  input: ProjectAnchorInput,
  registry: EquipmentRegistryDocument[],
): ResolvedProjectAnchor {
  const explicitEquipment = input.equipmentMentions?.trim() || null;
  const rawName = input.rawName?.trim() || "";

  // 1. Explicit equipment mentions from extraction card
  if (explicitEquipment) {
    const decision = decideEquipmentMentionResolution(
      {
        rawName: explicitEquipment,
        location: input.location,
        contextSnippet: rawName,
      },
      registry,
    );

    return {
      extractedAnchorType: "equipment",
      extractedAnchorHint: explicitEquipment,
      resolvedAnchorId:
        decision.status === "confirmed" ? decision.resolvedEquipmentId : null,
    };
  }

  // 2. Fallback: inspect raw project name for equipment signals
  if (rawName) {
    const decision = decideEquipmentMentionResolution(
      {
        rawName,
        location: input.location,
      },
      registry,
    );

    const hint = stripActionPrefix(rawName) || rawName;

    if (decision.status === "confirmed" && decision.resolvedEquipmentId) {
      return {
        extractedAnchorType: "equipment",
        extractedAnchorHint: hint,
        resolvedAnchorId: decision.resolvedEquipmentId,
      };
    }

    // Equipment recognized but ambiguous (e.g. generic door without floor/location)
    if (
      decision.reason === "ambiguous_door_location_missing" ||
      decision.reason === "ambiguous_name_multiple_candidates" ||
      decision.reason === "ambiguous_component_multiple_parents"
    ) {
      return {
        extractedAnchorType: "equipment",
        extractedAnchorHint: hint,
        resolvedAnchorId: null,
      };
    }
  }

  return {
    extractedAnchorType: null,
    extractedAnchorHint: null,
    resolvedAnchorId: null,
  };
}
