/** Structured meeting minutes for PDF + markdown preview. */

export type Attendee = {
  name: string;
  role: string;
};

export type MotionBlock = {
  kind: "motion";
  mover: string;
  seconder: string;
  resolution: string;
  outcome: string;
};

export type ParagraphBlock = { kind: "paragraph"; text: string };
export type ActionBlock = { kind: "action"; text: string };
export type NoteBlock = { kind: "note"; text: string };

export type ListBlock = {
  kind: "list";
  style: "letter" | "roman";
  items: ListItem[];
};

export type Block =
  | ParagraphBlock
  | MotionBlock
  | ActionBlock
  | NoteBlock
  | ListBlock;

export type ListItem = {
  marker: string;
  title?: string;
  blocks: Block[];
};

export type Section = {
  number: string;
  title: string;
  lead?: string;
  blocks: Block[];
  subsections?: Section[];
};

export type Addendum = {
  title: string;
  preamble?: string;
  sections: Section[];
};

export type MinutesDocument = {
  meetingDateDisplay: string;
  meetingTime: string;
  meetingMedium: string;
  present: Attendee[];
  byInvitation: Attendee[];
  regrets: Attendee[];
  sections: Section[];
  addendum?: Addendum;
  signatures: number;
};

export type ValidateMinutesResult = {
  value: MinutesDocument | null;
  warnings: string[];
  errors: string[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function normalizeAttendee(raw: unknown, warnings: string[]): Attendee {
  if (!isRecord(raw)) {
    warnings.push("Attendee entry was not an object; coerced to empty.");
    return { name: "", role: "" };
  }
  const name = asString(raw.name);
  const role = asString(raw.role);
  if (!name) warnings.push("Attendee missing name.");
  return { name, role };
}

function normalizeBlock(raw: unknown, warnings: string[]): Block {
  if (!isRecord(raw)) {
    warnings.push("Block was not an object; coerced to paragraph.");
    return { kind: "paragraph", text: String(raw ?? "") };
  }

  const kind = asString(raw.kind).toLowerCase();

  switch (kind) {
    case "motion": {
      return {
        kind: "motion",
        mover: asString(raw.mover),
        seconder: asString(raw.seconder),
        resolution: asString(raw.resolution),
        outcome: asString(raw.outcome, "Motion carried."),
      };
    }
    case "action": {
      return { kind: "action", text: asString(raw.text) };
    }
    case "note": {
      return { kind: "note", text: asString(raw.text) };
    }
    case "list": {
      const styleRaw = asString(raw.style).toLowerCase();
      const style: "letter" | "roman" =
        styleRaw === "roman" ? "roman" : "letter";
      const itemsRaw = raw.items;
      const items: ListItem[] = Array.isArray(itemsRaw)
        ? itemsRaw.map((item) => normalizeListItem(item, warnings))
        : [];
      if (!Array.isArray(itemsRaw)) {
        warnings.push("List block missing items array.");
      }
      return { kind: "list", style, items };
    }
    case "paragraph":
    default: {
      if (kind && kind !== "paragraph") {
        warnings.push(`Unknown block kind "${kind}"; treated as paragraph.`);
      }
      return { kind: "paragraph", text: asString(raw.text) };
    }
  }
}

function normalizeListItem(raw: unknown, warnings: string[]): ListItem {
  if (!isRecord(raw)) {
    warnings.push("List item was not an object.");
    return { marker: "", blocks: [] };
  }
  const marker = asString(raw.marker);
  const title = raw.title !== undefined ? asString(raw.title) : undefined;
  const blocksRaw = raw.blocks;
  const blocks: Block[] = Array.isArray(blocksRaw)
    ? blocksRaw.map((b) => normalizeBlock(b, warnings))
    : [];
  if (!Array.isArray(blocksRaw)) {
    warnings.push(`List item ${marker || "(no marker)"} missing blocks array.`);
  }
  return { marker, title: title || undefined, blocks };
}

function normalizeSection(raw: unknown, warnings: string[]): Section {
  if (!isRecord(raw)) {
    warnings.push("Section was not an object.");
    return { number: "", title: "", blocks: [] };
  }
  const number = asString(raw.number);
  const title = asString(raw.title);
  const lead = raw.lead !== undefined ? asString(raw.lead) : undefined;
  const blocksRaw = raw.blocks;
  const blocks: Block[] = Array.isArray(blocksRaw)
    ? blocksRaw.map((b) => normalizeBlock(b, warnings))
    : [];
  if (!Array.isArray(blocksRaw)) {
    warnings.push(`Section ${number || "?"} missing blocks array.`);
  }
  const subRaw = raw.subsections;
  const subsections = Array.isArray(subRaw)
    ? subRaw.map((s) => normalizeSection(s, warnings))
    : undefined;
  return {
    number,
    title,
    lead: lead || undefined,
    blocks,
    subsections,
  };
}

function normalizeAddendum(raw: unknown, warnings: string[]): Addendum | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    warnings.push("Addendum was not an object; ignored.");
    return undefined;
  }
  const title = asString(raw.title, "ADDENDUM TO THE MINUTES");
  const preamble =
    raw.preamble !== undefined ? asString(raw.preamble) : undefined;
  const sectionsRaw = raw.sections;
  const sections: Section[] = Array.isArray(sectionsRaw)
    ? sectionsRaw.map((s) => normalizeSection(s, warnings))
    : [];
  if (!Array.isArray(sectionsRaw)) {
    warnings.push("Addendum missing sections array.");
  }
  return {
    title,
    preamble: preamble || undefined,
    sections,
  };
}

