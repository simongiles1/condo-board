export const INGEST_STAGES = [
  "a_ingest",
  "b_discover",
  "c_allowlist",
  "d_expand",
  "e1_docling",
  "e2_file_cards",
  "e3_embed",
  "e4_harvest",
  "done",
] as const;

export type IngestStage = (typeof INGEST_STAGES)[number];

export type IngestWaitKind = "allowlist" | "continue";

export function isIngestStage(value: string): value is IngestStage {
  return (INGEST_STAGES as readonly string[]).includes(value);
}

export function nextIngestStage(
  stage: IngestStage,
  options: { harvestEnabled: boolean },
): IngestStage {
  if (stage === "e3_embed" && !options.harvestEnabled) return "done";
  const index = INGEST_STAGES.indexOf(stage);
  if (index < 0 || index >= INGEST_STAGES.length - 1) return "done";
  return INGEST_STAGES[index + 1]!;
}

export function ingestStageLabel(stage: IngestStage): string {
  switch (stage) {
    case "a_ingest":
      return "Pull mail since last successful sync";
    case "b_discover":
      return "Find new From/To/CC addresses";
    case "c_allowlist":
      return "Confirm new allowlist senders";
    case "d_expand":
      return "Import full history for approved senders";
    case "e1_docling":
      return "Download attachments and run Docling/vision";
    case "e2_file_cards":
      return "Create file cards";
    case "e3_embed":
      return "Embed new emails and files";
    case "e4_harvest":
      return "Harvest contacts, orgs, events, and to-dos";
    case "done":
      return "Pipeline complete";
  }
}

export type IngestSenderReviewPublic = {
  id: string;
  email: string;
  status: "pending" | "approved" | "denied";
  sortIndex: number;
  estimatedThreadCount: number | null;
  estimatedEmailCount: number | null;
};

export type IngestRunPublic = {
  id: string;
  trigger: "cron" | "manual";
  status:
    | "running"
    | "waiting_allowlist"
    | "waiting_continue"
    | "completed"
    | "failed";
  stage: IngestStage;
  waitKind: IngestWaitKind | null;
  lastSuccessfulSyncAt: string | null;
  newEmailIds: string[];
  counts: Record<string, unknown>;
  cursorIndex: number;
  reminderSentAt: string | null;
  lastError: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  senders: IngestSenderReviewPublic[];
};
