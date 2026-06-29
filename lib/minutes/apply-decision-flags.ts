import { getSectionRef } from "@/lib/minutes/merge-omissions";
import {
  MINUTES_SECTION_PATHS,
  type MinutesSectionPath,
} from "@/lib/minutes/omissions-schema";
import {
  parseMinutesJsonEnvelope,
  sanitizeMinutesDocumentV2,
  wrapMinutesV2,
} from "@/lib/minutes/schema-v2";
import type { DecisionFlag } from "@/lib/minutes/verification-schema";

export const DECISION_CORRECTIONS = [
  "set_motion_deferred",
  "remove_motion",
] as const;
export type DecisionCorrection = (typeof DECISION_CORRECTIONS)[number];

function asSectionPath(raw: string | undefined): MinutesSectionPath | null {
  if (!raw) return null;
  return (MINUTES_SECTION_PATHS as readonly string[]).includes(raw)
    ? (raw as MinutesSectionPath)
    : null;
}

/** True when a one-click correction can be applied to this flag's item. */
export function canApplyDecisionCorrection(flag: DecisionFlag): boolean {
  return asSectionPath(flag.targetSection) !== null && flag.itemIndex !== undefined;
}

/**
 * Apply a correction to the motion on the agenda item a decision flag points at.
 * Returns the updated minutes JSON string, or null when the item/motion cannot
 * be located (caller should surface an error and leave the minutes untouched).
 */
export function applyDecisionCorrection(
  minutesJson: string,
  flag: DecisionFlag,
  correction: DecisionCorrection,
): string | null {
  const targetSection = asSectionPath(flag.targetSection);
  if (!targetSection || flag.itemIndex === undefined) return null;

  const envelope = parseMinutesJsonEnvelope(minutesJson);
  if (envelope.version !== "v2" || !envelope.v2) return null;

  const doc = envelope.v2;
  const ref = getSectionRef(doc, targetSection, flag.postTerminationTitle);
  if (!ref) return null;

  const index = flag.itemIndex;
  if (index < 0 || index >= ref.items.length) return null;

  const item = ref.items[index];
  // Nothing to correct if the recorded item has no motion.
  if (!item.motion) return null;

  const items = [...ref.items];
  if (correction === "set_motion_deferred") {
    items[index] = {
      ...item,
      motion: { ...item.motion, status: "Deferred." },
    };
  } else {
    const next = { ...item };
    delete next.motion;
    items[index] = next;
  }

  const updated = sanitizeMinutesDocumentV2(ref.apply(items));
  return JSON.stringify(wrapMinutesV2(updated));
}
