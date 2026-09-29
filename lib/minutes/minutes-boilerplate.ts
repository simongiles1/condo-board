/**
 * Fixed minutes sentences. Chair, clock time, and guest departure are the only variables.
 */

/** Clock phrase used in boilerplate, with a consistent a.m. / p.m. suffix. */
export function normalizeMinutesClock(time: string | null | undefined): string | undefined {
  const trimmed = time?.trim().replace(/\.+$/, "");
  if (!trimmed) return undefined;
  return trimmed.replace(/\b(a\.?m\.?|p\.?m\.?)\b/gi, (token) =>
    token.toLowerCase().startsWith("p") ? "p.m." : "a.m.",
  );
}

/**
 * Chair token safe to drop into the call-to-order sentence.
 * Meeting labels such as "the AGM" are rejected.
 */
export function callToOrderChair(raw: string | null | undefined): string | undefined {
  const chair = raw?.trim().replace(/\.+$/, "") ?? "";
  if (!chair) return undefined;
  if (/^management$/i.test(chair)) return "Management";
  if (/^the chair$/i.test(chair)) return "The Chair";
  if (/^[A-Z]\.\s+[A-Z][A-Za-z'’-]+$/.test(chair)) return chair;
  if (/^[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)+$/.test(chair)) return chair;
  return undefined;
}

/**
 * Call-to-order sentence. An unusable chair falls back to Management when a time is known.
 */
export function formatCallToOrderSentence(
  chairName?: string | null,
  time?: string | null,
): string {
  const clock = normalizeMinutesClock(time);
  const chair = callToOrderChair(chairName) ?? (clock ? "Management" : undefined);
  if (chair && clock) {
    return `Proper notice having been given and there being a quorum present, ${chair} called the meeting to order at ${clock} and presided as Chair.`;
  }
  if (chair) {
    return `Proper notice having been given and there being a quorum present, ${chair} called the meeting to order and presided as Chair.`;
  }
  if (clock) {
    return `Proper notice having been given and there being a quorum present, the meeting was called to order at ${clock}.`;
  }
  return "Proper notice having been given and there being a quorum present, the meeting was called to order.";
}

/** Meeting-conclusion sentence. */
export function formatMeetingConclusionSentence(time?: string | null): string {
  const clock = normalizeMinutesClock(time);
  if (!clock) return "The adjournment time was not recorded.";
  return `There being no further business to discuss, the meeting was unanimously concluded at ${clock}${clock.endsWith(".") ? "" : "."}`;
}

/** Guest-departure sentence, or null when no time was recorded. */
export function formatGuestDepartureSentence(time?: string | null): string | null {
  const clock = normalizeMinutesClock(time);
  if (!clock) return null;
  return `The guests left the meeting at ${clock}${clock.endsWith(".") ? "" : "."}`;
}

/** Conclusion paragraph plus the guest-departure sentence when that time exists. */
export function formatMeetingCloseSentences(
  conclusionTime?: string | null,
  guestDepartureTime?: string | null,
): string {
  const lines = [formatMeetingConclusionSentence(conclusionTime)];
  const guests = formatGuestDepartureSentence(guestDepartureTime);
  if (guests) lines.push(guests);
  return lines.join("\n\n");
}

/**
 * Turns shorthand compare text (`Chair:` / `Time:`) into the standard sentence.
 * Returns null when the body is already prose.
 */
export function standardizedProceduralBody(heading: string, body: string): string | null {
  const chair = body.match(/^Chair:\s*(.*)$/im)?.[1]?.trim();
  const time = body.match(/^Time:\s*(.*)$/im)?.[1]?.trim();
  const guests = body.match(/^Guests left:\s*(.*)$/im)?.[1]?.trim();
  if (/call to order/i.test(heading) && (chair || time)) {
    return formatCallToOrderSentence(chair, time);
  }
  if (/meeting conclusion|termination|^adjournment$/i.test(heading) && (time || guests)) {
    return formatMeetingCloseSentences(time, guests);
  }
  return null;
}

const GUEST_FAREWELL =
  /\b(have a (?:great|good|wonderful) (?:night|evening)|nice to meet|left the meeting|guests? (?:left|departed|were excused)|excused from the meeting)\b/i;

/**
 * End timestamp of the last guest or recording-secretary farewell in transcript chunks.
 * Returns the chunk's end timestamp string, not a clock time.
 */
export function lastGuestFarewellEndTimestamp(
  chunks: Array<{ endTimestamp?: string | null; text: string }>,
): string | null {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    if (!chunk || !GUEST_FAREWELL.test(chunk.text)) continue;
    const stamp = chunk.endTimestamp?.trim();
    if (stamp) return stamp;
  }
  return null;
}
