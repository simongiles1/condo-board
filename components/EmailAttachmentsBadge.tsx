"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { EmailAttachmentViewerDialog } from "@/components/EmailAttachmentViewerDialog";
import {
  attachmentKind,
  formatAttachmentSize,
  type EmailAttachmentSummary,
  type ThreadAttachmentGroup,
} from "@/lib/email/attachment-display";
import { formatDateTime } from "@/lib/format/datetime";

const VIEWPORT_MARGIN = 8;

function attachmentKindIconClass(
  kind: ReturnType<typeof attachmentKind>,
): string {
  switch (kind) {
    case "image":
      return "text-violet-600";
    case "pdf":
      return "text-red-600";
    case "doc":
      return "text-blue-600";
    case "sheet":
      return "text-emerald-600";
    default:
      return "text-slate-500";
  }
}

function PaperclipIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function AttachmentKindIcon({
  kind,
}: {
  kind: ReturnType<typeof attachmentKind>;
}) {
  const className = `h-4 w-4 shrink-0 ${attachmentKindIconClass(kind)}`;

  switch (kind) {
    case "image":
      return (
        <svg aria-hidden viewBox="0 0 16 16" className={className} fill="currentColor">
          <path d="M14 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1ZM2 13V5.5l3.5 3.5L9 6l5 5V13H2Zm12 0V12l-5-5-3.5 3.5L3 6.8V13h11Z" />
          <circle cx="5.25" cy="5.25" r="1.25" />
        </svg>
      );
    case "pdf":
      return (
        <svg aria-hidden viewBox="0 0 16 16" className={className} fill="currentColor">
          <path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h5.086a1.5 1.5 0 0 1 1.06.44l2.914 2.914A1.5 1.5 0 0 1 14 4.414V13.5A1.5 1.5 0 0 1 12.5 15h-8A1.5 1.5 0 0 1 3 13.5v-12Z" />
          <path
            d="M9.5 0v3.5A1.5 1.5 0 0 0 11 5h3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.75"
            opacity="0.5"
          />
        </svg>
      );
    case "doc":
      return (
        <svg aria-hidden viewBox="0 0 16 16" className={className} fill="currentColor">
          <path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h5.086a1.5 1.5 0 0 1 1.06.44l2.914 2.914A1.5 1.5 0 0 1 14 4.414V13.5A1.5 1.5 0 0 1 12.5 15h-8A1.5 1.5 0 0 1 3 13.5v-12Zm1.5-.5a.5.5 0 0 0-.5.5v12a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V4.914L9.586 1H4.5Z" />
          <path d="M5 7h6M5 9.5h6M5 12h4" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.7" />
        </svg>
      );
    case "sheet":
      return (
        <svg aria-hidden viewBox="0 0 16 16" className={className} fill="currentColor">
          <path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h5.086a1.5 1.5 0 0 1 1.06.44l2.914 2.914A1.5 1.5 0 0 1 14 4.414V13.5A1.5 1.5 0 0 1 12.5 15h-8A1.5 1.5 0 0 1 3 13.5v-12Zm1.5-.5a.5.5 0 0 0-.5.5v12a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V4.914L9.586 1H4.5Z" />
          <path d="M5.5 7h5v1.5h-5V7Zm0 2.5h5V11h-5V9.5Z" opacity="0.7" />
        </svg>
      );
    default:
      return (
        <svg aria-hidden viewBox="0 0 16 16" className={className} fill="currentColor">
          <path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h5.086a1.5 1.5 0 0 1 1.06.44l2.914 2.914A1.5 1.5 0 0 1 14 4.414V13.5A1.5 1.5 0 0 1 12.5 15h-8A1.5 1.5 0 0 1 3 13.5v-12Zm1.5-.5a.5.5 0 0 0-.5.5v12a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V4.914L9.586 1H4.5Z" />
        </svg>
      );
  }
}

function AttachmentListItem({
  attachment,
  onSelect,
}: {
  attachment: EmailAttachmentSummary;
  onSelect: (attachment: EmailAttachmentSummary) => void;
}) {
  const kind = attachmentKind(attachment.mimeType);
  const sizeLabel = formatAttachmentSize(attachment.sizeBytes);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(attachment);
      }}
      className="flex w-full min-w-0 items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    >
      <AttachmentKindIcon kind={kind} />
      <span className="min-w-0 flex-1 text-sm leading-snug text-slate-800">
        {attachment.filename}
      </span>
      {sizeLabel ? (
        <span className="shrink-0 text-xs tabular-nums text-slate-500">
          {sizeLabel}
        </span>
      ) : null}
    </button>
  );
}

