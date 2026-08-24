import { createHash } from "node:crypto";

import type {
  meetingsV2DocumentPages,
  meetingsV2TranscriptSegments,
} from "@/lib/db/schema";

type DocumentPageRow = typeof meetingsV2DocumentPages.$inferSelect;
type TranscriptSegmentRow = typeof meetingsV2TranscriptSegments.$inferSelect;

export type DocumentChunk = {
  aiChunkId: string;
  chunkKey: string;
  chunkKind: "document";
  sortOrder: number;
  pageStart: number;
  pageEnd: number;
  pageNumbers: number[];
  text: string;
  metadata: {
    aiChunkId: string;
    chunkLabel: string;
    prevAiChunkId: string | null;
    nextAiChunkId: string | null;
    pageNumbers: number[];
  };
};

export type TranscriptChunk = {
  aiChunkId: string;
  chunkKey: string;
  chunkKind: "transcript";
  sortOrder: number;
  sequenceStart: number;
  sequenceEnd: number;
  startTimestamp: string;
  endTimestamp: string;
  text: string;
  metadata: {
    aiChunkId: string;
    chunkLabel: string;
    prevAiChunkId: string | null;
    nextAiChunkId: string | null;
    sequenceRange: [number, number];
  };
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function checksumFor(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function formatChunkOrdinal(prefix: "document_chunk" | "transcript_chunk", index: number): string {
  return `${prefix}_${String(index + 1).padStart(3, "0")}`;
}

export function chunkDocumentPages(pages: DocumentPageRow[]): DocumentChunk[] {
  const ordered = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const rawChunks: Array<Omit<DocumentChunk, "aiChunkId" | "metadata"> & { pageNumbers: number[] }> = [];
  let currentPages: DocumentPageRow[] = [];
  let currentLength = 0;

  for (const page of ordered) {
    const pageText = `PAGE ${page.pageNumber}\n${normalizeWhitespace(page.extractedText).slice(0, 2800)}`;
    const nextLength = currentLength + pageText.length;
    if (currentPages.length >= 5 || nextLength > 17500) {
      const text = currentPages
        .map((entry, idx) => {
          const isOverlap = rawChunks.length > 0 && idx < 1;
          const prefix = isOverlap ? `[PREVIOUS PAGE CONTEXT] PAGE ${entry.pageNumber}` : `PAGE ${entry.pageNumber}`;
          return `${prefix}\n${normalizeWhitespace(entry.extractedText).slice(0, 2800)}`;
        })
        .join("\n\n");
      const pageNumbers = currentPages.map((entry) => entry.pageNumber);
      rawChunks.push({
        chunkKey: `doc:${pageNumbers[0]}-${pageNumbers.at(-1)}:${checksumFor(text)}`,
        chunkKind: "document",
        sortOrder: rawChunks.length,
        pageStart: pageNumbers[0],
        pageEnd: pageNumbers.at(-1) ?? pageNumbers[0],
        pageNumbers,
        text,
      });
      const overlapPages = currentPages.slice(-1);
      currentPages = [...overlapPages];
      currentLength = currentPages.reduce((acc, entry) => {
        const entryText = `PAGE ${entry.pageNumber}\n${normalizeWhitespace(entry.extractedText).slice(0, 2800)}`;
        return acc + entryText.length + 2;
      }, 0) - (currentPages.length > 0 ? 2 : 0);
    }
    currentPages.push(page);
    currentLength += pageText.length;
  }

  if (currentPages.length > 0) {
    const text = currentPages
      .map((entry, idx) => {
        const isOverlap = rawChunks.length > 0 && idx < 1;
        const prefix = isOverlap ? `[PREVIOUS PAGE CONTEXT] PAGE ${entry.pageNumber}` : `PAGE ${entry.pageNumber}`;
        return `${prefix}\n${normalizeWhitespace(entry.extractedText).slice(0, 2800)}`;
      })
      .join("\n\n");
    const pageNumbers = currentPages.map((entry) => entry.pageNumber);
    rawChunks.push({
      chunkKey: `doc:${pageNumbers[0]}-${pageNumbers.at(-1)}:${checksumFor(text)}`,
      chunkKind: "document",
      sortOrder: rawChunks.length,
      pageStart: pageNumbers[0],
      pageEnd: pageNumbers.at(-1) ?? pageNumbers[0],
      pageNumbers,
      text,
    });
  }

  return rawChunks.map((chunk, index, allChunks) => {
    const aiChunkId = formatChunkOrdinal("document_chunk", index);
    return {
      aiChunkId,
      ...chunk,
      metadata: {
        aiChunkId,
        chunkLabel: `Document chunk ${index + 1} of ${allChunks.length}`,
        prevAiChunkId: index > 0 ? formatChunkOrdinal("document_chunk", index - 1) : null,
        nextAiChunkId:
          index < allChunks.length - 1 ? formatChunkOrdinal("document_chunk", index + 1) : null,
        pageNumbers: chunk.pageNumbers,
      },
    };
  });
}

export function chunkTranscriptSegments(segments: TranscriptSegmentRow[]): TranscriptChunk[] {
  const ordered = [...segments].sort((a, b) => a.sequence - b.sequence);
  const rawChunks: Array<
    Omit<TranscriptChunk, "aiChunkId" | "metadata">
  > = [];
  const maxSegmentsPerChunk = 250;
  const minSegmentsPerChunk = 150;
  const maxChunkChars = 35000;
  let currentSegments: TranscriptSegmentRow[] = [];
  let currentLength = 0;

  function pushChunk(slice: TranscriptSegmentRow[]) {
    if (slice.length === 0) return;
    const overlapBoundary = rawChunks.length > 0 ? 50 : 0;
    const text = slice
      .map((segment, idx) => {
        const isOverlap = idx < overlapBoundary;
        const prefix = isOverlap ? `[PREVIOUS TRANSCRIPT CONTEXT] ` : "";
        return `${prefix}[${segment.startTimestamp}-${segment.endTimestamp}] ${segment.speakerLabel ?? "Unknown"}: ${normalizeWhitespace(segment.text)}`;
      })
      .join("\n");
    const sequenceRange: [number, number] = [
      slice[0].sequence,
      slice[slice.length - 1].sequence,
    ];
    rawChunks.push({
      chunkKey: `tr:${sequenceRange[0]}-${sequenceRange[1]}:${checksumFor(text)}`,
      chunkKind: "transcript",
      sortOrder: rawChunks.length,
      sequenceStart: sequenceRange[0],
      sequenceEnd: sequenceRange[1],
      startTimestamp: slice[0].startTimestamp,
      endTimestamp: slice[slice.length - 1].endTimestamp,
      text,
    });
  }

  for (const segment of ordered) {
    const segmentText = `[${segment.startTimestamp}-${segment.endTimestamp}] ${segment.speakerLabel ?? "Unknown"}: ${normalizeWhitespace(segment.text)}`;
    const nextLength = currentLength + segmentText.length + (currentSegments.length > 0 ? 1 : 0);
    const reachedSegmentCap = currentSegments.length >= maxSegmentsPerChunk;
    const reachedLengthCap =
      currentSegments.length >= minSegmentsPerChunk && nextLength > maxChunkChars;

    if (currentSegments.length > 0 && (reachedSegmentCap || reachedLengthCap)) {
      pushChunk(currentSegments);
      const overlapSegments = currentSegments.slice(-50);
      currentSegments = [...overlapSegments];
      currentLength = currentSegments.reduce((acc, seg) => {
        const sText = `[${seg.startTimestamp}-${seg.endTimestamp}] ${seg.speakerLabel ?? "Unknown"}: ${normalizeWhitespace(seg.text)}`;
        return acc + sText.length + 1;
      }, 0) - (currentSegments.length > 0 ? 1 : 0);
    }

    currentSegments.push(segment);
    currentLength += segmentText.length + (currentSegments.length > 1 ? 1 : 0);
  }

  pushChunk(currentSegments);

  return rawChunks.map((chunk, index, allChunks) => {
    const aiChunkId = formatChunkOrdinal("transcript_chunk", index);
    return {
      aiChunkId,
      ...chunk,
      metadata: {
        aiChunkId,
        chunkLabel: `Transcript chunk ${index + 1} of ${allChunks.length}`,
        prevAiChunkId: index > 0 ? formatChunkOrdinal("transcript_chunk", index - 1) : null,
        nextAiChunkId:
          index < allChunks.length - 1 ? formatChunkOrdinal("transcript_chunk", index + 1) : null,
        sequenceRange: [chunk.sequenceStart, chunk.sequenceEnd] as [number, number],
      },
    };
  });
}
