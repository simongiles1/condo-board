import type {
  ActionItemV2,
  AgendaItemV2,
  AttendeeV2,
  MotionV2,
} from "@/lib/minutes/schema-v2";
import { stripLeadingThatFromResolution } from "@/lib/minutes/schema-v2";

export function letterMarker(index: number): string {
  return `(${String.fromCharCode(97 + index)})`;
}

export function romanMarker(index: number): string {
  const romans = [
    "i",
    "ii",
    "iii",
    "iv",
    "v",
    "vi",
    "vii",
    "viii",
    "ix",
    "x",
  ];
  return `${romans[index] ?? String(index + 1)})`;
}

/** ISO or display date → "Monday, March 23, 2026". */
export function formatMeetingDateDisplay(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const trimmed = dateStr.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
  }
  return trimmed;
}

export function formatAttendeeLine(a: AttendeeV2): string {
  const role = a.titleOrRole.trim();
  const company = a.company?.trim();
  if (role && company) return `${a.name} - ${role}, ${company}`;
  if (role) return `${a.name} - ${role}`;
  return a.name;
}

export function meetingMediumFromMetadata(platform?: string): string {
  const p = platform?.trim().toLowerCase() ?? "";
  if (!p) return "virtually";
  if (p.includes("person") || p === "in-person" || p === "in person") {
    return "in person";
  }
  if (p.includes("virtual") || p.includes("zoom") || p.includes("teams")) {
    return "virtually";
  }
  return platform?.trim() || "virtually";
}

export function formatMeetingTimeClause(time: string | undefined): string {
  if (!time) return "";
  const trimmed = time.trim().replace(/\.+$/, "");
  return trimmed ? ` at ${trimmed}.` : "";
}

export type RenderedMotionLines = {
  lines: string[];
};

export function renderMotionLines(motion: MotionV2): RenderedMotionLines {
  const status = motion.status.trim() || "Motion carried.";
  return {
    lines: [
      `**MOTION by ${motion.movedBy.trim()}**`,
      `**Seconded by ${motion.secondedBy.trim()}**`,
      `**THAT ${stripLeadingThatFromResolution(motion.resolutionText)}**`,
      `**${status}**`,
    ],
  };
}

export function renderActionLine(action: ActionItemV2): string {
  const desc = action.taskDescription.trim();
  return `**Action: ${desc}**`.replace(/\s+/g, " ");
}

/** Status values suppressed entirely from the rendered document. */
const SUPPRESSED_AGENDA_STATUSES = new Set(["Information only.", "Information only"]);

/** Status values that render in bold inline (alongside any "Action:" prefix). */
const BOLD_AGENDA_STATUSES = new Set([
  "Pending.",
  "Pending",
  "Deferred.",
  "Deferred",
]);

export function shouldRenderAgendaStatus(
  status: string | undefined | null,
): boolean {
  if (!status) return false;
  const t = status.trim();
  return t.length > 0 && !SUPPRESSED_AGENDA_STATUSES.has(t);
}

export function shouldBoldAgendaStatus(status: string): boolean {
  const t = status.trim();
  return BOLD_AGENDA_STATUSES.has(t) || /^action:/i.test(t);
}

/** Markdown for a status, e.g. "**Pending.**" or "No action required." or "". */
export function renderInlineStatusMarkdown(status: string | undefined): string {
  if (!shouldRenderAgendaStatus(status)) return "";
  const t = (status as string).trim();
  return shouldBoldAgendaStatus(t) ? `**${t}**` : t;
}

/**
 * Concatenated " Action: ... [Pending.]" tail joined by newlines.
 * Callers prepend a double newline when joining to the preceding body text.
 */
export function inlineAgendaItemSuffixMarkdown(item: AgendaItemV2): string {
  const parts: string[] = [];
  for (const a of item.actionItems) {
    parts.push(renderActionLine(a));
  }
  const statusPart = renderInlineStatusMarkdown(item.status);
  if (statusPart) parts.push(statusPart);
  return parts.join("\n\n");
}