/** Parse and coerce unknown JSON into MinutesDocument; collect warnings. */
export function validateMinutesJson(
  raw: unknown,
): ValidateMinutesResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return {
        value: null,
        warnings,
        errors: ["minutes_json is not valid JSON."],
      };
    }
  }

  if (!isRecord(data)) {
    return {
      value: null,
      warnings,
      errors: ["Root must be a JSON object."],
    };
  }

  const meetingDateDisplay = asString(data.meetingDateDisplay);
  const meetingTime = asString(data.meetingTime);
  const meetingMedium = asString(data.meetingMedium, "virtually");

  if (!meetingDateDisplay) {
    errors.push("meetingDateDisplay is required.");
  }
  if (!meetingTime) {
    warnings.push("meetingTime empty; PDF may show blank time.");
  }

  const presentRaw = data.present;
  const present: Attendee[] = Array.isArray(presentRaw)
    ? presentRaw.map((a) => normalizeAttendee(a, warnings))
    : [];
  if (!Array.isArray(presentRaw)) {
    warnings.push("present must be an array.");
  }

  const byInvRaw = data.byInvitation;
  const byInvitation: Attendee[] = Array.isArray(byInvRaw)
    ? byInvRaw.map((a) => normalizeAttendee(a, warnings))
    : [];
  if (!Array.isArray(byInvRaw)) {
    warnings.push("byInvitation must be an array.");
  }

  const regretsRaw = data.regrets;
  const regrets: Attendee[] = Array.isArray(regretsRaw)
    ? regretsRaw.map((a) => normalizeAttendee(a, warnings))
    : [];
  if (!Array.isArray(regretsRaw)) {
    warnings.push("regrets must be an array (use [] if none).");
  }

  const sectionsRaw = data.sections;
  const sections: Section[] = Array.isArray(sectionsRaw)
    ? sectionsRaw.map((s) => normalizeSection(s, warnings))
    : [];
  if (!Array.isArray(sectionsRaw) || sections.length === 0) {
    errors.push("sections must be a non-empty array.");
  }

  let signatures = 2;
  if (data.signatures !== undefined) {
    const n = Number(data.signatures);
    if (Number.isFinite(n) && n >= 0) {
      signatures = Math.floor(n);
    } else {
      warnings.push("signatures invalid; defaulting to 2.");
    }
  }

  const addendum = normalizeAddendum(data.addendum, warnings);

  if (errors.length > 0) {
    return { value: null, warnings, errors };
  }

  const value: MinutesDocument = {
    meetingDateDisplay,
    meetingTime,
    meetingMedium,
    present,
    byInvitation,
    regrets,
    sections,
    addendum,
    signatures,
  };

  return { value, warnings, errors };
}

/** Heuristic checks after structural validation. */
export function detectMinutesJsonIssues(doc: MinutesDocument): string[] {
  const w: string[] = [];
  const textBlob = JSON.stringify(doc).toLowerCase();

  let motionCount = 0;
  function countMotionsInBlocks(blocks: Block[]) {
    for (const b of blocks) {
      if (b.kind === "motion") motionCount += 1;
      if (b.kind === "list") {
        for (const item of b.items) {
          countMotionsInBlocks(item.blocks);
        }
      }
    }
  }
  function countMotionsInSection(s: Section) {
    countMotionsInBlocks(s.blocks);
    for (const sub of s.subsections ?? []) {
      countMotionsInSection(sub);
    }
  }
  for (const s of doc.sections) {
    countMotionsInSection(s);
  }
  if (doc.addendum) {
    for (const s of doc.addendum.sections) {
      countMotionsInSection(s);
    }
  }

  if (motionCount === 0) {
    w.push("No MOTION blocks detected in structured minutes.");
  }

  const restrictedHints =
    /\bunit\s+\d{3,4}\b|\brequest for records\b|\blitigation\b|\b55\s*\(\s*4\s*\)/i;
  if (restrictedHints.test(textBlob) && !doc.addendum) {
    w.push(
      "Transcript may reference restricted topics but no addendum object was included.",
    );
  }

  const blob = textBlob;
  if (
    blob.length < 800 &&
    !/concluded|adjourned|meeting was (adjourned|concluded)/.test(blob)
  ) {
    w.push(
      "Minutes JSON looks short and may lack meeting conclusion section.",
    );
  }

  return w;
}
