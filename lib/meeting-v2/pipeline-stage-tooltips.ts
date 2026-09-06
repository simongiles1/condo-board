export type PipelineStageTooltipSection = {
  title?: string;
  items: string[];
};

export type PipelineStageTooltip = {
  title: string;
  summary: string;
  sections: PipelineStageTooltipSection[];
};

/** Hover copy for each Meetings V2 pipeline / workflow stage in the AI usage modal. */
export const PIPELINE_STAGE_TOOLTIPS: Record<string, PipelineStageTooltip> = {
  ingest: {
    title: "Ingest",
    summary:
      "Prepares raw meeting sources so later stages can work from structured, searchable chunks.",
    sections: [
      {
        title: "Board package",
        items: [
          "Extract text from each PDF page via IBM Docling (watsonx).",
          "Split the package into document chunks — typically one page per chunk, with light overlap for heading continuity.",
          "Persist pages, sections, and chunks to the database.",
        ],
      },
      {
        title: "Transcript",
        items: [
          "Parse the VTT into timestamped speaker segments.",
          "Group segments into overlapping transcript chunks sized for LLM context (segment count and character limits, not a fixed clock interval).",
          "Store segments and chunks for extraction and evidence lookup.",
        ],
      },
    ],
  },
  extract: {
    title: "Extract",
    summary:
      "Builds an incremental agenda-topic map from the board package and transcript using a sliding chunk window.",
    sections: [
      {
        title: "Phase 1 — Document extraction",
        items: [
          "Start from an empty topic JSON, then walk document chunks in order.",
          "For each chunk, pass the previous, current, and next chunk plus the running JSON to the model.",
          "Identify agenda items in the current chunk: attach the chunk id to an existing item, or create a new item with that id.",
          "Add or refine a short summary on each touched item, then slide the window forward.",
        ],
      },
      {
        title: "Phase 2 — Transcript extraction",
        items: [
          "Repeat the same sliding-window pattern on transcript chunks.",
          "Link transcript chunk ids and time ranges to package topics where they match.",
          "Add extraTopics for discussion that appears in the transcript but not in the board package.",
        ],
      },
      {
        title: "Output",
        items: [
          "When both passes finish, persist the topic JSON and materialize agenda-item rows in the database.",
        ],
      },
    ],
  },
  evidence: {
    title: "Evidence",
    summary:
      "Groups source material around each agenda item so investigation has a focused evidence bundle.",
    sections: [
      {
        items: [
          "Walk every extracted agenda item and enrich it with provenance from extraction (source pages, chunk ids, transcript ranges).",
          "Resolve anchor document and transcript chunks tied to each item.",
          "Attach matching document pages, section headings, and transcript segments with relevance scores.",
          "Assemble a per-item context document (assembled text + chunk references) stored for Investigate and Validate.",
        ],
      },
    ],
  },
  investigate: {
    title: "Investigate",
    summary:
      "Determines what actually happened for each agenda item — outcome, motions, and open questions.",
    sections: [
      {
        items: [
          "Process one agenda item at a time with its full enriched evidence context.",
          "Ask the model: given everything gathered so far, what was the outcome? Who moved and seconded? What actions or deferrals apply?",
          "Optional tool calls can pull adjacent chunks (e.g. earlier transcript context around a chunk id) when the bundled evidence is not enough.",
          "Store discussion summary, outcome, confidence, motions, actions, and open questions per item.",
        ],
      },
    ],
  },
  validate: {
    title: "Validate",
    summary:
      "Independent review pass that checks investigation results against the evidence and flags anything a human should see.",
    sections: [
      {
        items: [
          "Run deterministic checks first (missing evidence, outcome vs. transcript support, motion gaps, etc.).",
          "Then an independent AI reviewer evaluates whether the investigation is supported by the assembled context.",
          "When evidence clearly supports approval but the outcome was not marked approved, validation may upgrade it.",
          "Creates validation flags (info / warning / error) for human review — especially when this phase changes or overrides investigation output.",
        ],
      },
    ],
  },
  agenda_review: {
    title: "Agenda review",
    summary: "Manual review step after the automated pipeline completes.",
    sections: [
      {
        items: [
          "Review each agenda item in the Agenda Review tab.",
          "Answer open questions or add clarifications where the pipeline was uncertain.",
          "Re-evaluate individual items without re-running the full pipeline.",
          "No API usage — this is human judgment on top of automated output.",
        ],
      },
    ],
  },
  draft_generated: {
    title: "Draft generated",
    summary: "Formats validated meeting output into editable minutes.",
    sections: [
      {
        items: [
          "After validation (and ideally agenda review), generate a structured minutes draft from pipeline results.",
          "Edit in the Draft Preview tab or export to PDF.",
          "No additional pipeline API usage for this formatting step.",
        ],
      },
    ],
  },
};

export function getPipelineStageTooltip(stageId: string): PipelineStageTooltip | null {
  return PIPELINE_STAGE_TOOLTIPS[stageId] ?? null;
}