/** Glue summary and inline tail with newlines, tolerating empties. */
export function joinSummaryWithTail(summary: string, tail: string): string {
  if (!summary) return tail;
  if (!tail) return summary;
  return `${summary}\n\n${tail}`;
}

export type AgendaRenderOptions = {
  /** Indent continuations in markdown (spaces per level). */
  markdownIndent?: number;
  style?: "markdown" | "plain";
};

function renderAgendaItemMarkdown(
  item: AgendaItemV2,
  marker: string,
  indentLevel: number,
): string[] {
  const lines: string[] = [];
  const base = "  ".repeat(indentLevel);
  const cont = "  ".repeat(indentLevel + 1);
  const topic = item.topic.trim();
  const body = joinSummaryWithTail(
    item.summary.trim(),
    inlineAgendaItemSuffixMarkdown(item),
  );

  const head = topic
    ? `${base}- **${marker}** ${topic}${body ? " –" : ""}`
    : `${base}- **${marker}**`;

  lines.push(head);
  if (body) {
    lines.push(`${cont}${body}`);
  }

  if (item.motion) {
    for (const ml of renderMotionLines(item.motion).lines) {
      lines.push(`${cont}${ml}`);
    }
  }

  item.subItems.forEach((sub, idx) => {
    lines.push(
      ...renderAgendaItemMarkdown(sub, romanMarker(idx), indentLevel + 1),
    );
  });

  return lines;
}

export function renderAgendaItemsMarkdown(items: AgendaItemV2[]): string[] {
  const lines: string[] = [];
  items.forEach((item, idx) => {
    lines.push(...renderAgendaItemMarkdown(item, letterMarker(idx), 0));
    lines.push("");
  });
  return lines;
}

export function renderSubsectionHeading(
  number: string,
  title: string,
  lead?: string,
): string {
  if (lead?.trim()) {
    return `### ${number} ${title} – ${lead.trim()}`;
  }
  return `### ${number} ${title}`;
}

export function renderFinancialSubsectionMarkdown(
  sectionNumber: string,
  item: AgendaItemV2,
  index: number,
): string[] {
  const subNum = `${sectionNumber}.${index + 1}`;
  const topic = item.topic.trim();
  const summary = item.summary.trim();
  const lines: string[] = [
    renderSubsectionHeading(subNum, topic, summary.split(".")[0] !== summary ? undefined : undefined),
  ];

  if (summary) {
    lines.push("");
    lines.push(summary);
    lines.push("");
  }

  if (item.actionItems.length || item.motion || item.subItems.length || item.status) {
    lines.push(...renderAgendaItemsMarkdown([{ ...item, topic: "", summary: "" }]));
  }

  return lines;
}

/** Flat financial/management subsection: "3.1 Topic – lead" with body. */
export function renderNumberedTopicMarkdown(
  number: string,
  item: AgendaItemV2,
): string[] {
  const topic = item.topic.trim();
  const summary = item.summary.trim();
  const lines: string[] = [];

  if (topic && summary) {
    lines.push(`### ${number} ${topic} – ${summary.split(". ")[0]}`);
    lines.push("");
    const rest = summary.includes(". ")
      ? summary.slice(summary.indexOf(". ") + 2)
      : "";
    if (rest) {
      lines.push(rest);
      lines.push("");
    } else if (!item.subItems.length && !item.motion && !item.actionItems.length) {
      lines.push(summary);
      lines.push("");
    }
  } else {
    lines.push(renderSubsectionHeading(number, topic || "Item"));
    lines.push("");
    if (summary) {
      lines.push(summary);
      lines.push("");
    }
  }

  const bodyItems: AgendaItemV2[] = [];
  if (
    item.subItems.length ||
    item.motion ||
    item.actionItems.length ||
    item.status
  ) {
    bodyItems.push({
      topic: "",
      summary: "",
      actionItems: item.actionItems,
      subItems: item.subItems,
      motion: item.motion,
      status: item.status,
    });
  }

  if (bodyItems.length) {
    lines.push(...renderAgendaItemsMarkdown(bodyItems));
  }

  return lines;
}
