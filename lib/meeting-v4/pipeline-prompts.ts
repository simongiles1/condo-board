/**
 * Read-only copy of prompts and instructions for each Meetings V4 stage.
 * Shown in the V4 minutes prompt viewer; not sent to models from here.
 */

import { TRANSCRIPT_SYSTEM_PROMPT } from "@/lib/meeting-v2/agenda-ai";
import { PAGE_REWRITE_SYSTEM_PROMPT } from "@/lib/meeting-v3/page-rewrite";
import { CONFIDENTIAL_FLAG_PROMPT } from "@/lib/minutes/confidential-definition";
import { MEETINGS_V4_DRAFT_PROMPT } from "@/lib/meeting-v4/prompt";

/** One tab in the V4 pipeline prompt modal. */
export type MeetingsV4PromptTab = {
  id: string;
  title: string;
  subtitle: string;
  body: string;
};

/**
 * Rules the per-item draft uses for the restricted flag and restricted_reason fields.
 * Classification happens in the same DeepSeek call as the minutes paragraph.
 */
export const MEETINGS_V4_RESTRICTED_CLASSIFICATION_PROMPT = `During each V4 draft call, the model returns JSON with "restricted" (boolean) and "restricted_reason" (string).

Set restricted to true only when the item is confidential under s. 55(4) of the Condominium Act, 1998. When restricted is true, restricted_reason should briefly state why (for example suite dispute, litigation, or insurance holdback tied to a unit). When restricted is false, set restricted_reason to an empty string.

${CONFIDENTIAL_FLAG_PROMPT}`;

const SEGMENTATION_NOTE = `Meetings V4 does not run this step again. It reads the reviewed transcript spans already stored on the meeting (segment gold standard). Those spans were produced upstream with the prompt below.`;

const INVENTORY_NOTE = `No model call. Inventory compares agenda leaves, reviewed spans, and transcript cues to list missing spans, unassigned cues, and overlapping assignments.`;

const ASSEMBLY_NOTE = `No model call. Assembly walks drafted items in discussion order, numbers sections (Presentation is one section with 2.1, 2.2, … subsections), assigns letter markers on the full list, then moves restricted items to the addendum without renumbering public items. Procedural sentences (call to order, conclusion, addendum disclaimer) come from shared minutes boilerplate helpers.`;

/** Tabs for the V4 pipeline prompt modal, in reviewer order. */
export const MEETINGS_V4_PIPELINE_PROMPT_TABS: readonly MeetingsV4PromptTab[] = [
  {
    id: "segmentation",
    title: "Transcript segmentation",
    subtitle: "Upstream · prerequisite for V4",
    body: `${SEGMENTATION_NOTE}\n\n---\n\n${TRANSCRIPT_SYSTEM_PROMPT}`,
  },
  {
    id: "inventory",
    title: "Inventory",
    subtitle: "V4 stage · deterministic",
    body: INVENTORY_NOTE,
  },
  {
    id: "page_correction",
    title: "Agenda page correction",
    subtitle: "Upstream · corrected extract sent to draft",
    body: `Each draft call sends corrected-first agenda page text. When this meeting has no rewrites, V4 borrows corrected pages from a same-date V3 package. Pages without a rewrite use Docling text for that page only.\n\n---\n\n${PAGE_REWRITE_SYSTEM_PROMPT}`,
  },
  {
    id: "draft",
    title: "Draft minutes",
    subtitle: "V4 stage · one call per agenda leaf",
    body: MEETINGS_V4_DRAFT_PROMPT,
  },
  {
    id: "restricted",
    title: "Restricted classification",
    subtitle: "V4 draft · restricted flag on each item",
    body: MEETINGS_V4_RESTRICTED_CLASSIFICATION_PROMPT,
  },
  {
    id: "assembly",
    title: "Assemble minutes",
    subtitle: "V4 stage · deterministic",
    body: ASSEMBLY_NOTE,
  },
];
