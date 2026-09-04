export type ChunkContext = {
  chunkId: string;
  chunkKind: "document" | "transcript";
  chunkKey: string;
  chunkLabel: string | null;
  sortOrder: number;
  pageRange: [number, number] | null;
  sequenceRange: [number, number] | null;
  startTimestamp: string | null;
  endTimestamp: string | null;
  text: string;
  neighbors: {
    previous: string | null;
    next: string | null;
  };
};

export type AgendaItemContextDocument = {
  agendaItemId: string;
  title: string;
  sectionLabel: string | null;
  itemType: string;
  sourcePages: number[];
  sourceChunkIds: string[];
  sourceTranscriptRanges: Array<[number, number]>;
  aliases: string[];
  notes: string[];
  anchorChunkIds: string[];
  chunksById: Record<string, ChunkContext>;
  buildNotes: string[];
};

export { retrieveAgendaItemEvidence } from "@/lib/meeting-v2/service";
