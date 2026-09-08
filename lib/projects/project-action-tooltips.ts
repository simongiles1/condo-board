export type ProjectActionTooltipSection = {
  title?: string;
  items: string[];
};

export type ProjectActionTooltip = {
  title: string;
  summary: string;
  sections: ProjectActionTooltipSection[];
  /** Shown only when the action has meaningful database/storage egress impact. */
  egressNote?: string;
};

export type ProjectActionTooltipId =
  | "process_pending_merges"
  | "refresh"
  | "scan_management_reports";

/** Hover copy for Entities → Projects action buttons. */
export const PROJECT_ACTION_TOOLTIPS: Record<
  ProjectActionTooltipId,
  ProjectActionTooltip
> = {
  process_pending_merges: {
    title: "Process pending project merges",
    summary:
      "Re-syncs the project registry from extraction fingerprints and re-runs the mention matcher on unresolved observations.",
    sections: [
      {
        title: "What it does",
        items: [
          "Refreshes project_entities — names, aliases, contractor, year, and location from pass-4 cards.",
          "Scans unresolved and provisional mentions (up to 8,000 per run) and attaches them when the match is unambiguous.",
          "Leaves ambiguous or year-mismatched mentions in the Mentions tab for manual review.",
        ],
      },
      {
        title: "When to use",
        items: [
          "After re-harvesting threads or merging duplicate cards.",
          "When the Mentions count is non-zero and cards should have attached.",
        ],
      },
    ],
    egressNote:
      "Heavy database read/write — re-syncs the full registry and scans the mention queue. Run when needed, not after every email harvest.",
  },
  refresh: {
    title: "Refresh",
    summary:
      "Reloads the project list, header counts, and board-report badges from the server.",
    sections: [
      {
        title: "What it does",
        items: [
          "Fetches the latest registry cards and mention stats (unresolved, provisional, confirmed).",
          "Re-loads the Duplicates tab if you already opened it.",
          "Picks up board-report badges and scan status without starting a new scan.",
        ],
      },
    ],
  },
  scan_management_reports: {
    title: "Scan management reports",
    summary:
      "Scans monthly management reports and board-package report sections to tag projects the PM briefed the Board on.",
    sections: [
      {
        title: "What it does",
        items: [
          "Extracts work topics from converted management-report markdown.",
          "Matches topics onto registry cards by name, aliases, year, contractor, and location.",
          'Adds the emerald "Board · N" badge and enables the "In a management report" filter.',
        ],
      },
      {
        title: "Notes",
        items: [
          "Skips 100+ page packages until they are parsed; later runs pick them up.",
          "Re-match topics with AI reuses already-extracted headings — no PDF re-scan.",
        ],
      },
    ],
    egressNote:
      "Reads report markdown and project metadata from storage and the database; AI topic matching adds API cost. One-time scan per report batch.",
  },
};

export function getProjectActionTooltip(
  id: ProjectActionTooltipId,
): ProjectActionTooltip {
  return PROJECT_ACTION_TOOLTIPS[id];
}
