export type EmailAttachmentSummary = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
};

export type ThreadAttachmentGroup = {
  emailId: string;
  fromAddress: string;
  receivedAt: string;
  attachments: EmailAttachmentSummary[];
};

export function formatAttachmentSize(sizeBytes: number | null): string | null {
  if (sizeBytes == null || sizeBytes <= 0) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentKind(mimeType: string): "image" | "pdf" | "doc" | "sheet" | "file" {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (
    mime.includes("word") ||
    mime.includes("document") ||
    mime.endsWith(".document")
  ) {
    return "doc";
  }
  if (
    mime.includes("sheet") ||
    mime.includes("excel") ||
    mime.includes("spreadsheet")
  ) {
    return "sheet";
  }
  return "file";
}

export function attachmentKindLabel(kind: ReturnType<typeof attachmentKind>): string {
  switch (kind) {
    case "image":
      return "Image";
    case "pdf":
      return "PDF";
    case "doc":
      return "Document";
    case "sheet":
      return "Spreadsheet";
    default:
      return "File";
  }
}

export function emailAttachmentApiUrl(attachmentId: string): string {
  return `/api/email/attachments/${attachmentId}`;
}

export function attachmentKindClasses(kind: ReturnType<typeof attachmentKind>): string {
  switch (kind) {
    case "image":
      return "bg-violet-50 text-violet-700 ring-violet-100";
    case "pdf":
      return "bg-red-50 text-red-700 ring-red-100";
    case "doc":
      return "bg-blue-50 text-blue-700 ring-blue-100";
    case "sheet":
      return "bg-emerald-50 text-emerald-700 ring-emerald-100";
    default:
      return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}
