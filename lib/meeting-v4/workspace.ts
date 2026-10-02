/**
 * Loads a V4 workspace from a V2 meeting that already has a reviewed segmentation.
 */

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  meetingsV2,
  meetingsV2AgendaItems,
  meetingsV2DocumentPages,
  meetingsV2TranscriptSegments,
  meetingsV3PageRewrites,
} from "@/lib/db/schema-v2";
import { readMeetingV2Settings, type MeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { readAgendaSourcePages } from "@/lib/meeting-v3/agenda-pages";
import { assembleMeetingsV4Minutes, type MeetingsV4AssemblyItem } from "@/lib/meeting-v4/assemble";
import { inventoryMeetingsV4, type MeetingsV4Inventory } from "@/lib/meeting-v4/inventory";
import type { MeetingsV4ItemResult, MeetingsV4Stored } from "@/lib/meeting-v4/types";

/** A V4 stage the route can reject with an HTTP status. */
export class MeetingsV4Error extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MeetingsV4Error";
    this.status = status;
  }
}

/** One agenda row used to draft and assemble. */
export type MeetingsV4AgendaRecord = {
  id: string;
  itemNumber: string;
  title: string;
  itemType: string;
  sectionLabel: string;
  sourceText: string;
  sourcePages: number[];
  sortOrder: number;
};

/** Transcript rows in segment-compare cue order. */
export type MeetingsV4CueRecord = {
  index: number;
  start: string;
  end: string;
  speaker: string;
  text: string;
};

/** Everything the V4 page shows for one meeting. */
export type MeetingsV4Workspace = {
  id: string;
  title: string;
  meetingDate: string;
  currentStep: string | null;
  goldUpdatedAt: string | null;
  inventory: MeetingsV4Inventory;
  draft: MeetingsV4Stored | null;
  markdown: string | null;
};

/**
 * The V4 page for a meeting that has a reviewed segmentation.
 * Returns null when the meeting does not exist. Throws when no reviewed spans are stored.
 */
export async function loadMeetingsV4Workspace(meetingId: string): Promise<MeetingsV4Workspace | null> {
  const loaded = await loadMeetingsV4Source(meetingId);
  if (!loaded) return null;
  const inventory = inventoryMeetingsV4({
    items: loaded.agenda,
    cues: loaded.cues,
    spans: loaded.spans,
  });
  const draft = loaded.settings.meetingsV4?.draftedAt ? loaded.settings.meetingsV4 : null;
  return {
    id: loaded.id,
    title: loaded.title,
    meetingDate: loaded.meetingDate,
    currentStep: loaded.settings.meetingsV4Run?.progress ?? null,
    goldUpdatedAt: loaded.settings.segmentGoldStandard?.updatedAt ?? null,
    inventory,
    draft,
    markdown: draft ? markdownFor(loaded, draft.items) : null,
  };
}

/**
 * Meetings that already have a reviewed segmentation.
 * The V4 list does not create a new meeting.
 */
export async function listMeetingsV4Sources(): Promise<Array<{
  id: string;
  title: string;
  meetingDate: string;
  spanCount: number;
  draftedAt: string | null;
}>> {
  const db = getDb();
  const rows = await db
    .select({
      id: meetingsV2.id,
      title: meetingsV2.title,
      meetingDate: meetingsV2.meetingDate,
      settings: meetingsV2.settings,
    })
    .from(meetingsV2);
  return rows.flatMap((row) => {
    const settings = readMeetingV2Settings(row.settings);
    const spanCount = settings.segmentGoldStandard?.spans?.length ?? 0;
    if (spanCount === 0) return [];
    return [{
      id: row.id,
      title: row.title,
      meetingDate: row.meetingDate,
      spanCount,
      draftedAt: settings.meetingsV4?.draftedAt ?? null,
    }];
  }).sort((left, right) => right.meetingDate.localeCompare(left.meetingDate) || left.title.localeCompare(right.title));
}

