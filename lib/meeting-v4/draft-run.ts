/**
 * Drafts V4 minutes from the reviewed segmentation.
 * Each call receives that item's corrected agenda-page extract and transcript cues.
 */

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2MinutesDrafts } from "@/lib/db/schema-v2";
import { DEEPSEEK_COMPLETION_MODEL, generateDeepSeekJson } from "@/lib/deepseek/client";
import { readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { agendaTextForItem } from "@/lib/meeting-v4/agenda-text";
import { bundleCuesForItem, inventoryMeetingsV4 } from "@/lib/meeting-v4/inventory";
import { MEETINGS_V4_DRAFT_PROMPT, readMeetingsV4Draft } from "@/lib/meeting-v4/prompt";
import type { MeetingsV4ItemResult, MeetingsV4Stored } from "@/lib/meeting-v4/types";
import {
  loadMeetingsV4Source,
  loadMeetingsV4Workspace,
  type MeetingsV4AgendaRecord,
  type MeetingsV4Workspace,
} from "@/lib/meeting-v4/workspace";

const DRAFT_CONCURRENCY = 3;

/**
 * Writes a paragraph and evidence notes for every leaf, then stores the draft.
 * A leaf with no reviewed cues is stored as missing transcript and is not sent to the model.
 */
export async function draftMeetingsV4(meetingId: string): Promise<MeetingsV4Workspace> {
  const source = await loadMeetingsV4Source(meetingId);
  if (!source) {
    throw new Error("Meeting not found.");
  }
  const inventory = inventoryMeetingsV4({
    items: source.agenda,
    cues: source.cues,
    spans: source.spans,
  });
  const headings = new Set(inventory.items.filter((item) => item.heading).map((item) => item.id));
  const leaves = source.agenda.filter((item) => !headings.has(item.id));
  const results: MeetingsV4ItemResult[] = leaves.map((item) => ({
    ...blankItem(item),
    bundle: {
      agendaText: agendaTextForItem({
        sourcePages: item.sourcePages,
        pageText: source.pageText,
        fallback: item.sourceText || item.title,
      }),
      cues: bundleCuesForItem(item.id, source.cues, source.spans).map((cue) => ({
        index: cue.index,
        start: cue.start,
        end: cue.end,
        speaker: cue.speaker,
        text: cue.text,
      })),
      attachmentPages: [],
    },
  }));
  for (const item of results) {
    if (item.bundle.cues.length > 0) continue;
    item.evidenceFit = "transcript_missing";
    item.gaps = ["No reviewed transcript span was assigned to this item."];
  }
  const targets = results.filter((item) => item.bundle.cues.length > 0);
  let finished = 0;
  await setStep(meetingId, `Drafting minutes 0 of ${targets.length}`);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < targets.length) {
      const index = next;
      next += 1;
      const item = targets[index];
      if (!item) continue;
      await writeOne(item);
      finished += 1;
      await setStep(meetingId, `Drafting minutes ${finished} of ${targets.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(DRAFT_CONCURRENCY, targets.length) }, () => worker()));

  const stored: MeetingsV4Stored = {
    draftedAt: new Date().toISOString(),
    modelName: DEEPSEEK_COMPLETION_MODEL,
    items: results,
  };
  const db = getDb();
  const [row] = await db
    .select({ settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(row?.settings);
  const now = new Date().toISOString();
  const draftId = randomUUID();
  await db
    .update(meetingsV2)
    .set({
      settings: { ...settings, meetingsV4: stored, meetingsV4Run: null },
      updatedAt: now,
    })
    .where(eq(meetingsV2.id, meetingId));
  await db.insert(meetingsV2MinutesDrafts).values({
    id: draftId,
    meetingV2Id: meetingId,
    format: "minutes_v4",
    title: `${source.title} V4 draft`,
    contentMarkdown: "",
    summaryJson: JSON.stringify({ itemCount: results.length, draftedAt: stored.draftedAt }),
    modelName: DEEPSEEK_COMPLETION_MODEL,
    createdAt: now,
    updatedAt: now,
  });
  const workspace = await loadMeetingsV4Workspace(meetingId);
  if (!workspace) throw new Error("Meeting not found.");
  if (workspace.markdown) {
    await db
      .update(meetingsV2MinutesDrafts)
      .set({ contentMarkdown: workspace.markdown, updatedAt: new Date().toISOString() })
      .where(eq(meetingsV2MinutesDrafts.id, draftId));
  }
  return workspace;
}

async function writeOne(item: MeetingsV4ItemResult): Promise<void> {
  try {
    const response = await generateDeepSeekJson({
      systemInstruction: MEETINGS_V4_DRAFT_PROMPT,
      userText: JSON.stringify({
        topic: item.title,
        itemNumber: item.itemNumber,
        agenda: item.bundle.agendaText,
        transcript: item.bundle.cues.map((cue) => ({
          speaker: cue.speaker,
          start: cue.start,
          end: cue.end,
          text: cue.text,
        })),
        attachments: item.bundle.attachmentPages,
      }),
      modelName: DEEPSEEK_COMPLETION_MODEL,
      temperature: 0,
      thinking: false,
      maxOutputTokens: 2000,
    });
    const parsed = readMeetingsV4Draft(response.text);
    if (!parsed) {
      item.error = "The model reply was not usable JSON.";
      return;
    }
    item.minutes = parsed.minutes;
    item.findings = parsed.findings;
    item.evidenceFit = parsed.evidenceFit;
    item.amount = parsed.amount;
    item.amountBasis = parsed.amountBasis;
    item.actions = parsed.actions;
    item.motion = parsed.motion;
    item.restricted = parsed.restricted;
    item.restrictedReason = parsed.restrictedReason;
    item.gaps = parsed.gaps;
  } catch (error) {
    item.error = error instanceof Error ? error.message : "The draft call failed.";
  }
}

function blankItem(item: MeetingsV4AgendaRecord): MeetingsV4ItemResult {
  return {
    agendaItemId: item.id,
    itemNumber: item.itemNumber,
    title: item.title,
    bundle: { agendaText: item.sourceText || item.title, cues: [], attachmentPages: [] },
    minutes: null,
    findings: [],
    evidenceFit: "transcript_missing",
    amount: "not applicable",
    amountBasis: "",
    actions: [],
    motion: { mover: null, seconder: null, resolution: null, outcome: "unrecorded", source: "unsupported" },
    restricted: false,
    restrictedReason: "",
    gaps: item.sourceText ? [] : ["No reviewed transcript span was assigned to this item."],
    error: null,
  };
}

async function setStep(meetingId: string, progress: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(row?.settings);
  await db
    .update(meetingsV2)
    .set({
      settings: { ...settings, meetingsV4Run: { progress } },
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meetingsV2.id, meetingId));
}
