import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2AgendaItems, meetingsV2DocumentPages } from "@/lib/db/schema";
import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { isDeepSeekKeyConfigured, type MeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { liveAgendaLeaves, type LiveAgendaSourceItem } from "@/lib/meeting-v2/live-agenda";

/** Last agenda page in the trimmed package, plus the attachment-page pass once it finishes. */
export type UpcomingMeetingSettings = {
  agendaContentEndsAtPage: number;
  attachmentAssignment?: {
    completedAt: string;
    assignedPageCount: number;
    unassignedPages: number[];
  };
};

/**
 * True when this workspace was created for a meeting that has not happened yet.
 */
export function isUpcomingMeeting(
  settings: MeetingV2Settings | null | undefined,
): boolean {
  return upcomingAgendaSplit(settings) != null;
}

/**
 * Last page of agenda content in the trimmed board package, when this is an upcoming meeting.
 */
export function upcomingAgendaSplit(
  settings: MeetingV2Settings | null | undefined,
): number | null {
  const page = settings?.upcomingMeeting?.agendaContentEndsAtPage;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) return null;
  return page;
}

/**
 * Accept a split only when the trimmed package has agenda pages and at least one attachment page.
 */
export function parseAgendaContentEndsAtPage(
  value: unknown,
  trimmedPageCount: number,
): number | null {
  const page = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(page) || page < 1) return null;
  if (trimmedPageCount < 2 || page >= trimmedPageCount) return null;
  return page;
}

export type AttachmentAssignmentInput = {
  leaves: Array<{ id: string; sourcePages: number[] }>;
  agendaContentEndsAtPage: number;
  attachmentPageNumbers: number[];
  assignments: Array<{ agendaItemId: string; pages: number[] }>;
};

/**
 * Put attachment pages on the assigned leaves and leave agenda-body pages where extract put them.
 * Pages in the attachment range are removed from every leaf before the new assignments are applied.
 */
export function applyAttachmentPageAssignments(input: AttachmentAssignmentInput): {
  pagesByLeafId: Map<string, number[]>;
  unassignedPages: number[];
} {
  const attachmentPages = new Set(
    input.attachmentPageNumbers.filter(
      (page) => Number.isInteger(page) && page > input.agendaContentEndsAtPage,
    ),
  );
  const leafIds = new Set(input.leaves.map((leaf) => leaf.id));
  const pagesByLeafId = new Map<string, number[]>();
  for (const leaf of input.leaves) {
    pagesByLeafId.set(
      leaf.id,
      uniqueSorted(leaf.sourcePages.filter((page) => !attachmentPages.has(page))),
    );
  }

  const claimed = new Set<number>();
  for (const assignment of input.assignments) {
    if (!leafIds.has(assignment.agendaItemId)) continue;
    const current = pagesByLeafId.get(assignment.agendaItemId) ?? [];
    const added = assignment.pages.filter(
      (page) => attachmentPages.has(page) && !claimed.has(page),
    );
    for (const page of added) claimed.add(page);
    pagesByLeafId.set(assignment.agendaItemId, uniqueSorted([...current, ...added]));
  }

  const unassignedPages = [...attachmentPages].filter((page) => !claimed.has(page)).sort((a, b) => a - b);
  return { pagesByLeafId, unassignedPages };
}

/**
 * Read attachment pages after the saved split and store which agenda leaf each one belongs to.
 * Throws when the model key is missing or the model response is not usable.
 */
