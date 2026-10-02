/**
 * User message shape for one V4 draft completion call.
 */

import type { MeetingsV4Bundle, MeetingsV4BundleCue } from "@/lib/meeting-v4/types";

/** One transcript cue in the JSON user message sent to the draft model. */
export type MeetingsV4DraftTranscriptCue = {
  speaker: string;
  start: string;
  end: string;
  text: string;
};

/** Parsed user message for one agenda item draft. */
export type MeetingsV4DraftUserPayload = {
  topic: string;
  itemNumber: string;
  agenda: string;
  transcript: MeetingsV4DraftTranscriptCue[];
  attachments: MeetingsV4Bundle["attachmentPages"];
};

/**
 * Builds the user JSON payload for one V4 draft call from the stored bundle.
 */
export function buildMeetingsV4DraftUserPayload(input: {
  title: string;
  itemNumber: string;
  bundle: MeetingsV4Bundle;
}): MeetingsV4DraftUserPayload {
  return {
    topic: input.title,
    itemNumber: input.itemNumber,
    agenda: input.bundle.agendaText,
    transcript: input.bundle.cues.map((cue) => transcriptCueForPayload(cue)),
    attachments: input.bundle.attachmentPages,
  };
}

/**
 * Serializes the user payload the draft route sends to the model.
 */
export function meetingsV4DraftUserText(payload: MeetingsV4DraftUserPayload): string {
  return JSON.stringify(payload);
}

/**
 * Readable transcript text for the draft review panel.
 */
export function meetingsV4DraftTranscriptMarkdown(cues: readonly MeetingsV4BundleCue[]): string {
  if (cues.length === 0) {
    return "No reviewed transcript cues were assigned to this item.";
  }
  return cues
    .map((cue) => {
      const speaker = cue.speaker.trim();
      const prefix = speaker ? `${cue.start} ${speaker}` : cue.start;
      return `${prefix} — ${cue.text}`;
    })
    .join("\n\n");
}

/**
 * Full draft call as plain text: system instruction plus pretty-printed user JSON.
 */
export function meetingsV4DraftFullCallMarkdown(
  systemInstruction: string,
  payload: MeetingsV4DraftUserPayload,
): string {
  return [
    "=== System instruction ===",
    systemInstruction.trim(),
    "",
    "=== User message (JSON) ===",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function transcriptCueForPayload(cue: MeetingsV4BundleCue): MeetingsV4DraftTranscriptCue {
  return {
    speaker: cue.speaker,
    start: cue.start,
    end: cue.end,
    text: cue.text,
  };
}