function AttachmentList({
  attachments,
  onSelect,
}: {
  attachments: EmailAttachmentSummary[];
  onSelect: (attachment: EmailAttachmentSummary) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <AttachmentListItem attachment={attachment} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function computePopoverPosition(
  triggerRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
  const spaceBelow = viewportHeight - triggerRect.bottom - VIEWPORT_MARGIN;
  const showAbove = spaceAbove >= popoverHeight || spaceAbove >= spaceBelow;

  let top: number;
  let transform: string;

  if (showAbove) {
    top = triggerRect.top - VIEWPORT_MARGIN;
    transform = "translate(-100%, -100%)";
    if (top - popoverHeight < VIEWPORT_MARGIN) {
      top = VIEWPORT_MARGIN + popoverHeight;
    }
  } else {
    top = triggerRect.bottom + VIEWPORT_MARGIN;
    transform = "translate(-100%, 0)";
    if (top + popoverHeight > viewportHeight - VIEWPORT_MARGIN) {
      top = viewportHeight - VIEWPORT_MARGIN - popoverHeight;
    }
  }

  const left = Math.min(
    Math.max(triggerRect.right, VIEWPORT_MARGIN + popoverWidth),
    viewportWidth - VIEWPORT_MARGIN,
  );

  return {
    position: "fixed",
    top,
    left,
    transform,
    zIndex: 50,
  };
}

function PopoverPanel({
  panelRef,
  title,
  children,
  style,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  title: string;
  children: ReactNode;
  style: CSSProperties;
}) {
  return (
    <div
      ref={panelRef}
      role="tooltip"
      style={style}
      className="w-max min-w-[14rem] max-w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      {children}
    </div>
  );
}

export function EmailAttachmentsBadge({
  attachments,
  groups,
}: {
  attachments?: EmailAttachmentSummary[];
  groups?: ThreadAttachmentGroup[];
}) {
  const count =
    attachments?.length ??
    groups?.reduce((sum, group) => sum + group.attachments.length, 0) ??
    0;

  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] =
    useState<EmailAttachmentSummary | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 50,
  });

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !popoverRef.current) return;

    function updatePosition() {
      const triggerRect = rootRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!triggerRect || !popover) return;

      setPopoverStyle({
        ...computePopoverPosition(
          triggerRect,
          popover.offsetWidth,
          popover.offsetHeight,
        ),
        visibility: "visible",
      });
    }

    updatePosition();
  }, [open, attachments, groups]);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const triggerRect = rootRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!triggerRect || !popover) return;

      setPopoverStyle({
        ...computePopoverPosition(
          triggerRect,
          popover.offsetWidth,
          popover.offsetHeight,
        ),
        visibility: "visible",
      });
    }

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, attachments, groups]);

  if (count === 0) return null;

  const title =
    groups && groups.length > 1
      ? `${count} attachments across ${groups.length} emails`
      : `${count} attachment${count === 1 ? "" : "s"}`;

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label={title}
        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-200/80"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <PaperclipIcon />
        <span>{count}</span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <PopoverPanel
              panelRef={popoverRef}
              title={title}
              style={popoverStyle}
            >
              {groups && groups.length > 0 ? (
                <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                  {groups.map((group) => (
                    <div key={group.emailId} className="space-y-1">
                      <div className="text-xs text-slate-600">
                        <span className="font-medium text-slate-800">
                          {group.fromAddress}
                        </span>
                        <span className="mx-1 text-slate-400">·</span>
                        <time dateTime={group.receivedAt}>
                          {formatDateTime(group.receivedAt)}
                        </time>
                      </div>
                      <AttachmentList
                        attachments={group.attachments}
                        onSelect={setPreviewAttachment}
                      />
                    </div>
                  ))}
                </div>
              ) : attachments ? (
                <AttachmentList
                  attachments={attachments}
                  onSelect={setPreviewAttachment}
                />
              ) : null}
            </PopoverPanel>,
            document.body,
          )
        : null}

      <EmailAttachmentViewerDialog
        open={previewAttachment != null}
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
