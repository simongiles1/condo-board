"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { EmailAttachmentViewerDialog } from "@/components/EmailAttachmentViewerDialog";
import {
  attachmentKind,
  attachmentKindLabel,
  emailAttachmentApiUrl,
  formatAttachmentSize,
  type EmailAttachmentSummary,
  type ThreadAttachmentGroup,
} from "@/lib/email/attachment-display";
import { filterVisibleAttachments } from "@/lib/email/attachment-visibility";
import { formatDateTime } from "@/lib/format/datetime";
import { useAttachmentVisibilitySettings } from "@/lib/settings/attachment-visibility-settings";
import { renderPdfPageToCanvas } from "@/lib/pdf/pdfjs-browser";
import {
  claimHoverPopover,
  releaseHoverPopover,
} from "@/lib/ui/hover-popover-group";

const VIEWPORT_MARGIN = 8;
const POPOVER_HIDE_DELAY_MS = 500;
const THUMBNAIL_HIDE_DELAY_MS = 120;
const THUMBNAIL_MAX_WIDTH = 176;
const THUMBNAIL_MAX_HEIGHT = 132;
const PDF_THUMBNAIL_SCALE = 0.35;

function attachmentKindIconClass(
  kind: ReturnType<typeof attachmentKind>,
): string {
  switch (kind) {
    case "image":
      return "text-violet-600";
    case "pdf":
      return "text-amber-700";
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

function computeThumbnailPopoverPosition(
  anchorRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const gap = 6;

  let left = anchorRect.right + gap;
  let top = anchorRect.top + anchorRect.height / 2;
  let transform = "translateY(-50%)";

  if (left + popoverWidth > viewportWidth - VIEWPORT_MARGIN) {
    left = anchorRect.left - gap;
    transform = "translate(-100%, -50%)";
  }

  if (top - popoverHeight / 2 < VIEWPORT_MARGIN) {
    top = VIEWPORT_MARGIN + popoverHeight / 2;
  } else if (top + popoverHeight / 2 > viewportHeight - VIEWPORT_MARGIN) {
    top = viewportHeight - VIEWPORT_MARGIN - popoverHeight / 2;
  }

  return {
    position: "fixed",
    top,
    left,
    transform,
    zIndex: 60,
  };
}

function AttachmentThumbnailContent({
  attachment,
}: {
  attachment: EmailAttachmentSummary;
}) {
  const kind = attachmentKind(attachment.mimeType, attachment.filename);
  const url = emailAttachmentApiUrl(attachment.id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageError, setImageError] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(kind === "pdf");
  const [pdfError, setPdfError] = useState(false);

  useEffect(() => {
    setImageError(false);
    setPdfLoading(kind === "pdf");
    setPdfError(false);
  }, [attachment.id, kind]);

  useEffect(() => {
    if (kind !== "pdf") return;

    let cancelled = false;
    setPdfLoading(true);
    setPdfError(false);

    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load PDF.");
        return response.arrayBuffer();
      })
      .then(async (buffer) => {
        if (cancelled || !canvasRef.current) return;
        await renderPdfPageToCanvas(
          buffer,
          1,
          canvasRef.current,
          PDF_THUMBNAIL_SCALE,
        );
        if (!cancelled) setPdfLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setPdfLoading(false);
          setPdfError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attachment.id, kind, url]);

  if (kind === "image" && !imageError) {
    return (
      <div className="flex max-h-[132px] max-w-[176px] items-center justify-center overflow-hidden rounded-md bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={attachment.filename}
          onError={() => setImageError(true)}
          className="max-h-[132px] max-w-[176px] object-contain"
        />
      </div>
    );
  }

  if (kind === "pdf" && !pdfError) {
    return (
      <div className="relative flex max-h-[132px] max-w-[176px] items-center justify-center overflow-hidden rounded-md bg-slate-50">
        {pdfLoading ? (
          <div className="flex h-[88px] w-[132px] items-center justify-center text-xs text-slate-500">
            Loading…
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          className={`max-h-[132px] max-w-[176px] object-contain ${pdfLoading ? "hidden" : ""}`}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[88px] w-[132px] flex-col items-center justify-center gap-2 rounded-md bg-slate-50 px-3 text-center">
      <AttachmentKindIcon kind={kind} />
      <span className="text-xs font-medium text-slate-600">
        {attachmentKindLabel(kind)}
      </span>
    </div>
  );
}

function AttachmentIconWithThumbnail({
  attachment,
  onSelect,
  onHoverChange,
}: {
  attachment: EmailAttachmentSummary;
  onSelect: (attachment: EmailAttachmentSummary) => void;
  onHoverChange: (hovered: boolean) => void;
}) {
  const kind = attachmentKind(attachment.mimeType, attachment.filename);
  const iconRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iconHoveredRef = useRef(false);
  const popoverHoveredRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 60,
  });

  function cancelHide() {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }

  function setHovered(hovered: boolean) {
    onHoverChange(hovered);
  }

  function scheduleHide() {
    cancelHide();
    hideTimeoutRef.current = setTimeout(() => {
      if (!iconHoveredRef.current && !popoverHoveredRef.current) {
        setOpen(false);
        setHovered(false);
      }
    }, THUMBNAIL_HIDE_DELAY_MS);
  }

  function showThumbnail() {
    cancelHide();
    setOpen(true);
    setHovered(true);
  }

  useEffect(() => {
    return () => cancelHide();
  }, []);

  useLayoutEffect(() => {
    if (!open || !iconRef.current || !popoverRef.current) return;

    const anchorRect = iconRef.current.getBoundingClientRect();
    const popover = popoverRef.current;

    setPopoverStyle({
      ...computeThumbnailPopoverPosition(
        anchorRect,
        popover.offsetWidth || THUMBNAIL_MAX_WIDTH + 16,
        popover.offsetHeight || THUMBNAIL_MAX_HEIGHT + 40,
      ),
      visibility: "visible",
    });
  }, [open, attachment.id]);

  return (
    <>
      <button
        ref={iconRef}
        type="button"
        aria-label={`Preview ${attachment.filename}`}
        className="shrink-0 rounded p-0.5 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        onMouseEnter={() => {
          iconHoveredRef.current = true;
          showThumbnail();
        }}
        onMouseLeave={() => {
          iconHoveredRef.current = false;
          scheduleHide();
        }}
        onFocus={showThumbnail}
        onBlur={() => {
          iconHoveredRef.current = false;
          scheduleHide();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(attachment);
        }}
      >
        <AttachmentKindIcon kind={kind} />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-max max-w-[min(14rem,calc(100vw-2rem))] cursor-pointer rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(attachment);
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onMouseEnter={() => {
                popoverHoveredRef.current = true;
                cancelHide();
                setHovered(true);
              }}
              onMouseLeave={() => {
                popoverHoveredRef.current = false;
                scheduleHide();
              }}
            >
              <AttachmentThumbnailContent attachment={attachment} />
              <p className="mt-1.5 max-w-[176px] truncate text-xs text-slate-600">
                {attachment.filename}
              </p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function AttachmentListItem({
  attachment,
  onSelect,
  onThumbnailHoverChange,
}: {
  attachment: EmailAttachmentSummary;
  onSelect: (attachment: EmailAttachmentSummary) => void;
  onThumbnailHoverChange: (hovered: boolean) => void;
}) {
  const sizeLabel = formatAttachmentSize(attachment.sizeBytes);

  return (
    <div className="flex w-full min-w-0 items-center gap-2 rounded px-1 py-1.5 hover:bg-slate-50">
      <AttachmentIconWithThumbnail
        attachment={attachment}
        onSelect={onSelect}
        onHoverChange={onThumbnailHoverChange}
      />
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(attachment);
        }}
        className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        <span className="min-w-0 flex-1 text-sm leading-snug text-slate-800">
          {attachment.filename}
        </span>
        {sizeLabel ? (
          <span className="shrink-0 text-xs tabular-nums text-slate-500">
            {sizeLabel}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function AttachmentList({
  attachments,
  onSelect,
  onThumbnailHoverChange,
}: {
  attachments: EmailAttachmentSummary[];
  onSelect: (attachment: EmailAttachmentSummary) => void;
  onThumbnailHoverChange: (hovered: boolean) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <AttachmentListItem
            attachment={attachment}
            onSelect={onSelect}
            onThumbnailHoverChange={onThumbnailHoverChange}
          />
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
  onMouseEnter,
  onMouseLeave,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  title: string;
  children: ReactNode;
  style: CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <div
      ref={panelRef}
      role="tooltip"
      style={style}
      className="w-max min-w-[14rem] max-w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
  const visibilitySettings = useAttachmentVisibilitySettings();

  const visibleAttachments = useMemo(
    () =>
      attachments
        ? filterVisibleAttachments(attachments, "inbox", visibilitySettings)
        : undefined,
    [attachments, visibilitySettings],
  );

  const visibleGroups = useMemo(
    () =>
      groups
        ?.map((group) => ({
          ...group,
          attachments: filterVisibleAttachments(
            group.attachments,
            "inbox",
            visibilitySettings,
          ),
        }))
        .filter((group) => group.attachments.length > 0),
    [groups, visibilitySettings],
  );

  const count =
    visibleAttachments?.length ??
    visibleGroups?.reduce((sum, group) => sum + group.attachments.length, 0) ??
    0;

  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverInstanceId = useRef(Symbol("email-attachments-badge")).current;
  const triggerHoveredRef = useRef(false);
  const popoverHoveredRef = useRef(false);
  const thumbnailHoveredRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] =
    useState<EmailAttachmentSummary | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 50,
  });

  function cancelHide() {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }

  function forceClose() {
    cancelHide();
    triggerHoveredRef.current = false;
    popoverHoveredRef.current = false;
    thumbnailHoveredRef.current = false;
    setOpen(false);
    releaseHoverPopover(popoverInstanceId);
  }

  function scheduleHide() {
    cancelHide();
    hideTimeoutRef.current = setTimeout(() => {
      if (
        !triggerHoveredRef.current &&
        !popoverHoveredRef.current &&
        !thumbnailHoveredRef.current
      ) {
        forceClose();
      }
    }, POPOVER_HIDE_DELAY_MS);
  }

  function showPopover() {
    claimHoverPopover(popoverInstanceId, forceClose);
    cancelHide();
    setOpen(true);
  }

  function handleThumbnailHoverChange(hovered: boolean) {
    thumbnailHoveredRef.current = hovered;
    if (hovered) cancelHide();
    else scheduleHide();
  }

  useEffect(() => {
    return () => {
      cancelHide();
      releaseHoverPopover(popoverInstanceId);
    };
  }, [popoverInstanceId]);

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
  }, [open, visibleAttachments, visibleGroups]);

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
  }, [open, visibleAttachments, visibleGroups]);

  if (count === 0) return null;

  const title =
    visibleGroups && visibleGroups.length > 1
      ? `${count} attachments across ${visibleGroups.length} emails`
      : `${count} attachment${count === 1 ? "" : "s"}`;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={title}
        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-200/80"
        onMouseEnter={() => {
          triggerHoveredRef.current = true;
          showPopover();
        }}
        onMouseLeave={() => {
          triggerHoveredRef.current = false;
          scheduleHide();
        }}
        onFocus={showPopover}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node)) {
            scheduleHide();
          }
        }}
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
              onMouseEnter={() => {
                popoverHoveredRef.current = true;
                cancelHide();
              }}
              onMouseLeave={() => {
                popoverHoveredRef.current = false;
                scheduleHide();
              }}
            >
              {visibleGroups && visibleGroups.length > 0 ? (
                <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                  {visibleGroups.map((group) => (
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
                        onThumbnailHoverChange={handleThumbnailHoverChange}
                      />
                    </div>
                  ))}
                </div>
              ) : visibleAttachments ? (
                <div className="max-h-72 overflow-y-auto pr-1">
                  <AttachmentList
                    attachments={visibleAttachments}
                    onSelect={setPreviewAttachment}
                    onThumbnailHoverChange={handleThumbnailHoverChange}
                  />
                </div>
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
