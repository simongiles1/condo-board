"use client";

import { useEffect, useState } from "react";

import {
  DRAG_MIME,
  decodeAttendeeDrag,
  emptyAttendee,
  encodeAttendeeDrag,
  moveAttendeeInDraft,
  type AttendanceSectionKey,
  type EditableAttendance,
  type EditableAttendee,
} from "@/lib/minutes/attendance-edit";

type Props = {
  open: boolean;
  attendance: EditableAttendance | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (
    attendance: Pick<
      EditableAttendance,
      "present" | "byInvitation" | "regrets" | "guests"
    >,
  ) => void;
};

const BASE_SECTIONS: { key: AttendanceSectionKey; label: string }[] = [
  { key: "present", label: "Present" },
  { key: "byInvitation", label: "By invitation" },
  { key: "regrets", label: "Regrets" },
];

function cloneAttendance(attendance: EditableAttendance): EditableAttendance {
  return {
    ...attendance,
    present: attendance.present.length
      ? attendance.present.map((a) => ({ ...a }))
      : [emptyAttendee()],
    byInvitation: attendance.byInvitation.map((a) => ({ ...a })),
    regrets: attendance.regrets.map((a) => ({ ...a })),
    guests: attendance.guests.map((a) => ({ ...a })),
  };
}

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100";

const HEADER_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-slate-500";

function attendeeGridCols(showCompany: boolean) {
  return showCompany
    ? "grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
    : "grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_auto]";
}

function AttendeeTableHeader({ showCompany }: { showCompany: boolean }) {
  return (
    <div
      className={`grid ${attendeeGridCols(showCompany)} items-end gap-x-2 border-b border-slate-200 px-2 pb-2 ${HEADER_CLASS}`}
    >
      <span aria-hidden="true" className="w-5" />
      <span>Name</span>
      <span>Title / role</span>
      {showCompany ? <span>Company</span> : null}
      <span aria-hidden="true" className="w-14" />
    </div>
  );
}

