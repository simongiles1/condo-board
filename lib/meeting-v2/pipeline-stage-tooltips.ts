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
          "Parse the VTT and merge consecutive same-speaker utterances into readable segments.",
          "Group readable segments into overlapping transcript chunks sized for LLM context (segment count and character limits, not a fixed clock interval).",
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
          "Repeat the same chunk walk on transcript chunks, carrying a floor pointer (the leaf item on the table at the start of the chunk).",
          "Walk cues in clock order. Each cue either opens a topic (or a new span of an existing one), enriches the floor item, or changes that item's lifecycle (assent, unmute, clerk wrap-up).",
          "Assent ratifies the floor item; it does not start the next outline number. The next item opens only when speakers name that matter.",
          "Link transcript chunk ids and time ranges to package topics. Add extraTopics for discussion that is not on the board package.",
        ],
      },
      {
        title: "Phase 3 — Span-edge review",
        items: [
          "After the chunk walk, review each leaf item's transcript spans in looping 1–2 minute windows (up to 12 loops / 24 minutes per span).",
          "Grow the span forward while the next window still belongs to that item; stop at the next named leaf or when the window is a new matter.",
          "Look 60 seconds before the span start to reclaim wrap-up that was given to the next item, and trim a start that opened too early.",
        ],
      },
      {
        title: "Phase 4 — Hole assignment",
        items: [
          "If a ranged leaf is followed by a later ranged leaf with unmatched package leaves in between, walk that hole in looping two-minute windows.",
          "Extend wrap-up of the current item; when speakers name an unmatched leaf (different unit, project, or heading), open that leaf. Overlap is allowed when wrap-up continues after the next matter is named.",
        ],
      },
      {
        title: "Phase 5 — Leftover holes",
        items: [
          "Walk remaining unboxed transcript stretches, including holes whose outline codes skip over an official item (for example next-meeting date between two ad-hoc 4.E items).",
          "Assign the hole to any still-unassigned agenda leaf when the talk matches that item.",
          "Then attach unmute / “move to the next item” wrap-up to the floor item without another model call, stopping when speakers name the next ranged matter.",
        ],
      },
      {
        title: "Output",
        items: [
          "When extract, span-edge, hole assignment, and leftover-hole passes finish, persist the topic JSON and materialize agenda-item rows in the database.",
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
          "Submit & Re-evaluate re-runs investigate and validate for that item only.",
          "Each re-evaluation is billed separately here — not folded into Investigate or Validate.",
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
