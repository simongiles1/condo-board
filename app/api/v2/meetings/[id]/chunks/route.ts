import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { meetingsV2DocumentChunks } from "@/lib/db/schema-v2";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const chunkId = url.searchParams.get("chunkId");

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

    return NextResponse.json({ chunks: enriched });
  } catch (err) {
    console.error("[meetings/v2/chunks] Error:", err);
    return NextResponse.json({ error: "Failed to fetch chunks" }, { status: 500 });
  }
}
