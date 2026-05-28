import type { Attendee } from "@/lib/minutes/schema";
import { validateMinutesJson } from "@/lib/minutes/schema";
import type { AttendeeV2 } from "@/lib/minutes/schema-v2";
import {
  parseMinutesJsonEnvelope,
  wrapMinutesV2,
} from "@/lib/minutes/schema-v2";

export type EditableAttendee = {
  name: string;
  titleOrRole: string;
  company?: string;
};

export type EditableAttendance = {
  schemaVersion: "v1" | "v2";
  present: EditableAttendee[];
  byInvitation: EditableAttendee[];
  regrets: EditableAttendee[];
  guests: EditableAttendee[];
};

export type AttendanceSectionKey =
  | "present"
  | "byInvitation"
  | "regrets"
  | "guests";

export type AttendeeLocation = {
  section: AttendanceSectionKey;
  index: number;
};

const DRAG_MIME = "application/x-condo-attendee";

function toEditableV2(a: AttendeeV2): EditableAttendee {
  return {
    name: a.name,
    titleOrRole: a.titleOrRole,
    company: a.company,
  };
}

function toEditableV1(a: Attendee): EditableAttendee {
  return {
    name: a.name,
    titleOrRole: a.role,
  };
}

function fromEditableV2(a: EditableAttendee): AttendeeV2 {
  const name = a.name.trim();
  const titleOrRole = a.titleOrRole.trim();
  const company = a.company?.trim();
  return {
    name,
    titleOrRole,
    ...(company ? { company } : {}),
  };
}

function fromEditableV1(a: EditableAttendee): Attendee {
  return {
    name: a.name.trim(),
    role: a.titleOrRole.trim(),
  };
}

function filterAttendees(list: EditableAttendee[]): EditableAttendee[] {
  return list.filter((a) => a.name.trim().length > 0);
}

/** Parse attendance lists from stored minutes_json (v1 or v2). */
export function extractAttendanceFromMinutesJson(
  minutesJson: string,
): EditableAttendance | null {
  const envelope = parseMinutesJsonEnvelope(minutesJson);

  if (envelope.version === "v2" && envelope.v2) {
    const { attendance } = envelope.v2;
    return {
      schemaVersion: "v2",
      present: attendance.present.map(toEditableV2),
      byInvitation: attendance.byInvitation.map(toEditableV2),
      regrets: attendance.regrets.map(toEditableV2),
      guests: attendance.guests.map(toEditableV2),
    };
  }

  if (envelope.version === "v1" && envelope.v1Raw) {
    const { value } = validateMinutesJson(envelope.v1Raw);
    if (!value) return null;
    return {
      schemaVersion: "v1",
      present: value.present.map(toEditableV1),
      byInvitation: value.byInvitation.map(toEditableV1),
      regrets: value.regrets.map(toEditableV1),
      guests: [],
    };
  }

  return null;
}

/** Merge edited attendance back into minutes_json; returns null if invalid. */
export function applyAttendanceToMinutesJson(
  minutesJson: string,
  attendance: Pick<
    EditableAttendance,
    "present" | "byInvitation" | "regrets" | "guests"
  >,
): string | null {
  const envelope = parseMinutesJsonEnvelope(minutesJson);

  const present = filterAttendees(attendance.present);
  const byInvitation = filterAttendees(attendance.byInvitation);
  const regrets = filterAttendees(attendance.regrets);
  const guests = filterAttendees(attendance.guests);

  if (envelope.version === "v2" && envelope.v2) {
    const updated = {
      ...envelope.v2,
      attendance: {
        ...envelope.v2.attendance,
        present: present.map(fromEditableV2),
        byInvitation: byInvitation.map(fromEditableV2),
        regrets: regrets.map(fromEditableV2),
        guests: guests.map(fromEditableV2),
      },
    };
    return JSON.stringify(wrapMinutesV2(updated));
  }

  if (envelope.version === "v1" && envelope.v1Raw) {
    const { value } = validateMinutesJson(envelope.v1Raw);
    if (!value) return null;

    const updated = {
      ...value,
      present: present.map(fromEditableV1),
      byInvitation: byInvitation.map(fromEditableV1),
      regrets: regrets.map(fromEditableV1),
    };
    return JSON.stringify(updated);
  }

  return null;
}

export function emptyAttendee(): EditableAttendee {
  return { name: "", titleOrRole: "" };
}

export function encodeAttendeeDrag(location: AttendeeLocation): string {
  return JSON.stringify(location);
}

export function decodeAttendeeDrag(raw: string): AttendeeLocation | null {
  try {
    const parsed = JSON.parse(raw) as AttendeeLocation;
    if (
      parsed &&
      typeof parsed.index === "number" &&
      (parsed.section === "present" ||
        parsed.section === "byInvitation" ||
        parsed.section === "regrets" ||
        parsed.section === "guests")
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Move or reorder an attendee between attendance groups. */
export function moveAttendeeInDraft(
  draft: EditableAttendance,
  from: AttendeeLocation,
  toSection: AttendanceSectionKey,
  toIndex?: number,
): EditableAttendance {
  const fromList = [...draft[from.section]];
  const [item] = fromList.splice(from.index, 1);
  if (!item) return draft;

  const sameSection = from.section === toSection;
  const toList = sameSection ? fromList : [...draft[toSection]];

  let insertAt = toIndex ?? toList.length;
  if (sameSection && from.index < insertAt) {
    insertAt -= 1;
  }
  insertAt = Math.max(0, Math.min(insertAt, toList.length));
  toList.splice(insertAt, 0, item);

  if (sameSection) {
    return { ...draft, [from.section]: toList };
  }

  return {
    ...draft,
    [from.section]: fromList,
    [toSection]: toList,
  };
}

export { DRAG_MIME };
