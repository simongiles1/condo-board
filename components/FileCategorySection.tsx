import Link from "next/link";

import {
  attachmentKind,
  attachmentKindClasses,
  attachmentKindLabel,
  formatAttachmentSize,
} from "@/lib/email/attachment-display";
import {
  FILE_CATEGORY_LABELS,
  type CategorizedFile,
  type FileCategory,
} from "@/lib/email/file-categories";
import { formatDateTime } from "@/lib/format/datetime";

function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

function FileRow({ file }: { file: CategorizedFile }) {
  const kind = attachmentKind(file.mimeType);
  const sizeLabel = formatAttachmentSize(file.sizeBytes);
  const emailHref = file.threadId ? `/knowledge/emails/${file.threadId}` : null;

  return (
    <li className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 text-sm font-medium text-slate-900">
            {file.filename}
          </p>
          <span
            className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${attachmentKindClasses(kind)}`}
          >
            {attachmentKindLabel(kind)}
          </span>
          {sizeLabel ? (
            <span className="shrink-0 text-xs tabular-nums text-slate-500">
              {sizeLabel}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-slate-500">From {file.fromAddress}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <time
          dateTime={file.receivedAt}
          className="whitespace-nowrap text-xs text-slate-500"
        >
          {formatDateTime(file.receivedAt)}
        </time>
        {emailHref ? (
          <Link
            href={emailHref}
            aria-label="View email thread"
            className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-teal-700"
          >
            <ExternalLinkIcon />
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export function FileCategorySection({
  category,
  files,
  showHeader = true,
  scrollable = false,
}: {
  category: FileCategory;
  files: CategorizedFile[];
  showHeader?: boolean;
  scrollable?: boolean;
}) {
  const label = FILE_CATEGORY_LABELS[category];

  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${
        scrollable ? "flex min-h-0 flex-1 flex-col overflow-hidden" : ""
      }`}
    >
      {showHeader ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">{label}</h2>
          <span className="text-xs tabular-nums text-slate-500">
            {files.length} file{files.length === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}

      {files.length === 0 ? (
        <div
          className={`px-4 py-8 text-center text-sm text-slate-500 ${
            scrollable ? "flex flex-1 items-center justify-center" : ""
          }`}
        >
          No files in this category yet.
        </div>
      ) : (
        <ul className={scrollable ? "min-h-0 flex-1 overflow-y-auto" : undefined}>
          {files.map((file) => (
            <FileRow key={file.id} file={file} />
          ))}
        </ul>
      )}
    </section>
  );
}
