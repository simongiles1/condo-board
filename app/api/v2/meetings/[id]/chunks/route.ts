import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { meetingsV2AgendaItems, meetingsV2DocumentChunks } from "@/lib/db/schema-v2";
import {
  parseClockToSeconds,
  parseDiscussionTimestampRanges,
} from "@/lib/meeting-v2/agenda-outline";
import { discussionTimingFromSourceText } from "@/lib/transcript/section-overlay";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const chunkId = url.searchParams.get("chunkId");
    const agendaItemId = url.searchParams.get("agendaItemId");

    const db = getDb();
    const chunks = await db
      .select({
        id: meetingsV2DocumentChunks.id,
        chunkKey: meetingsV2DocumentChunks.chunkKey,
        chunkKind: meetingsV2DocumentChunks.chunkKind,
        sortOrder: meetingsV2DocumentChunks.sortOrder,
        pageStart: meetingsV2DocumentChunks.pageStart,
        pageEnd: meetingsV2DocumentChunks.pageEnd,
        sequenceStart: meetingsV2DocumentChunks.sequenceStart,
        sequenceEnd: meetingsV2DocumentChunks.sequenceEnd,
        startTimestamp: meetingsV2DocumentChunks.startTimestamp,
        endTimestamp: meetingsV2DocumentChunks.endTimestamp,
        text: meetingsV2DocumentChunks.text,
        metadataJson: meetingsV2DocumentChunks.metadataJson,
      })
      .from(meetingsV2DocumentChunks)
      .where(eq(meetingsV2DocumentChunks.meetingV2Id, id))
      .orderBy(asc(meetingsV2DocumentChunks.sortOrder));

    const enriched = chunks.map((chunk) => {
      let aiChunkId = chunk.chunkKind === "document"
        ? `document_chunk_${String(chunk.sortOrder + 1).padStart(3, "0")}`
        : `transcript_chunk_${String(chunk.sortOrder + 1).padStart(3, "0")}`;
      let chunkLabel = "";
      let pageNumbers: number[] = [];

      try {
        if (chunk.metadataJson) {
          const parsed = JSON.parse(chunk.metadataJson);
          if (parsed.aiChunkId) aiChunkId = parsed.aiChunkId;
          if (parsed.chunkLabel) chunkLabel = parsed.chunkLabel;
          if (Array.isArray(parsed.pageNumbers)) pageNumbers = parsed.pageNumbers;
        }
      } catch {
        // ignore
      }

      return {
        id: chunk.id,
        aiChunkId,
        chunkLabel,
        chunkKind: chunk.chunkKind,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        pageNumbers,
        startTimestamp: chunk.startTimestamp,
        endTimestamp: chunk.endTimestamp,
        text: chunk.text,
        sortOrder: chunk.sortOrder,
      };
    });

    if (chunkId) {
      const match = enriched.find(
        (c) => c.aiChunkId.toLowerCase() === chunkId.toLowerCase() || c.id === chunkId,
      );
      if (!match) {
        return NextResponse.json({ error: "Chunk not found" }, { status: 404 });
      }
      return NextResponse.json({ chunk: match });
    }

    if (agendaItemId) {
      const [item] = await db
        .select({
          id: meetingsV2AgendaItems.id,
          title: meetingsV2AgendaItems.title,
          itemNumber: meetingsV2AgendaItems.itemNumber,
          sourceText: meetingsV2AgendaItems.sourceText,
          sourcePagesJson: meetingsV2AgendaItems.sourcePagesJson,
        })
        .from(meetingsV2AgendaItems)
        .where(
          and(
            eq(meetingsV2AgendaItems.id, agendaItemId),
            eq(meetingsV2AgendaItems.meetingV2Id, id),
          ),
        );
      if (!item) {
        return NextResponse.json({ error: "Agenda item not found" }, { status: 404 });
      }

      const namedIds = new Set(
        (item.sourceText?.match(/Chunk IDs:\s*([^\n]+)/i)?.[1] ?? "")
          .split(/[,;]/)
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      );
      let sourcePages: number[] = [];
      try {
        const parsed = JSON.parse(item.sourcePagesJson || "[]") as unknown;
        if (Array.isArray(parsed)) {
          sourcePages = parsed.filter((page): page is number => typeof page === "number");
        }
      } catch {
        sourcePages = [];
      }
      const timing = parseDiscussionTimestampRanges(
        discussionTimingFromSourceText(item.sourceText),
      );

      const matched = enriched.filter((chunk) => {
        if (namedIds.has(chunk.aiChunkId.toLowerCase()) || namedIds.has(chunk.id.toLowerCase())) {
          return true;
        }
        if (chunk.chunkKind === "document") {
          const pages =
            chunk.pageNumbers.length > 0
              ? chunk.pageNumbers
              : [chunk.pageStart, chunk.pageEnd].filter(
                  (page): page is number => typeof page === "number",
                );
          return pages.some((page) => sourcePages.includes(page));
        }
        if (timing.length === 0) return false;
        const start = parseClockToSeconds(chunk.startTimestamp);
        const end = parseClockToSeconds(chunk.endTimestamp) ?? start;
        if (start === null) return false;
        const endSeconds = end ?? start;
        return timing.some(
          (range) => start <= range.endSeconds && endSeconds >= range.startSeconds,
        );
      });

      matched.sort((left, right) => {
        if (left.chunkKind !== right.chunkKind) {
          return left.chunkKind === "transcript" ? -1 : 1;
        }
        return left.sortOrder - right.sortOrder;
      });

      return NextResponse.json({
        agendaItem: {
          id: item.id,
          title: item.title,
          itemNumber: item.itemNumber,
        },
        chunks: matched,
      });
    }

    return NextResponse.json({ chunks: enriched });
  } catch (err) {
    console.error("[meetings/v2/chunks] Error:", err);
    return NextResponse.json({ error: "Failed to fetch chunks" }, { status: 500 });
  }
}