function AttendeeRow({
  attendee,
  showCompany,
  isDragging,
  onChange,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  attendee: EditableAttendee;
  showCompany: boolean;
  isDragging: boolean;
  onChange: (next: EditableAttendee) => void;
  onRemove: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`grid ${attendeeGridCols(showCompany)} items-center gap-x-2 px-2 py-1.5 transition ${
        isDragging ? "bg-teal-50/80 opacity-50" : "hover:bg-slate-50/80"
      }`}
    >
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        role="button"
        tabIndex={0}
        className="flex shrink-0 cursor-grab flex-col justify-center gap-0.5 rounded px-0.5 py-1 text-slate-400 hover:bg-slate-200/60 active:cursor-grabbing"
        aria-label={`Drag ${attendee.name || "attendee"}`}
      >
        <span className="block h-0.5 w-3 rounded-full bg-current" />
        <span className="block h-0.5 w-3 rounded-full bg-current" />
        <span className="block h-0.5 w-3 rounded-full bg-current" />
      </span>
      <input
        type="text"
        value={attendee.name}
        onChange={(event) =>
          onChange({ ...attendee, name: event.target.value })
        }
        placeholder="Full name"
        aria-label="Name"
        className={INPUT_CLASS}
      />
      <input
        type="text"
        value={attendee.titleOrRole}
        onChange={(event) =>
          onChange({ ...attendee, titleOrRole: event.target.value })
        }
        placeholder="Director, President, etc."
        aria-label="Title or role"
        className={INPUT_CLASS}
      />
      {showCompany ? (
        <input
          type="text"
          value={attendee.company ?? ""}
          onChange={(event) =>
            onChange({ ...attendee, company: event.target.value })
          }
          placeholder="Optional"
          aria-label="Company"
          className={INPUT_CLASS}
        />
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-800 hover:bg-red-50"
      >
        Remove
      </button>
    </div>
  );
}

function AttendanceSection({
  sectionKey,
  label,
  attendees,
  showCompany,
  dragOverSection,
  draggedItem,
  onChange,
  onMoveAttendee,
  onDragStateChange,
}: {
  sectionKey: AttendanceSectionKey;
  label: string;
  attendees: EditableAttendee[];
  showCompany: boolean;
  dragOverSection: AttendanceSectionKey | null;
  draggedItem: { section: AttendanceSectionKey; index: number } | null;
  onChange: (next: EditableAttendee[]) => void;
  onMoveAttendee: (
    from: { section: AttendanceSectionKey; index: number },
    toSection: AttendanceSectionKey,
    toIndex?: number,
  ) => void;
  onDragStateChange: (next: {
    draggedItem: { section: AttendanceSectionKey; index: number } | null;
    dragOverSection: AttendanceSectionKey | null;
  }) => void;
}) {
  const isDropTarget = dragOverSection === sectionKey && draggedItem !== null;

  function handleSectionDragOver(event: React.DragEvent) {
    if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    onDragStateChange({ draggedItem, dragOverSection: sectionKey });
  }

  function handleSectionDrop(event: React.DragEvent) {
    event.preventDefault();
    const from = decodeAttendeeDrag(event.dataTransfer.getData(DRAG_MIME));
    if (!from) return;
    onMoveAttendee(from, sectionKey, attendees.length);
    onDragStateChange({ draggedItem: null, dragOverSection: null });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
        <button
          type="button"
          onClick={() => onChange([...attendees, emptyAttendee()])}
          className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-900 hover:border-teal-300"
        >
          Add person
        </button>
      </div>
      <div
        onDragOver={handleSectionDragOver}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          if (dragOverSection === sectionKey) {
            onDragStateChange({ draggedItem, dragOverSection: null });
          }
        }}
        onDrop={handleSectionDrop}
        className={`min-h-[3rem] overflow-x-auto rounded-xl border-2 border-dashed transition ${
          isDropTarget
            ? "border-teal-400 bg-teal-50/60"
            : "border-transparent"
        }`}
      >
        {attendees.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-center text-sm text-slate-500">
            No one listed yet. Drop someone here or add a row.
          </p>
        ) : (
          <div className="min-w-[32rem] divide-y divide-slate-100">
            <AttendeeTableHeader showCompany={showCompany} />
            {attendees.map((attendee, index) => (
              <AttendeeRow
                key={`${sectionKey}-${index}`}
                attendee={attendee}
                showCompany={showCompany}
                isDragging={
                  draggedItem?.section === sectionKey &&
                  draggedItem.index === index
                }
                onChange={(next) => {
                  const copy = [...attendees];
                  copy[index] = next;
                  onChange(copy);
                }}
                onRemove={() =>
                  onChange(attendees.filter((_, i) => i !== index))
                }
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    DRAG_MIME,
                    encodeAttendeeDrag({ section: sectionKey, index }),
                  );
                  event.dataTransfer.effectAllowed = "move";
                  onDragStateChange({
                    draggedItem: { section: sectionKey, index },
                    dragOverSection: sectionKey,
                  });
                }}
                onDragEnd={() =>
                  onDragStateChange({ draggedItem: null, dragOverSection: null })
                }
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  onDragStateChange({
                    draggedItem,
                    dragOverSection: sectionKey,
                  });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const from = decodeAttendeeDrag(
                    event.dataTransfer.getData(DRAG_MIME),
                  );
                  if (!from) return;
                  onMoveAttendee(from, sectionKey, index);
                  onDragStateChange({
                    draggedItem: null,
                    dragOverSection: null,
                  });
                }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function AttendeesEditorDialog({
  open,
  attendance,
  busy = false,
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<EditableAttendance | null>(attendance);
  const [draggedItem, setDraggedItem] = useState<{
    section: AttendanceSectionKey;
    index: number;
  } | null>(null);
  const [dragOverSection, setDragOverSection] =
    useState<AttendanceSectionKey | null>(null);

  useEffect(() => {
    if (open && attendance) {
      setDraft(cloneAttendance(attendance));
      setDraggedItem(null);
      setDragOverSection(null);
    }
  }, [open, attendance]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open || !draft) return null;

  const showCompany = draft.schemaVersion === "v2";
  const sections = showCompany
    ? [...BASE_SECTIONS, { key: "guests" as const, label: "Guests" }]
    : BASE_SECTIONS;

  function updateSection(key: AttendanceSectionKey, list: EditableAttendee[]) {
    setDraft((current) => (current ? { ...current, [key]: list } : current));
  }

  function handleMoveAttendee(
    from: { section: AttendanceSectionKey; index: number },
    toSection: AttendanceSectionKey,
    toIndex?: number,
  ) {
    setDraft((current) =>
      current ? moveAttendeeInDraft(current, from, toSection, toIndex) : current,
    );
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    onSave({
      present: draft.present,
      byInvitation: draft.byInvitation,
      regrets: draft.regrets,
      guests: draft.guests,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={busy ? undefined : onClose}
        aria-label="Close dialog"
        disabled={busy}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendees-editor-title"
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <h2
            id="attendees-editor-title"
            className="text-xl font-semibold text-slate-900"
          >
            Edit attendees
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Drag rows between groups to reassign someone. Changes update the
            structured minutes used for PDF export.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="space-y-6 overflow-y-auto px-6 py-5">
            {sections.map(({ key, label }) => (
              <AttendanceSection
                key={key}
                sectionKey={key}
                label={label}
                attendees={draft[key]}
                showCompany={showCompany}
                dragOverSection={dragOverSection}
                draggedItem={draggedItem}
                onChange={(list) => updateSection(key, list)}
                onMoveAttendee={handleMoveAttendee}
                onDragStateChange={({ draggedItem: item, dragOverSection: over }) => {
                  setDraggedItem(item);
                  setDragOverSection(over);
                }}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save attendees"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
