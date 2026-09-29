import type { CompareAlignment } from "@/lib/minutes/gold-standard-schema";

/** Agenda row used to number compare nav entries and to tell headings from leaves. */
export type CompareAgendaRef = {
  title: string;
  itemNumber: string | null;
  visibility?: string | null;
};

/** One row in the gold-standard compare outline. */
export type CompareNavEntry = {
  alignmentId: string;
  number: string;
  label: string;
  depth: number;
  isLeaf: boolean;
  confidential: boolean;
};

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function codeDepth(code: string): number {
  const trimmed = code.trim();
  if (!trimmed) return 0;
  return trimmed.split(".").filter(Boolean).length - 1;
}

/**
 * Splits an official minutes heading into a display number, title, and indent depth.
 * Lettered items such as `4.1 … - (a) Title` are leaves.
 */
export function parseMinutesHeading(heading: string): Omit<CompareNavEntry, "alignmentId"> | null {
  let text = heading.trim();
  if (!text) return null;
  let confidential = false;
  if (/^addendum\b/i.test(text)) {
    confidential = true;
    text = text.replace(/^addendum\s*[-–—:]\s*/i, "").trim();
  }

  const lettered = text.match(/^(.*?)\s+[-–—]\s+\(([^)]+)\)\s+(.+)$/);
  if (lettered) {
    const parentCode = lettered[1].trim().match(/^(\d+(?:\.\d+)*)\b/)?.[1] ?? "";
    const depth = (parentCode ? codeDepth(parentCode) : 0) + 1;
    const number = parentCode ? `${parentCode}(${lettered[2]})` : `(${lettered[2]})`;
    return {
      number,
      label: lettered[3].trim(),
      depth,
      isLeaf: true,
      confidential,
    };
  }

  const numbered = text.match(/^(\d+(?:\.\d+)*)\.?\s+(.+)$/);
  if (numbered) {
    return {
      number: numbered[1],
      label: numbered[2].trim(),
      depth: codeDepth(numbered[1]),
      isLeaf: true,
      confidential,
    };
  }

  if (!confidential) return null;
  return {
    number: "",
    label: text || heading.trim(),
    depth: 1,
    isLeaf: true,
    confidential: true,
  };
}

function agendaHasChildren(itemNumber: string, items: CompareAgendaRef[]): boolean {
  const code = itemNumber.trim();
  if (!code) return false;
  const prefix = `${code}.`;
  return items.some((item) => (item.itemNumber || "").trim().startsWith(prefix));
}

function matchAgenda(label: string, items: CompareAgendaRef[]): CompareAgendaRef | null {
  const target = normalizeTitle(label);
  if (target.length < 8) return null;
  let best: CompareAgendaRef | null = null;
  let bestScore = 0;
  for (const item of items) {
    const title = normalizeTitle(item.title);
    if (!title) continue;
    if (title === target) return item;
    const contained = title.includes(target) || target.includes(title);
    const score = Math.min(title.length, target.length);
    if (contained && score >= 12 && score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Numbers and indents compare alignments from official headings, then agenda codes.
 * Section headings that still have children are not leaves, so they carry no description.
 */
export function buildCompareNavEntries(options: {
  alignments: CompareAlignment[];
  headingsByAlignmentId: Map<string, string>;
  agendaItems?: CompareAgendaRef[];
}): CompareNavEntry[] {
  const agendaItems = options.agendaItems ?? [];
  return options.alignments.map((alignment) => {
    const heading = options.headingsByAlignmentId.get(alignment.id) || alignment.label;
    const parsed = parseMinutesHeading(heading);
    const agenda =
      matchAgenda(parsed?.label || "", agendaItems) ??
      matchAgenda(heading, agendaItems) ??
      matchAgenda(alignment.label, agendaItems);
    const restricted = (agenda?.visibility || "").toUpperCase() === "RESTRICTED";
    const agendaLeaf = agenda?.itemNumber
      ? !agendaHasChildren(agenda.itemNumber, agendaItems)
      : true;
    const letteredLeaf = Boolean(parsed?.number.includes("("));

    if (parsed && (letteredLeaf || agendaLeaf)) {
      return {
        alignmentId: alignment.id,
        number: parsed.number,
        label: parsed.label,
        depth: parsed.depth,
        isLeaf: true,
        confidential: parsed.confidential || restricted,
      };
    }

    const number = agenda?.itemNumber?.trim() || parsed?.number || "";
    return {
      alignmentId: alignment.id,
      number,
      label: parsed?.label || alignment.label,
      depth: number ? codeDepth(number) : (parsed?.depth ?? 0),
      isLeaf: agenda ? agendaLeaf : true,
      confidential: Boolean(parsed?.confidential || restricted),
    };
  });
}
