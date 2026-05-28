import type {
  Block,
  ListItem,
  MinutesDocument,
  Section,
} from "@/lib/minutes/schema";

function formatAttendeeLine(a: { name: string; role: string }): string {
  const role = a.role.trim();
  return role ? `${a.name} - ${role}` : a.name;
}

/** Lines for blocks nested inside a list item (no leading indent). */
function blockToContinuations(block: Block): string[] {
  switch (block.kind) {
    case "paragraph": {
      const t = block.text.trim();
      return t ? [t] : [];
    }
    case "motion": {
      const out = block.outcome.trim() || "Motion carried.";
      return [
        `**MOTION by ${block.mover.trim()}**`,
        `**Seconded by ${block.seconder.trim()}**`,
        `**THAT ${block.resolution.trim()}**`,
        `**${out}**`,
      ];
    }
    case "action": {
      return [`**Action: ${block.text.trim()}**`];
    }
    case "note": {
      return [`*${block.text.trim()}*`];
    }
    default:
      return [];
  }
}

/**
 * Markdown list item with GFM-style continuations so UI previews indent body
 * text under (a) / i) markers.
 */
function renderListItemMd(
  item: ListItem,
  style: "letter" | "roman",
  indentLevel: number,
): string[] {
  void style;
  const base = "  ".repeat(indentLevel);
  const cont = "  ".repeat(indentLevel + 1);
  const marker = item.marker.trim();
  const title = item.title?.trim() ?? "";

  const head = title
    ? `${base}- **${marker}** ${title}${/[–—-]\s*$/.test(title) ? "" : " –"}`
    : `${base}- **${marker}**`;

  const lines: string[] = [head];

  for (const b of item.blocks) {
    if (b.kind === "list") {
      for (const sub of b.items) {
        lines.push(...renderListItemMd(sub, b.style, indentLevel + 1));
      }
    } else {
      for (const raw of blockToContinuations(b)) {
        if (raw) lines.push(`${cont}${raw}`);
      }
    }
  }

  return lines;
}

function renderListBlock(block: Extract<Block, { kind: "list" }>): string[] {
  const lines: string[] = [];
  for (const item of block.items) {
    lines.push(...renderListItemMd(item, block.style, 0));
  }
  return lines;
}

/** Paragraphs / motions at section body (not inside a list item). */
function renderFlatBlock(block: Exclude<Block, { kind: "list" }>): string[] {
  switch (block.kind) {
    case "paragraph": {
      const t = block.text.trim();
      return t ? [t] : [];
    }
    case "motion": {
      const out = block.outcome.trim() || "Motion carried.";
      return [
        `**MOTION by ${block.mover.trim()}**`,
        `**Seconded by ${block.seconder.trim()}**`,
        `**THAT ${block.resolution.trim()}**`,
        `**${out}**`,
      ];
    }
    case "action": {
      return [`**Action: ${block.text.trim()}**`];
    }
    case "note": {
      return [`*${block.text.trim()}*`];
    }
    default:
      return [];
  }
}

function renderSection(section: Section, depth: number): string[] {
  const lines: string[] = [];
  const num = section.number.trim();
  const title = section.title.trim();
  const isTopLevel = depth === 0 && /^\d+$/.test(num);

  if (isTopLevel) {
    lines.push(`## ${num}. ${title.toUpperCase()}`);
  } else {
    const lead = section.lead?.trim();
    const head = lead
      ? `### ${num} ${title} – ${lead}`
      : `### ${num} ${title}`;
    lines.push(head);
  }

  lines.push("");

  for (const b of section.blocks) {
    if (b.kind === "list") {
      lines.push(...renderListBlock(b));
      lines.push("");
    } else {
      lines.push(...renderFlatBlock(b));
      lines.push("");
    }
  }

  for (const sub of section.subsections ?? []) {
    lines.push(...renderSection(sub, depth + 1));
  }

  return lines;
}

/** Deterministic markdown for TipTap seed + preview parity with PDF source. */
export function jsonToMarkdown(doc: MinutesDocument): string {
  const lines: string[] = [];

  lines.push("Present:");
  for (const a of doc.present) {
    lines.push(formatAttendeeLine(a));
  }
  lines.push("");
  lines.push("By Invitation:");
  for (const a of doc.byInvitation) {
    lines.push(formatAttendeeLine(a));
  }
  if (doc.regrets.length > 0) {
    lines.push("");
    lines.push("Regrets:");
    for (const a of doc.regrets) {
      lines.push(formatAttendeeLine(a));
    }
  }

  lines.push("");

  for (const section of doc.sections) {
    lines.push(...renderSection(section, 0));
    lines.push("");
  }

  if (doc.addendum) {
    lines.push("## ADDENDUM TO THE MINUTES / RESTRICTED RECORDS");
    lines.push("");
    if (doc.addendum.preamble?.trim()) {
      lines.push(doc.addendum.preamble.trim());
      lines.push("");
    }
    for (const s of doc.addendum.sections) {
      lines.push(...renderSection(s, 0));
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}
