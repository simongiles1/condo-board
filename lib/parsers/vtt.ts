export type VttCue = {
  start: string;
  end: string;
  speaker: string;
  text: string;
};

export type MergedVttCue = {
  start: string;
  end: string;
  speaker: string;
  text: string;
};

const TIMING_LINE = /^(\S+)\s+-->\s+(\S+)/;

/** Parse Microsoft Teams / WebVTT into structured cues (file order). */
export function parseVttCues(vtt: string): VttCue[] {
  const normalized = vtt.replace(/\ufeff/g, "").trim();
  const rawLines = normalized.split(/\r?\n/);
  const cues: VttCue[] = [];
  let i = 0;

  if (rawLines[i]?.startsWith("WEBVTT")) {
    i = 1;
  }

  while (i < rawLines.length && rawLines[i].trim() === "") i++;

  while (i < rawLines.length) {
    while (i < rawLines.length && rawLines[i].trim() === "") i++;
    if (i >= rawLines.length) break;

    let line = rawLines[i];
    if (!line.includes("-->")) {
      i++;
      if (i >= rawLines.length) break;
      line = rawLines[i];
    }

    const timingMatch = line.match(TIMING_LINE);
    if (!timingMatch) {
      i++;
      continue;
    }

    const start = timingMatch[1];
    const end = timingMatch[2];
    i++;

    const bodyLines: string[] = [];
    while (i < rawLines.length && rawLines[i].trim() !== "") {
      bodyLines.push(rawLines[i]);
      i++;
    }

    if (bodyLines.length === 0) continue;

    const { speaker, text } = extractSpeakerAndText(bodyLines);
    const collapsed = collapseWhitespace(text);
    if (!collapsed) continue;

    cues.push({ start, end, speaker, text: collapsed });
  }

  return cues;
}

/** Merge adjacent cues from the same speaker; keep the first cue's start time. */
export function mergeConsecutiveBySpeaker(cues: VttCue[]): MergedVttCue[] {
  if (cues.length === 0) return [];

  const merged: MergedVttCue[] = [];
  let current: MergedVttCue = { ...cues[0] };

  for (let i = 1; i < cues.length; i++) {
    const cue = cues[i];
    if (speakersMatch(current.speaker, cue.speaker)) {
      current.text = collapseWhitespace(`${current.text} ${cue.text}`);
      current.end = cue.end;
    } else {
      merged.push(current);
      current = { ...cue };
    }
  }

  merged.push(current);
  return merged;
}

/** Format merged cues as human-readable plain text with timestamps. */
export function formatReadableTranscript(merged: MergedVttCue[]): string {
  return merged
    .map((cue) => {
      const time = formatVttTimestamp(cue.start);
      const label = cue.speaker ? `${cue.speaker}: ` : "";
      return `[${time}] ${label}${cue.text}`;
    })
    .join("\n\n");
}

/** Parse VTT and merge consecutive same-speaker cues. */
export function vttToMergedCues(vtt: string): MergedVttCue[] {
  const cues = parseVttCues(vtt);
  return mergeConsecutiveBySpeaker(cues);
}

/** Convert VTT to merged, timestamped plain text for Gemini and display. */
export function vttToReadableTranscript(vtt: string): string {
  return formatReadableTranscript(vttToMergedCues(vtt));
}

/** @deprecated Prefer vttToReadableTranscript; kept for existing import sites. */
export function vttToPlainText(vtt: string): string {
  return vttToReadableTranscript(vtt);
}

function extractSpeakerAndText(lines: string[]): {
  speaker: string;
  text: string;
} {
  const raw = lines.join("\n");
  const speakerMatch = raw.match(/<v\s+([^>]+)>/i);
  const speaker = speakerMatch?.[1]?.trim() ?? "";

  const textParts: string[] = [];
  for (const line of lines) {
    const cleaned = line
      .replace(/<v\s+[^>]+>/gi, "")
      .replace(/<\/v>/gi, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (cleaned) textParts.push(cleaned);
  }

  return { speaker, text: textParts.join(" ") };
}

function speakersMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Strip fractional seconds from VTT timestamps (e.g. 00:00:03.454 → 00:00:03). */
export function formatVttTimestamp(start: string): string {
  return start.replace(/\.\d+$/, "");
}