/** Agenda, cues, and reviewed spans for a draft run. */
export async function loadMeetingsV4Source(meetingId: string): Promise<{
  id: string;
  title: string;
  meetingDate: string;
  currentStep: string | null;
  settings: MeetingV2Settings;
  agenda: MeetingsV4AgendaRecord[];
  cues: MeetingsV4CueRecord[];
  pageText: Map<number, string>;
  spans: NonNullable<MeetingV2Settings["segmentGoldStandard"]>["spans"];
} | null> {
  const db = getDb();
  const [meeting] = await db
    .select({
      id: meetingsV2.id,
      title: meetingsV2.title,
      meetingDate: meetingsV2.meetingDate,
      currentStep: meetingsV2.currentStep,
      settings: meetingsV2.settings,
    })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  if (!meeting) return null;
  const settings = readMeetingV2Settings(meeting.settings);
  const spans = settings.segmentGoldStandard?.spans ?? [];
  if (spans.length === 0) {
    throw new MeetingsV4Error("This meeting has no reviewed transcript segmentation.", 404);
  }
  const [agendaRows, cueRows, storedPages, rewrites] = await Promise.all([
    db
      .select({
        id: meetingsV2AgendaItems.id,
        itemNumber: meetingsV2AgendaItems.itemNumber,
        title: meetingsV2AgendaItems.title,
        itemType: meetingsV2AgendaItems.itemType,
        sectionLabel: meetingsV2AgendaItems.sectionLabel,
        sourceText: meetingsV2AgendaItems.sourceText,
        sourcePagesJson: meetingsV2AgendaItems.sourcePagesJson,
        sortOrder: meetingsV2AgendaItems.sortOrder,
      })
      .from(meetingsV2AgendaItems)
      .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2AgendaItems.sortOrder)),
    db
      .select({
        startTimestamp: meetingsV2TranscriptSegments.startTimestamp,
        endTimestamp: meetingsV2TranscriptSegments.endTimestamp,
        speakerLabel: meetingsV2TranscriptSegments.speakerLabel,
        text: meetingsV2TranscriptSegments.text,
        sequence: meetingsV2TranscriptSegments.sequence,
      })
      .from(meetingsV2TranscriptSegments)
      .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2TranscriptSegments.sequence)),
    db
      .select({
        pageNumber: meetingsV2DocumentPages.pageNumber,
        extractedText: meetingsV2DocumentPages.extractedText,
      })
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId)),
    db
      .select({
        pageNumber: meetingsV3PageRewrites.pageNumber,
        correctedText: meetingsV3PageRewrites.correctedText,
      })
      .from(meetingsV3PageRewrites)
      .where(eq(meetingsV3PageRewrites.meetingV2Id, meetingId)),
  ]);
  const pageText = new Map<number, string>();
  for (const page of storedPages) {
    const extracted = page.extractedText.trim();
    if (extracted) pageText.set(page.pageNumber, extracted);
  }
  for (const page of rewrites) {
    const corrected = page.correctedText.trim();
    if (corrected) pageText.set(page.pageNumber, corrected);
  }
  return {
    id: meeting.id,
    title: meeting.title,
    meetingDate: meeting.meetingDate,
    currentStep: meeting.currentStep,
    settings,
    agenda: agendaRows.map((row) => ({
      id: row.id,
      itemNumber: row.itemNumber?.trim() || "",
      title: row.title,
      itemType: row.itemType,
      sectionLabel: row.sectionLabel?.trim() || "",
      sourceText: row.sourceText?.trim() || "",
      sourcePages: readAgendaSourcePages(row.sourcePagesJson),
      sortOrder: row.sortOrder,
    })),
    pageText,
    cues: cueRows.map((row, index) => ({
      index,
      start: row.startTimestamp,
      end: row.endTimestamp,
      speaker: row.speakerLabel?.trim() || "",
      text: row.text,
    })),
    spans,
  };
}

function markdownFor(
  loaded: NonNullable<Awaited<ReturnType<typeof loadMeetingsV4Source>>>,
  items: MeetingsV4ItemResult[],
): string | null {
  const byId = new Map(items.map((item) => [item.agendaItemId, item]));
  const assemblyItems: MeetingsV4AssemblyItem[] = loaded.agenda.map((item) => {
    const drafted = byId.get(item.id);
    return {
      ...(drafted ?? emptyResult(item)),
      itemType: item.itemType,
      sectionLabel: item.sectionLabel,
    };
  });
  try {
    return assembleMeetingsV4Minutes({
      title: loaded.title,
      meetingDate: loaded.meetingDate,
      items: assemblyItems,
    }).markdown;
  } catch (error) {
    console.error("[v4-assemble]", error instanceof Error ? error.message : error);
    return null;
  }
}

function emptyResult(item: MeetingsV4AgendaRecord): MeetingsV4ItemResult {
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
    motion: { mover: null, seconder: null, source: "unsupported" },
    restricted: false,
    restrictedReason: "",
    gaps: ["No reviewed transcript span was assigned to this item."],
    error: null,
  };
}
