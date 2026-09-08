import { createHash } from "node:crypto";

import type {
  meetingsV2DocumentPages,
  meetingsV2TranscriptSegments,
} from "@/lib/db/schema";
import { formatChunkTextForDisplay } from "@/lib/meeting-v2/chunk-display";
import { buildSemanticDocumentSections } from "@/lib/meeting-v2/pdf";
import { formatReadableCueLine } from "@/lib/parsers/vtt";

export { formatChunkTextForDisplay };

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

function normalizeWhitespace(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function checksumFor(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function formatChunkOrdinal(prefix: "document_chunk" | "transcript_chunk", index: number): string {
  return `${prefix}_${String(index + 1).padStart(3, "0")}`;
}

function formatTranscriptSegmentLine(
  segment: TranscriptSegmentRow,
  isOverlap: boolean,
): string {
  const prefix = isOverlap ? `[PREVIOUS TRANSCRIPT CONTEXT] ` : "";
  return `${prefix}${formatReadableCueLine({
    start: segment.startTimestamp,
    speaker: segment.speakerLabel,
    text: segment.text,
  })}`;
}

export function chunkDocumentPages(
  pages: DocumentPageRow[],
  explicitSections?: Array<{ title: string; startPage: number; endPage: number }>,
): DocumentChunk[] {
  const ordered = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  if (ordered.length === 0) return [];

  const sections =
    explicitSections && explicitSections.length > 0
      ? explicitSections
      : buildSemanticDocumentSections(
          ordered.map((p) => ({
            pageNumber: p.pageNumber,
            heading: p.pageHeading,
            text: p.extractedText,
          })),
        );

  const pageByNumber = new Map(ordered.map((p) => [p.pageNumber, p] as const));
  const rawChunks: Array<Omit<DocumentChunk, "aiChunkId" | "metadata"> & { pageNumbers: number[] }> = [];

  for (const section of sections) {
    const sectionPages: DocumentPageRow[] = [];
    for (let pNum = section.startPage; pNum <= section.endPage; pNum++) {
      const p = pageByNumber.get(pNum);
      if (p) sectionPages.push(p);
    }
    if (sectionPages.length === 0) continue;

    let currentSlice: DocumentPageRow[] = [];
    let currentLength = 0;
    let partIndex = 1;

    const flushSlice = (slice: DocumentPageRow[], isMultiPart: boolean) => {
      if (slice.length === 0) return;
      const pageNumbers = slice.map((p) => p.pageNumber);
      const partSuffix = isMultiPart ? ` (Part ${partIndex})` : "";
      const header = `[SECTION: ${section.title}${partSuffix}] (Pages ${pageNumbers[0]}-${pageNumbers.at(-1)})`;
      const body = slice
        .map((entry) => `PAGE ${entry.pageNumber}\n${normalizeWhitespace(entry.extractedText || entry.text).slice(0, 3200)}`)
        .join("\n\n");
      const text = `${header}\n\n${body}`;

      rawChunks.push({
        chunkKey: `doc:${pageNumbers[0]}-${pageNumbers.at(-1)}:${checksumFor(text)}`,
        chunkKind: "document",
        sortOrder: rawChunks.length,
        pageStart: pageNumbers[0],
        pageEnd: pageNumbers.at(-1) ?? pageNumbers[0],
        pageNumbers,
        text,
      });
      partIndex++;
    };

    for (const page of sectionPages) {
      const pageTextLen = normalizeWhitespace(page.extractedText || page.text).length;
      if (currentSlice.length > 0 && currentLength + pageTextLen > 18000) {
        flushSlice(currentSlice, true);
        currentSlice = [];
        currentLength = 0;
      }
      currentSlice.push(page);
      currentLength += pageTextLen;
    }

    if (currentSlice.length > 0) {
      flushSlice(currentSlice, partIndex > 1);
    }
  }

  // Fallback if no sections were built
  if (rawChunks.length === 0 && ordered.length > 0) {
    const pageNumbers = ordered.map((entry) => entry.pageNumber);
    const text = ordered
      .map((entry) => `PAGE ${entry.pageNumber}\n${normalizeWhitespace(entry.extractedText || entry.text).slice(0, 3200)}`)
      .join("\n\n");
    rawChunks.push({
      chunkKey: `doc:${pageNumbers[0]}-${pageNumbers.at(-1)}:${checksumFor(text)}`,
      chunkKind: "document",
      sortOrder: 0,
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
  const maxSegmentsPerChunk = 80;
  const minSegmentsPerChunk = 40;
  const maxChunkChars = 35000;
  let currentSegments: TranscriptSegmentRow[] = [];
  let currentLength = 0;

  function pushChunk(slice: TranscriptSegmentRow[]) {
    if (slice.length === 0) return;
    const overlapBoundary = rawChunks.length > 0 ? 15 : 0;
    const text = slice
      .map((segment, idx) => formatTranscriptSegmentLine(segment, idx < overlapBoundary))
      .join("\n\n");
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
    const segmentText = formatTranscriptSegmentLine(segment, false);
    const nextLength = currentLength + segmentText.length + (currentSegments.length > 0 ? 2 : 0);
    const reachedSegmentCap = currentSegments.length >= maxSegmentsPerChunk;
    const reachedLengthCap =
      currentSegments.length >= minSegmentsPerChunk && nextLength > maxChunkChars;

    if (currentSegments.length > 0 && (reachedSegmentCap || reachedLengthCap)) {
      pushChunk(currentSegments);
      const overlapSegments = currentSegments.slice(-15);
      currentSegments = [...overlapSegments];
      currentLength = currentSegments.reduce((acc, seg) => {
        const sText = formatTranscriptSegmentLine(seg, false);
        return acc + sText.length + 2;
      }, 0) - (currentSegments.length > 0 ? 2 : 0);
    }

    currentSegments.push(segment);
    currentLength += segmentText.length + (currentSegments.length > 1 ? 2 : 0);
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