export async function assignUpcomingAttachmentPages(meetingId: string): Promise<{
  assignedPageCount: number;
  unassignedPages: number[];
}> {
  const db = getDb();
  const [meeting] = await db.select().from(meetingsV2).where(eq(meetingsV2.id, meetingId));
  if (!meeting) {
    throw new Error(`V2 meeting ${meetingId} was not found.`);
  }
  const settings = (meeting.settings ?? {}) as MeetingV2Settings;
  const split = upcomingAgendaSplit(settings);
  if (split == null) {
    throw new Error("This meeting has no agenda/attachment split.");
  }
  if (settings.upcomingMeeting?.attachmentAssignment?.completedAt) {
    return {
      assignedPageCount: settings.upcomingMeeting.attachmentAssignment.assignedPageCount,
      unassignedPages: settings.upcomingMeeting.attachmentAssignment.unassignedPages,
    };
  }
  if (!isDeepSeekKeyConfigured()) {
    throw new Error("DEEPSEEK_API_KEY is required to link attachment pages to agenda items.");
  }

  const [itemRows, pageRows] = await Promise.all([
    db
      .select()
      .from(meetingsV2AgendaItems)
      .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId)),
    db
      .select({
        pageNumber: meetingsV2DocumentPages.pageNumber,
        heading: meetingsV2DocumentPages.pageHeading,
        text: meetingsV2DocumentPages.extractedText,
      })
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId)),
  ]);

  const leaves = liveAgendaLeaves(
    itemRows.map(
      (item): LiveAgendaSourceItem => ({
        id: item.id,
        itemNumber: item.itemNumber,
        title: item.title,
        sourceText: item.sourceText,
        sourcePagesJson: item.sourcePagesJson,
      }),
    ),
  );
  if (leaves.length === 0) {
    throw new Error("Agenda extraction produced no items to attach pages to.");
  }

  const attachmentPages = pageRows
    .filter((page) => page.pageNumber > split)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  const assignments: Array<{ agendaItemId: string; pages: number[] }> = [];

  for (let offset = 0; offset < attachmentPages.length; offset += 8) {
    const batch = attachmentPages.slice(offset, offset + 8);
    const response = await generateDeepSeekJson({
      systemInstruction: ATTACHMENT_ASSIGNMENT_PROMPT,
      userText: JSON.stringify({
        agendaItems: leaves.map((leaf) => ({
          id: leaf.id,
          itemNumber: leaf.itemNumber,
          title: leaf.title,
        })),
        pages: batch.map((page) => ({
          pageNumber: page.pageNumber,
          heading: page.heading,
          text: (page.text ?? "").slice(0, 1600),
        })),
      }),
      modelName: "deepseek-v4-flash",
      temperature: 0,
      thinking: false,
    });
    assignments.push(...parseAttachmentAssignments(response.text));
  }

  const applied = applyAttachmentPageAssignments({
    leaves,
    agendaContentEndsAtPage: split,
    attachmentPageNumbers: attachmentPages.map((page) => page.pageNumber),
    assignments,
  });

  for (const leaf of leaves) {
    const pages = applied.pagesByLeafId.get(leaf.id) ?? [];
    await db
      .update(meetingsV2AgendaItems)
      .set({ sourcePagesJson: JSON.stringify(pages) })
      .where(eq(meetingsV2AgendaItems.id, leaf.id));
  }

  const attachmentAssignment = {
    completedAt: new Date().toISOString(),
    assignedPageCount: attachmentPages.length - applied.unassignedPages.length,
    unassignedPages: applied.unassignedPages,
  };
  await db
    .update(meetingsV2)
    .set({
      settings: {
        ...settings,
        upcomingMeeting: {
          agendaContentEndsAtPage: split,
          attachmentAssignment,
        },
      },
      updatedAt: attachmentAssignment.completedAt,
    })
    .where(eq(meetingsV2.id, meetingId));

  return {
    assignedPageCount: attachmentAssignment.assignedPageCount,
    unassignedPages: applied.unassignedPages,
  };
}

const ATTACHMENT_ASSIGNMENT_PROMPT = `You link condominium board-package attachment pages to agenda items.
The agenda itself is already extracted. These pages are supporting material after the agenda.
Return JSON only: {"assignments":[{"agendaItemId":"<id>","pages":[13]}]}.
Rules:
- Use only agendaItemId values and pageNumber values from the input.
- Each page belongs to at most one agenda item.
- Match the page to the agenda item it supports (the matter named in the heading or body).
- Omit a page when it does not support any listed item.`;

function parseAttachmentAssignments(text: string): Array<{ agendaItemId: string; pages: number[] }> {
  const parsed = JSON.parse(text) as { assignments?: unknown };
  if (!Array.isArray(parsed.assignments)) {
    throw new Error("Attachment assignment response did not include assignments.");
  }
  return parsed.assignments.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as { agendaItemId?: unknown; pages?: unknown };
    if (typeof record.agendaItemId !== "string" || !Array.isArray(record.pages)) return [];
    const pages = record.pages.filter(
      (page): page is number => typeof page === "number" && Number.isInteger(page) && page > 0,
    );
    return [{ agendaItemId: record.agendaItemId, pages }];
  });
}

function uniqueSorted(pages: number[]): number[] {
  return [...new Set(pages)].sort((left, right) => left - right);
}
