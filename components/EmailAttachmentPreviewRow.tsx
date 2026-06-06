"use client";

import { useState } from "react";

import { EmailAttachmentViewerDialog } from "@/components/EmailAttachmentViewerDialog";
import {
  attachmentKind,
  attachmentKindClasses,
  attachmentKindLabel,
  formatAttachmentSize,
  type EmailAttachmentSummary,
} from "@/lib/email/attachment-display";

type Props = {
  attachments: EmailAttachmentSummary[];
};

export function EmailAttachmentPreviewRow({ attachments }: Props) {
  const [previewAttachment, setPreviewAttachment] =
    useState<EmailAttachmentSummary | null>(null);

  if (attachments.length === 0) return null;

  return (
    <>
      <div className="mb-4 border-b border-slate-100 pb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Attachments ({attachments.length})
        </p>
        <ul className="flex flex-wrap gap-2">
          {attachments.map((attachment) => {
            const kind = attachmentKind(attachment.mimeType);
            const sizeLabel = formatAttachmentSize(attachment.sizeBytes);
            const meta = [attachmentKindLabel(kind), sizeLabel]
              .filter(Boolean)
              .join(" · ");

            return (
              <li key={attachment.id}>
                <button
                  type="button"
                  onClick={() => setPreviewAttachment(attachment)}
                  className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-left text-sm font-medium ring-1 transition hover:ring-2 hover:ring-teal-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${attachmentKindClasses(kind)}`}
                  title={meta ? `${attachment.filename} (${meta})` : attachment.filename}
                >
                  <span className="min-w-0 truncate">{attachment.filename}</span>
                  {sizeLabel ? (
                    <span className="shrink-0 text-xs font-normal tabular-nums opacity-80">
                      {sizeLabel}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <EmailAttachmentViewerDialog
        open={previewAttachment != null}
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
        previewOnly
      />
    </>
  );
}
