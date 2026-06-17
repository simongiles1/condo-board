import { DISPLAY_TIME_ZONE } from "@/lib/format/datetime";

export type IcalSourceQuoteDetail = {
  kind: "ical";
  variant: "participant" | "event";
  /** e.g. "Meeting organizer" or event title */
  roleLabel: string;
  name?: string;
  email?: string;
  details: Array<{ label: string; value: string }>;
};

export type FormattedSourceQuote =
  | { kind: "plain"; text: string }
  | IcalSourceQuoteDetail;

const KNOWN_ICAL_PROPERTIES = [
  "SUMMARY",
  "DTSTART",
  "DTEND",
  "DTSTAMP",
  "LOCATION",
  "ORGANIZER",
  "ATTENDEE",
  "DESCRIPTION",
  "UID",
  "STATUS",
  "METHOD",
] as const;

const ICAL_PROPERTY_PATTERN = KNOWN_ICAL_PROPERTIES.join("|");

const ROLE_LABELS: Record<string, string> = {
  "REQ-PARTICIPANT": "Required participant",
  "OPT-PARTICIPANT": "Optional participant",
  CHAIR: "Meeting chair",
  "NON-PARTICIPANT": "Non-participant",
};

const PARTSTAT_LABELS: Record<string, string> = {
  "NEEDS-ACTION": "Has not responded yet",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  TENTATIVE: "Tentative",
  DELEGATED: "Delegated to someone else",
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type ParsedIcalProperty = {
  property: string;
  params: Record<string, string>;
  value: string;
};

function stripQuoteWrappers(text: string): string {
  return text.trim().replace(/^["']|["']$/g, "");
}

function splitIcalProperties(text: string): string[] {
  return text
    .split(new RegExp(`\\s+(?=(?:${ICAL_PROPERTY_PATTERN})(?:;|:))`))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function parseIcalPropertySegment(
  segment: string,
): ParsedIcalProperty | null {
  const match = segment.match(/^([A-Za-z-]+)((?:;[^:]+)*):([\s\S]*)$/);
  if (!match) return null;

  const property = match[1].trim().toUpperCase();
  const value = match[3].trim();
  const params: Record<string, string> = {};

  for (const part of match[2].split(";").slice(1)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    params[part.slice(0, eq).trim().toUpperCase()] = part
      .slice(eq + 1)
      .trim();
  }

  return { property, params, value };
}

function emailFromIcalValue(value: string): string | undefined {
  const lower = value.toLowerCase();
  if (lower.startsWith("mailto:")) {
    return value.slice("mailto:".length).trim() || undefined;
  }
  return value.trim() || undefined;
}

function friendlyTimeZone(tzid: string | undefined): string | undefined {
  if (!tzid) return undefined;
  const normalized = tzid.trim().toLowerCase();
  if (
    normalized.includes("eastern") ||
    normalized === DISPLAY_TIME_ZONE.toLowerCase()
  ) {
    return "Eastern time";
  }
  return tzid;
}

function formatIcalDateTime(value: string, tzid?: string): string {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!match) return value;

  const year = match[1];
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = match[4] != null ? Number(match[4]) : null;
  const minute = match[5] != null ? Number(match[5]) : null;
  const dateLabel = `${MONTH_NAMES[monthIndex]} ${day}, ${year}`;

  if (hour == null || minute == null) {
    return dateLabel;
  }

  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  const minuteLabel = minute.toString().padStart(2, "0");
  const timeLabel = `${hour12}:${minuteLabel} ${period}`;
  const zoneLabel = friendlyTimeZone(tzid);

  return zoneLabel
    ? `${dateLabel} at ${timeLabel} (${zoneLabel})`
    : `${dateLabel} at ${timeLabel}`;
}

function looksLikeIcalBlob(text: string): boolean {
  return new RegExp(`\\b(?:${ICAL_PROPERTY_PATTERN})(?:;|:)`).test(text);
}

function formatParticipantQuote(
  parsed: ParsedIcalProperty,
): IcalSourceQuoteDetail {
  const name = parsed.params.CN;
  const email = emailFromIcalValue(parsed.value);
  const details: Array<{ label: string; value: string }> = [];

  if (parsed.property === "ORGANIZER") {
    details.push({ label: "Calendar role", value: "Meeting organizer" });
  } else {
    const role = parsed.params.ROLE;
    details.push({
      label: "Calendar role",
      value: role
        ? (ROLE_LABELS[role] ?? role.replace(/-/g, " ").toLowerCase())
        : "Invitee",
    });

    const partstat = parsed.params.PARTSTAT;
    if (partstat) {
      details.push({
        label: "Response status",
        value:
          PARTSTAT_LABELS[partstat] ??
          partstat.replace(/-/g, " ").toLowerCase(),
      });
    }

    if (parsed.params.RSVP?.toUpperCase() === "TRUE") {
      details.push({ label: "RSVP", value: "Response requested" });
    }
  }

  const roleLabel =
    parsed.property === "ORGANIZER"
      ? "Meeting organizer"
      : (ROLE_LABELS[parsed.params.ROLE ?? ""] ?? "Calendar invitee");

  return {
    kind: "ical",
    variant: "participant",
    roleLabel,
    name,
    email,
    details,
  };
}

function formatEventQuote(
  properties: ParsedIcalProperty[],
): IcalSourceQuoteDetail {
  const byName = new Map(properties.map((property) => [property.property, property]));
  const summary = byName.get("SUMMARY")?.value;
  const details: Array<{ label: string; value: string }> = [];

  const start = byName.get("DTSTART");
  if (start) {
    details.push({
      label: "Starts",
      value: formatIcalDateTime(start.value, start.params.TZID),
    });
  }

  const end = byName.get("DTEND");
  if (end) {
    details.push({
      label: "Ends",
      value: formatIcalDateTime(end.value, end.params.TZID),
    });
  }

  const location = byName.get("LOCATION")?.value;
  if (location) {
    details.push({ label: "Location", value: location });
  }

  const status = byName.get("STATUS")?.value;
  if (status) {
    details.push({
      label: "Status",
      value: status.replace(/_/g, " ").toLowerCase(),
    });
  }

  const method = byName.get("METHOD")?.value;
  if (method) {
    details.push({
      label: "Invite type",
      value: method.replace(/_/g, " ").toLowerCase(),
    });
  }

  return {
    kind: "ical",
    variant: "event",
    roleLabel: summary ?? "Calendar event",
    details,
  };
}

function formatIcalSourceQuote(text: string): IcalSourceQuoteDetail | null {
  const trimmed = stripQuoteWrappers(text);
  if (!looksLikeIcalBlob(trimmed)) return null;

  const segments = splitIcalProperties(trimmed);
  const properties = segments
    .map(parseIcalPropertySegment)
    .filter((property): property is ParsedIcalProperty => property != null);

  if (properties.length === 0) return null;

  const participantProperty = properties.find(
    (property) =>
      property.property === "ORGANIZER" || property.property === "ATTENDEE",
  );

  if (
    properties.length === 1 &&
    participantProperty &&
    properties[0] === participantProperty
  ) {
    return formatParticipantQuote(participantProperty);
  }

  const eventProperties = properties.filter(
    (property) =>
      property.property !== "ORGANIZER" && property.property !== "ATTENDEE",
  );

  if (eventProperties.length > 0) {
    const eventQuote = formatEventQuote(eventProperties);

    if (participantProperty) {
      const participant = formatParticipantQuote(participantProperty);
      if (participant.name || participant.email) {
        eventQuote.details.push({
          label:
            participantProperty.property === "ORGANIZER" ? "Organizer" : "Invitee",
          value: [participant.name, participant.email].filter(Boolean).join(" · "),
        });
      }
    }

    return eventQuote;
  }

  if (participantProperty) {
    return formatParticipantQuote(participantProperty);
  }

  return null;
}

/** Detect and humanize iCalendar source quotes used in extraction audit views. */
export function formatSourceQuote(quote: string): FormattedSourceQuote {
  const trimmed = quote.trim();
  const ical = formatIcalSourceQuote(trimmed);
  if (ical) return ical;
  return { kind: "plain", text: trimmed };
}

export function isIcalSourceQuote(quote: string): boolean {
  return formatSourceQuote(quote).kind === "ical";
}
