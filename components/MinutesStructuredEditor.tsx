"use client";

import { useCallback, useLayoutEffect, useRef, type ChangeEvent } from "react";
import {
  addActionItem,
  addAgendaItem,
  addApprovalOfPreviousMinutes,
  addSubItem,
  emptyAgendaItem,
  emptyMotion,
  moveAgendaItem,
  removeActionItem,
  removeAgendaItem,
  removeApprovalOfPreviousMinutes,
  updateActionItem,
  updateAgendaItem,
  updateApprovalMotion,
  updateApprovalOfPreviousMinutes,
  updateCallToOrder,
  updateDateOfNextMeeting,
  updateMotion,
  updateTermination,
  type AgendaBucket,
  type AgendaPath,
} from "@/lib/minutes/doc-v2-edits";
import {
  RESTRICTED_ADDENDUM_DISCLAIMER,
  RESTRICTED_ADDENDUM_SECTION_HEADING,
  RESTRICTED_ADDENDUM_SUBTITLE,
  RESTRICTED_ADDENDUM_TITLE,
} from "@/lib/minutes/restricted-addendum-boilerplate";
import {
  AGENDA_ITEM_STATUS_VALUES,
  hasAnyRestrictedItem,
  type AgendaItemStatus,
  type AgendaItemV2,
  type MinutesDocumentV2,
  type MotionV2,
} from "@/lib/minutes/schema-v2";
import {
  formatAttendeeLine,
  formatMeetingDateDisplay,
  formatMeetingTimeClause,
  letterMarker,
  meetingMediumFromMetadata,
  romanMarker,
} from "@/lib/minutes/v2-render-helpers";

type Props = {
  doc: MinutesDocumentV2;
  onDocChange: (next: MinutesDocumentV2) => void;
  onOpenAttendeesDialog: () => void;
};

const inputClass =
  "minutes-structured-input w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-900 focus:border-teal-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-100";

const textareaClass =
  "minutes-structured-textarea w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-1 py-0.5 text-sm leading-relaxed text-slate-800 focus:border-teal-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-100";

function AutoGrowTextarea({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const syncHeight = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${node.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    syncHeight();
  }, [value, syncHeight]);

  return (
    <textarea
      ref={ref}
      className={className}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        onChange(e);
        syncHeight();
      }}
    />
  );
}

const btnClass =
  "rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50";

const actionAssigneeInputClass =
  "minutes-structured-input minutes-action-assignee-input rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-900 focus:border-teal-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-100";

const actionTaskInputClass =
  "minutes-structured-input minutes-action-task-input rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-900 focus:border-teal-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-100";

const motionNameInputClass =
  "minutes-structured-input minutes-motion-name-input rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-900 focus:border-teal-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-100";

const motionResolutionInputClass =
  "minutes-structured-input minutes-motion-resolution-input rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-900 focus:border-teal-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-100";

type IndexedAgendaEntry = {
  item: AgendaItemV2;
  path: AgendaPath;
  displayIndex: number;
};

function indexAgendaItems(
  items: AgendaItemV2[] | undefined,
  bucket: AgendaBucket,
  restricted: boolean,
): IndexedAgendaEntry[] {
  const entries: IndexedAgendaEntry[] = [];
  let displayIndex = 0;
  (items || []).forEach((item, index) => {
    const isRestricted = Boolean(item.restricted);
    if (restricted ? isRestricted : !isRestricted) {
      entries.push({
        item,
        path: { bucket, index },
        displayIndex: displayIndex++,
      });
    }
  });
  return entries;
}

function indexPostTerminationItems(
  sectionIndex: number,
  items: AgendaItemV2[],
  restricted: boolean,
): IndexedAgendaEntry[] {
  const entries: IndexedAgendaEntry[] = [];
  let displayIndex = 0;
  items.forEach((item, itemIndex) => {
    const isRestricted = Boolean(item.restricted);
    if (restricted ? isRestricted : !isRestricted) {
      entries.push({
        item,
        path: {
          bucket: "postTerminationSections",
          sectionIndex,
          itemIndex,
        },
        displayIndex: displayIndex++,
      });
    }
  });
  return entries;
}

function SectionHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="minutes-section-heading">
      {number ? (
        <span className="minutes-section-number">{number}.</span>
      ) : null}
      <span className="minutes-section-title">{title}</span>
    </div>
  );
}

function SubsectionHeading({
  number,
  title,
}: {
  number: string;
  title: string;
}) {
  return (
    <div className="minutes-subsection-heading">
      <span className="minutes-section-number">{number}</span>
      <span className="minutes-subsection-title">{title}</span>
    </div>
  );
}

function MotionEditor({
  motion,
  onChange,
  onRemove,
}: {
  motion: MotionV2 | undefined;
  onChange: (motion: MotionV2) => void;
  onRemove: () => void;
}) {
  if (!motion) return null;

  return (
    <div className="minutes-motion-block">
      <div className="minutes-motion-line">
        <span className="minutes-motion-keyword">MOTION</span>
        <span> by </span>
        <input
          type="text"
          className={motionNameInputClass}
          value={motion.movedBy}
          onChange={(e) => onChange({ ...motion, movedBy: e.target.value })}
          placeholder="Mover name"
        />
      </div>
      <div className="minutes-motion-line">
        <span className="minutes-motion-keyword">Seconded</span>
        <span> by </span>
        <input
          type="text"
          className={motionNameInputClass}
          value={motion.secondedBy}
          onChange={(e) => onChange({ ...motion, secondedBy: e.target.value })}
          placeholder="Seconder name"
        />
      </div>
      <div className="minutes-motion-line minutes-motion-resolution-row">
        <span className="minutes-motion-keyword">THAT </span>
        <input
          type="text"
          className={motionResolutionInputClass}
          value={motion.resolutionText}
          onChange={(e) =>
            onChange({ ...motion, resolutionText: e.target.value })
          }
          placeholder="Resolution text"
        />
        <div className="minutes-motion-actions">
          <select
            className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs"
            value={motion.status}
            onChange={(e) =>
              onChange({
                ...motion,
                status: e.target.value as MotionV2["status"],
              })
            }
          >
            <option value="Motion carried.">Motion carried.</option>
            <option value="Motion defeated.">Motion defeated.</option>
            <option value="Deferred.">Deferred.</option>
          </select>
          <button type="button" className={btnClass} onClick={onRemove}>
            Remove motion
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionItemsEditor({
  item,
  path,
  doc,
  onDocChange,
}: {
  item: AgendaItemV2;
  path: AgendaPath;
  doc: MinutesDocumentV2;
  onDocChange: (next: MinutesDocumentV2) => void;
}) {
  return (
    <div className="minutes-action-items">
      {(item.actionItems || []).map((action, actionIndex) => (
        <div key={actionIndex} className="minutes-action-row">
          <span className="minutes-action-label">Action:</span>
          <input
            type="text"
            className={actionAssigneeInputClass}
            value={action.assignee}
            onChange={(e) =>
              onDocChange(
                updateActionItem(doc, path, actionIndex, {
                  assignee: e.target.value,
                }),
              )
            }
            placeholder="Assignee"
          />
          <input
            type="text"
            className={actionTaskInputClass}
            value={action.taskDescription}
            onChange={(e) =>
              onDocChange(
                updateActionItem(doc, path, actionIndex, {
                  taskDescription: e.target.value,
                }),
              )
            }
            placeholder="Task description"
          />
          <button
            type="button"
            className={btnClass}
            onClick={() =>
              onDocChange(removeActionItem(doc, path, actionIndex))
            }
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function AgendaItemEditor({
  doc,
  path,
  item,
  marker,
  depth,
  markerKind = "letter",
  showNumberedHeading,
  numberedLabel,
  onDocChange,
}: {
  doc: MinutesDocumentV2;
  path: AgendaPath;
  item: AgendaItemV2;
  marker: string;
  depth: number;
  markerKind?: "letter" | "roman" | "numbered";
  showNumberedHeading?: boolean;
  numberedLabel?: string;
  onDocChange: (next: MinutesDocumentV2) => void;
}) {
  const rootIdx =
    path.bucket === "postTerminationSections" ? path.itemIndex : path.index;

  return (
    <div
      className="minutes-agenda-item"
      style={{ marginLeft: depth > 0 ? `${depth * 1.25}rem` : undefined }}
    >
      {showNumberedHeading && numberedLabel ? (
        <div className="minutes-numbered-item">
          <span className="minutes-section-number">{numberedLabel}</span>
          <input
            type="text"
            className={`${inputClass} minutes-topic-input font-semibold`}
            value={item.topic}
            onChange={(e) =>
              onDocChange(
                updateAgendaItem(doc, path, { topic: e.target.value }),
              )
            }
            placeholder="Topic"
          />
        </div>
      ) : (
        <div className="minutes-section-row">
          <span
            className={
              markerKind === "roman"
                ? "minutes-section-marker-roman"
                : "minutes-section-marker"
            }
          >
            {marker}
          </span>
          <input
            type="text"
            className={`${inputClass} minutes-topic-input font-semibold`}
            value={item.topic}
            onChange={(e) =>
              onDocChange(
                updateAgendaItem(doc, path, { topic: e.target.value }),
              )
            }
            placeholder="Topic"
          />
        </div>
      )}

      <div className="minutes-item-body">
        <AutoGrowTextarea
          className={textareaClass}
          value={item.summary}
          onChange={(e) =>
            onDocChange(
              updateAgendaItem(doc, path, { summary: e.target.value }),
            )
          }
          placeholder="Summary"
        />

        <div className="minutes-item-meta">
          <label className="minutes-meta-label">
            Status
            <select
              className="ml-1 rounded border border-slate-200 bg-white px-1 py-0.5 text-xs"
              value={item.status ?? ""}
              onChange={(e) =>
                onDocChange(
                  updateAgendaItem(doc, path, {
                    status: (e.target.value || undefined) as
                      | AgendaItemStatus
                      | undefined,
                  }),
                )
              }
            >
              <option value="">—</option>
              {AGENDA_ITEM_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="minutes-meta-label ml-3">
            <input
              type="checkbox"
              checked={Boolean(item.restricted)}
              onChange={(e) =>
                onDocChange(
                  updateAgendaItem(doc, path, {
                    restricted: e.target.checked || undefined,
                  }),
                )
              }
              className="mr-1 accent-teal-600"
            />
            Restricted (addendum only)
          </label>
          {item.restricted ? (
            <span className="minutes-restricted-badge">Restricted</span>
          ) : null}
        </div>

        <ActionItemsEditor
          item={item}
          path={path}
          doc={doc}
          onDocChange={onDocChange}
        />

        <MotionEditor
          motion={item.motion}
          onChange={(motion) => onDocChange(updateMotion(doc, path, motion))}
          onRemove={() => onDocChange(updateMotion(doc, path, undefined))}
        />

        {(item.subItems || []).map((sub, subIdx) => (
          <AgendaItemEditor
            key={subIdx}
            doc={doc}
            path={{
              ...path,
              subPath: [...(path.subPath ?? []), subIdx],
            }}
            item={sub}
            marker={romanMarker(subIdx)}
            depth={depth + 1}
            markerKind="roman"
            onDocChange={onDocChange}
          />
        ))}

        <div className="minutes-item-actions">
          <button
            type="button"
            className={btnClass}
            onClick={() => onDocChange(addSubItem(doc, path))}
          >
            Add sub-item
          </button>
          {!item.motion ? (
            <button
              type="button"
              className={btnClass}
              onClick={() =>
                onDocChange(updateMotion(doc, path, emptyMotion()))
              }
            >
              Add motion
            </button>
          ) : null}
          <button
            type="button"
            className={btnClass}
            onClick={() => onDocChange(addActionItem(doc, path))}
          >
            Add action item
          </button>
          <button
            type="button"
            className={btnClass}
            onClick={() =>
              onDocChange(moveAgendaItem(doc, path, "up"))
            }
            disabled={rootIdx === 0 && !path.subPath?.length}
          >
            Move up
          </button>
          <button
            type="button"
            className={btnClass}
            onClick={() =>
              onDocChange(moveAgendaItem(doc, path, "down"))
            }
          >
            Move down
          </button>
          <button
            type="button"
            className={`${btnClass} text-red-700 hover:border-red-200 hover:bg-red-50`}
            onClick={() => onDocChange(removeAgendaItem(doc, path))}
          >
            Remove item
          </button>
        </div>
      </div>
    </div>
  );
}

function AgendaItemsList({
  doc,
  entries,
  numberedSection,
  numberedOffset = 0,
  onDocChange,
}: {
  doc: MinutesDocumentV2;
  entries: IndexedAgendaEntry[];
  numberedSection?: string;
  /** Add to display index when numbering (e.g. addendum continues after public count). */
  numberedOffset?: number;
  onDocChange: (next: MinutesDocumentV2) => void;
}) {
  return (
    <div className="minutes-agenda-list">
      {entries.map(({ item, path, displayIndex }) => {
        const isNumbered = Boolean(numberedSection);
        const numberedLabel = isNumbered
          ? `${numberedSection}.${numberedOffset + displayIndex + 1}`
          : undefined;

        return (
          <AgendaItemEditor
            key={`${JSON.stringify(path)}-${item.topic}`}
            doc={doc}
            path={path}
            item={item}
            marker={letterMarker(displayIndex)}
            depth={0}
            showNumberedHeading={isNumbered}
            numberedLabel={numberedLabel}
            onDocChange={onDocChange}
          />
        );
      })}
    </div>
  );
}

function AttendanceSection({
  doc,
  onOpenAttendeesDialog,
}: {
  doc: MinutesDocumentV2;
  onOpenAttendeesDialog: () => void;
}) {
  const medium = meetingMediumFromMetadata((doc.metadata || {}).meetingPlatform);
  const dateDisplay = formatMeetingDateDisplay((doc.metadata || {}).meetingDate);
  const corp = (doc.metadata || {}).corporationName?.trim() || "";
  const timeClause = formatMeetingTimeClause((doc.metadata || {}).meetingTime);

  return (
    <section className="minutes-structured-section">
      <p className="minutes-title-clause">
        <strong>MINUTES</strong>
        {` of the meeting of the Board of Directors of ${corp} held ${medium} on ${dateDisplay}${timeClause}`}
      </p>
      <hr className="minutes-hr" />
      <div className="minutes-attendance-header">
        <h3 className="text-sm font-semibold text-slate-700">Attendance</h3>
        <button
          type="button"
          className={btnClass}
          onClick={onOpenAttendeesDialog}
        >
          Edit attendees
        </button>
      </div>
      {(
        [
          ["Present:", doc?.attendance?.present || []],
          ["By Invitation:", doc?.attendance?.byInvitation || []],
          ["Guests:", doc?.attendance?.guests || []],
          ["Regrets:", doc?.attendance?.regrets || []],
        ] as const
      ).map(([label, people]) =>
        people.length > 0 ? (
          <div key={label} className="minutes-attendance-block">
            <span className="minutes-attendance-label">{label}</span>
            <div className="minutes-attendance-rows">
              {people.map((person, idx) => (
                <div key={idx} className="minutes-attendance-row">
                  <span className="minutes-attendance-name">{person.name}</span>
                  <span className="minutes-attendance-role">
                    {formatAttendeeLine(person).includes(" - ")
                      ? formatAttendeeLine(person).slice(
                          person.name.length + 3,
                        )
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null,
      )}
      <hr className="minutes-hr" />
    </section>
  );
}

function ManagementBucket({
  doc,
  sectionNum,
  subNum,
  title,
  bucket,
  entries,
  onDocChange,
}: {
  doc: MinutesDocumentV2;
  sectionNum: string;
  subNum: number;
  title: string;
  bucket: AgendaBucket;
  entries: IndexedAgendaEntry[];
  onDocChange: (next: MinutesDocumentV2) => void;
}) {
  if (!entries.length) return null;

  return (
    <div className="minutes-management-bucket">
      <SubsectionHeading number={`${sectionNum}.${subNum}`} title={title} />
      <AgendaItemsList
        doc={doc}
        entries={entries}
        onDocChange={onDocChange}
      />
      <button
        type="button"
        className={`${btnClass} mt-2`}
        onClick={() => onDocChange(addAgendaItem(doc, bucket))}
      >
        Add item
      </button>
    </div>
  );
}

function RestrictedAddendumSection({
  doc,
  onDocChange,
}: {
  doc: MinutesDocumentV2;
  onDocChange: (next: MinutesDocumentV2) => void;
}) {
  if (!hasAnyRestrictedItem(doc)) return null;

  const mr = doc.managementReport || {};
  const finPub = indexAgendaItems(doc.financialMatters, "financialMatters", false);
  const finRest = indexAgendaItems(doc.financialMatters, "financialMatters", true);
  const ratPub = indexAgendaItems(
    mr.itemsForRatification,
    "managementReport.itemsForRatification",
    false,
  );
  const ratRest = indexAgendaItems(
    mr.itemsForRatification,
    "managementReport.itemsForRatification",
    true,
  );
  const apprPub = indexAgendaItems(
    mr.itemsForApproval,
    "managementReport.itemsForApproval",
    false,
  );
  const apprRest = indexAgendaItems(
    mr.itemsForApproval,
    "managementReport.itemsForApproval",
    true,
  );
  const discPub = indexAgendaItems(
    mr.itemsForDiscussion,
    "managementReport.itemsForDiscussion",
    false,
  );
  const discRest = indexAgendaItems(
    mr.itemsForDiscussion,
    "managementReport.itemsForDiscussion",
    true,
  );
  const infoPub = indexAgendaItems(
    mr.itemsForInformation,
    "managementReport.itemsForInformation",
    false,
  );
  const infoRest = indexAgendaItems(
    mr.itemsForInformation,
    "managementReport.itemsForInformation",
    true,
  );
  const newBizPub = indexAgendaItems(
    doc.newOrOtherBusiness,
    "newOrOtherBusiness",
    false,
  );
  const newBizRest = indexAgendaItems(
    doc.newOrOtherBusiness,
    "newOrOtherBusiness",
    true,
  );

  const apprDiscRest = [
    ...apprRest.map((e, i) => ({ ...e, displayIndex: i })),
    ...discRest.map((e, i) => ({
      ...e,
      displayIndex: apprRest.length + i,
    })),
  ];

  return (
    <section className="minutes-structured-section minutes-addendum">
      <h2 className="minutes-addendum-title">{RESTRICTED_ADDENDUM_TITLE}</h2>
      <p className="minutes-addendum-subtitle">{RESTRICTED_ADDENDUM_SUBTITLE}</p>
      <p className="minutes-addendum-confidential">
        {RESTRICTED_ADDENDUM_SECTION_HEADING}
      </p>
      <p className="minutes-addendum-disclaimer">
        {RESTRICTED_ADDENDUM_DISCLAIMER}
      </p>

      {finRest.length > 0 ? (
        <>
          <SectionHeading number="3" title="Financial Matters, continued." />
          <AgendaItemsList
            doc={doc}
            entries={finRest}
            numberedSection="3"
            numberedOffset={finPub.length}
            onDocChange={onDocChange}
          />
        </>
      ) : null}

      {ratRest.length > 0 || apprDiscRest.length > 0 || infoRest.length > 0 ? (
        <>
          <SectionHeading number="4" title="Management Report, continued." />
          <ManagementBucket
            doc={doc}
            sectionNum="4"
            subNum={1}
            title="Items for Ratification"
            bucket="managementReport.itemsForRatification"
            entries={ratRest.map((e, i) => ({
              ...e,
              displayIndex: ratPub.length + i,
            }))}
            onDocChange={onDocChange}
          />
          {apprDiscRest.length > 0 ? (
            <div className="minutes-management-bucket">
              <SubsectionHeading
                number="4.2"
                title="Items for Board Discussion and/or Approval"
              />
              <AgendaItemsList
                doc={doc}
                entries={apprDiscRest.map((e, i) => ({
                  ...e,
                  displayIndex: apprPub.length + discPub.length + i,
                }))}
                onDocChange={onDocChange}
              />
            </div>
          ) : null}
          <ManagementBucket
            doc={doc}
            sectionNum="4"
            subNum={3}
            title="Items for Board Information"
            bucket="managementReport.itemsForInformation"
            entries={infoRest.map((e, i) => ({
              ...e,
              displayIndex: infoPub.length + i,
            }))}
            onDocChange={onDocChange}
          />
        </>
      ) : null}

      {newBizRest.length > 0 ? (
        <>
          <SectionHeading number="5" title="New / Other Business, continued." />
          <AgendaItemsList
            doc={doc}
            entries={newBizRest.map((e, i) => ({
              ...e,
              displayIndex: newBizPub.length + i,
            }))}
            onDocChange={onDocChange}
          />
        </>
      ) : null}

      {(doc.postTerminationSections || []).map((section, sectionIdx) => {
        const pub = indexPostTerminationItems(sectionIdx, section.items, false);
        const rest = indexPostTerminationItems(sectionIdx, section.items, true);
        if (!rest.length) return null;
        return (
          <div key={sectionIdx}>
            <SectionHeading
              number={String(8 + sectionIdx)}
              title={`${section.title}, continued.`}
            />
            <AgendaItemsList
              doc={doc}
              entries={rest.map((e, i) => ({
                ...e,
                displayIndex: pub.length + i,
              }))}
              onDocChange={onDocChange}
            />
          </div>
        );
      })}
    </section>
  );
}

/** Section-based minutes editor that mirrors PDF layout and edits minutesJson. */
export function MinutesStructuredEditor({
  doc,
  onDocChange,
  onOpenAttendeesDialog,
}: Props) {
  const mr = doc.managementReport || {};

  const finPub = indexAgendaItems(doc.financialMatters, "financialMatters", false);
  const ratPub = indexAgendaItems(
    mr.itemsForRatification,
    "managementReport.itemsForRatification",
    false,
  );
  const apprPub = indexAgendaItems(
    mr.itemsForApproval,
    "managementReport.itemsForApproval",
    false,
  );
  const discPub = indexAgendaItems(
    mr.itemsForDiscussion,
    "managementReport.itemsForDiscussion",
    false,
  );
  const infoPub = indexAgendaItems(
    mr.itemsForInformation,
    "managementReport.itemsForInformation",
    false,
  );
  const newBizPub = indexAgendaItems(
    doc.newOrOtherBusiness,
    "newOrOtherBusiness",
    false,
  );
  const corrPub = indexAgendaItems(doc.correspondence, "correspondence", false);
  const specialPub = indexAgendaItems(
    doc.specialPresentations,
    "specialPresentations",
    false,
  );

  const apprDiscPub = [
    ...apprPub.map((e, i) => ({ ...e, displayIndex: i })),
    ...discPub.map((e, i) => ({
      ...e,
      displayIndex: apprPub.length + i,
    })),
  ];

  const hasManagement =
    ratPub.length > 0 || apprDiscPub.length > 0 || infoPub.length > 0;

  return (
    <div className="minutes-structured-editor rounded-xl border border-slate-200 bg-white p-6 shadow-inner ring-1 ring-teal-100">
      <AttendanceSection
        doc={doc}
        onOpenAttendeesDialog={onOpenAttendeesDialog}
      />

      {/* 1. Call to Order */}
      <section className="minutes-structured-section">
        <SectionHeading number="1" title="Call to Order" />
        <div className="minutes-body-paragraph space-y-2">
          <label className="block text-xs font-medium text-slate-500">
            Chair name
            <input
              type="text"
              className={`${inputClass} mt-1`}
              value={doc.callToOrder?.chairName ?? ""}
              onChange={(e) =>
                onDocChange(
                  updateCallToOrder(doc, { chairName: e.target.value }),
                )
              }
              placeholder="the Chair"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Call to order time
            <input
              type="text"
              className={`${inputClass} mt-1`}
              value={doc.callToOrder?.time ?? ""}
              onChange={(e) =>
                onDocChange(updateCallToOrder(doc, { time: e.target.value }))
              }
              placeholder="7:00 p.m."
            />
          </label>
        </div>
      </section>

      {/* 2. Approval of Previous Minutes */}
      <section className="minutes-structured-section">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading number="2" title="Approval of Previous Minutes" />
          <button
            type="button"
            className={btnClass}
            onClick={() => onDocChange(addApprovalOfPreviousMinutes(doc))}
          >
            Add approval entry
          </button>
        </div>
        {(doc.approvalOfPreviousMinutes || []).map((approval, idx) => (
          <div key={idx} className="minutes-approval-entry">
            <label className="block text-xs font-medium text-slate-500">
              Previous meeting date
              <input
                type="text"
                className={`${inputClass} mt-1`}
                value={approval.previousMeetingDate ?? ""}
                onChange={(e) =>
                  onDocChange(
                    updateApprovalOfPreviousMinutes(doc, idx, {
                      previousMeetingDate: e.target.value,
                    }),
                  )
                }
                placeholder="2026-03-15"
              />
            </label>
            <label className="minutes-meta-label mt-2">
              <input
                type="checkbox"
                checked={Boolean(approval.amendmentsNoted)}
                onChange={(e) =>
                  onDocChange(
                    updateApprovalOfPreviousMinutes(doc, idx, {
                      amendmentsNoted: e.target.checked,
                    }),
                  )
                }
                className="mr-1 accent-teal-600"
              />
              Amendments noted
            </label>
            <MotionEditor
              motion={approval.motion}
              onChange={(motion) =>
                onDocChange(updateApprovalMotion(doc, idx, motion))
              }
              onRemove={() =>
                onDocChange(updateApprovalMotion(doc, idx, undefined))
              }
            />
            {!approval.motion ? (
              <button
                type="button"
                className={`${btnClass} mt-2`}
                onClick={() =>
                  onDocChange(updateApprovalMotion(doc, idx, emptyMotion()))
                }
              >
                Add motion
              </button>
            ) : null}
            <button
              type="button"
              className={`${btnClass} mt-2 text-red-700`}
              onClick={() =>
                onDocChange(removeApprovalOfPreviousMinutes(doc, idx))
              }
            >
              Remove entry
            </button>
          </div>
        ))}
      </section>

      {/* 3. Financial Matters */}
      <section className="minutes-structured-section">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading number="3" title="Financial Matters" />
          <button
            type="button"
            className={btnClass}
            onClick={() => onDocChange(addAgendaItem(doc, "financialMatters"))}
          >
            Add item
          </button>
        </div>
        <AgendaItemsList
          doc={doc}
          entries={finPub}
          numberedSection="3"
          onDocChange={onDocChange}
        />
      </section>

      {/* 4. Management Report */}
      {hasManagement ? (
        <section className="minutes-structured-section">
          <SectionHeading number="4" title="Management Report" />
          <ManagementBucket
            doc={doc}
            sectionNum="4"
            subNum={1}
            title="Items for Ratification"
            bucket="managementReport.itemsForRatification"
            entries={ratPub}
            onDocChange={onDocChange}
          />
          {apprDiscPub.length > 0 ? (
            <div className="minutes-management-bucket">
              <SubsectionHeading
                number="4.2"
                title="Items for Board Discussion and/or Approval"
              />
              <AgendaItemsList
                doc={doc}
                entries={apprDiscPub}
                onDocChange={onDocChange}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnClass}
                  onClick={() =>
                    onDocChange(
                      addAgendaItem(doc, "managementReport.itemsForApproval"),
                    )
                  }
                >
                  Add approval item
                </button>
                <button
                  type="button"
                  className={btnClass}
                  onClick={() =>
                    onDocChange(
                      addAgendaItem(doc, "managementReport.itemsForDiscussion"),
                    )
                  }
                >
                  Add discussion item
                </button>
              </div>
            </div>
          ) : null}
          <ManagementBucket
            doc={doc}
            sectionNum="4"
            subNum={3}
            title="Items for Board Information"
            bucket="managementReport.itemsForInformation"
            entries={infoPub}
            onDocChange={onDocChange}
          />
        </section>
      ) : null}

      {/* Correspondence */}
      {corrPub.length > 0 ? (
        <section className="minutes-structured-section">
          <SectionHeading number="" title="Correspondence" />
          <AgendaItemsList
            doc={doc}
            entries={corrPub}
            onDocChange={onDocChange}
          />
          <button
            type="button"
            className={btnClass}
            onClick={() => onDocChange(addAgendaItem(doc, "correspondence"))}
          >
            Add item
          </button>
        </section>
      ) : null}

      {/* 5. New / Other Business */}
      <section className="minutes-structured-section">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading number="5" title="New / Other Business" />
          <button
            type="button"
            className={btnClass}
            onClick={() =>
              onDocChange(addAgendaItem(doc, "newOrOtherBusiness"))
            }
          >
            Add item
          </button>
        </div>
        <AgendaItemsList
          doc={doc}
          entries={newBizPub}
          onDocChange={onDocChange}
        />
      </section>

      {/* 6. Date of Next Meeting */}
      <section className="minutes-structured-section">
        <SectionHeading number="6" title="Date of Next Meeting" />
        <div className="minutes-body-paragraph space-y-2">
          <label className="block text-xs font-medium text-slate-500">
            Date
            <input
              type="text"
              className={`${inputClass} mt-1`}
              value={doc.dateOfNextMeeting?.date ?? ""}
              onChange={(e) =>
                onDocChange(
                  updateDateOfNextMeeting(doc, { date: e.target.value }),
                )
              }
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Time
            <input
              type="text"
              className={`${inputClass} mt-1`}
              value={doc.dateOfNextMeeting?.time ?? ""}
              onChange={(e) =>
                onDocChange(
                  updateDateOfNextMeeting(doc, { time: e.target.value }),
                )
              }
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Location
            <input
              type="text"
              className={`${inputClass} mt-1`}
              value={doc.dateOfNextMeeting?.location ?? ""}
              onChange={(e) =>
                onDocChange(
                  updateDateOfNextMeeting(doc, { location: e.target.value }),
                )
              }
              placeholder="virtually"
            />
          </label>
        </div>
      </section>

      {/* 7. Meeting Conclusion */}
      <section className="minutes-structured-section">
        <SectionHeading number="7" title="Meeting Conclusion" />
        <label className="block text-xs font-medium text-slate-500">
          Conclusion time
          <input
            type="text"
            className={`${inputClass} mt-1`}
            value={doc.termination?.time ?? ""}
            onChange={(e) => onDocChange(updateTermination(doc, e.target.value))}
            placeholder="9:30 p.m."
          />
        </label>
      </section>

      {/* Post-termination sections */}
      {(doc.postTerminationSections || []).map((section, sectionIdx) => {
        const pub = indexPostTerminationItems(sectionIdx, section.items, false);
        if (!pub.length && !(section.title || "").trim()) return null;
        return (
          <section key={sectionIdx} className="minutes-structured-section">
            <SectionHeading
              number={String(8 + sectionIdx)}
              title={(section.title || "").toUpperCase() || "Section"}
            />
            <AgendaItemsList
              doc={doc}
              entries={pub}
              onDocChange={onDocChange}
            />
            <button
              type="button"
              className={btnClass}
              onClick={() =>
                onDocChange(
                  addAgendaItem(
                    doc,
                    "postTerminationSections",
                    emptyAgendaItem(),
                    sectionIdx,
                  ),
                )
              }
            >
              Add item
            </button>
          </section>
        );
      })}

      {/* Special presentations */}
      {specialPub.length > 0 ? (
        <section className="minutes-structured-section">
          <SectionHeading number="" title="Special Presentations" />
          <AgendaItemsList
            doc={doc}
            entries={specialPub}
            onDocChange={onDocChange}
          />
        </section>
      ) : null}

      <RestrictedAddendumSection doc={doc} onDocChange={onDocChange} />
    </div>
  );
}
