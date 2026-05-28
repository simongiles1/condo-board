"use client";

import { useEffect, useState } from "react";

import { MediaPreviewDialog } from "@/components/MediaPreviewDialog";
import {
  attachmentKind,
  attachmentKindLabel,
  emailAttachmentApiUrl,
  formatAttachmentSize,
  type EmailAttachmentSummary,
} from "@/lib/email/attachment-display";

type Props = {
  open: boolean;
  attachment: EmailAttachmentSummary | null;
  onClose: () => void;
};

export function EmailAttachmentViewerDialog({
  open,
  attachment,
  onClose,
}: Props) {
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setLoadError(false);
  }, [attachment?.id, open]);

  if (!attachment) return null;

  const kind = attachmentKind(attachment.mimeType);
  const sizeLabel = formatAttachmentSize(attachment.sizeBytes);
  const url = emailAttachmentApiUrl(attachment.id);
  const downloadUrl = `${url}?download=1`;

  const subtitle = [attachmentKindLabel(kind), sizeLabel].filter(Boolean).join(" · ");

  return (
    <MediaPreviewDialog
      open={open}
      title={attachment.filename}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <a
            href={downloadUrl}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          >
            Download
          </a>
        </div>
      }
    >
      {kind === "image" ? (
        loadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            Could not load image preview.
          </div>
        ) : (
          <div className="flex min-h-[50dvh] items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={attachment.id}
              src={url}
              alt={attachment.filename}
              onLoad={() => setLoadError(false)}
              onError={() => setLoadError(true)}
              className="max-h-[75dvh] max-w-full rounded-lg object-contain shadow-sm"
            />
          </div>
        )
      ) : kind === "pdf" ? (
        <iframe
          key={attachment.id}
          src={url}
          title={attachment.filename}
          className="h-[75dvh] w-full rounded-lg border border-slate-200 bg-white"
        />
      ) : (
        <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-700">
            Preview is not available for this file type.
          </p>
          <a
            href={downloadUrl}
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          >
            Download file
          </a>
        </div>
      )}
    </MediaPreviewDialog>
  );
}
