import {
  DEFAULT_PDF_MARGINS,
  LETTER_HEIGHT,
  LETTER_WIDTH,
  normalizePdfMargins,
  type PdfMargins,
} from "@/lib/pdf/margins";

export type DraftPdfMargins = Record<keyof PdfMargins, string>;

export function draftPdfMarginsFrom(margins: PdfMargins): DraftPdfMargins {
  return {
    top: String(margins.top),
    bottom: String(margins.bottom),
    left: String(margins.left),
    right: String(margins.right),
    pageOneRuleTop: String(margins.pageOneRuleTop),
    headerRuleTop: String(margins.headerRuleTop),
  };
}

export function defaultDraftPdfMargins(): DraftPdfMargins {
  return draftPdfMarginsFrom(DEFAULT_PDF_MARGINS);
}

export function normalizeDraftPdfMargins(draft: DraftPdfMargins): PdfMargins {
  return normalizePdfMargins({
    top: draft.top,
    bottom: draft.bottom,
    left: draft.left,
    right: draft.right,
    pageOneRuleTop: draft.pageOneRuleTop,
    headerRuleTop: draft.headerRuleTop,
  });
}

function MarginPreview({ margins }: { margins: PdfMargins }) {
  const contentHeight = Math.max(
    0,
    LETTER_HEIGHT - margins.top - margins.bottom,
  );
  const contentWidth = Math.max(
    0,
    LETTER_WIDTH - margins.left - margins.right,
  );

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${LETTER_WIDTH} ${LETTER_HEIGHT}`}
        className="h-auto w-full max-w-[220px] rounded border border-slate-300 bg-white shadow-sm"
        aria-hidden
      >
        <rect
          x={0}
          y={0}
          width={LETTER_WIDTH}
          height={margins.top}
          fill="#e2e8f0"
        />
        <rect
          x={0}
          y={LETTER_HEIGHT - margins.bottom}
          width={LETTER_WIDTH}
          height={margins.bottom}
          fill="#e2e8f0"
        />
        <rect
          x={0}
          y={margins.top}
          width={margins.left}
          height={contentHeight}
          fill="#e2e8f0"
        />
        <rect
          x={LETTER_WIDTH - margins.right}
          y={margins.top}
          width={margins.right}
          height={contentHeight}
          fill="#e2e8f0"
        />
        <rect
          x={margins.left}
          y={margins.top}
          width={contentWidth}
          height={contentHeight}
          fill="#ffffff"
          stroke="#94a3b8"
          strokeWidth={1}
        />
        <line
          x1={margins.left}
          y1={margins.pageOneRuleTop}
          x2={LETTER_WIDTH - margins.right}
          y2={margins.pageOneRuleTop}
          stroke="#000000"
          strokeWidth={1.5}
        />
        <line
          x1={margins.left}
          y1={margins.headerRuleTop}
          x2={LETTER_WIDTH - margins.right}
          y2={margins.headerRuleTop}
          stroke="#000000"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      </svg>
      <p className="text-center text-xs text-slate-500">
        Grey areas are margins; white is the content region. Solid line is the
        page 1 rule; dashed line is the pages 2+ rule.
      </p>
    </div>
  );
}

function marginField(
  id: keyof PdfMargins,
  label: string,
  value: string,
  onChange: (id: keyof PdfMargins, value: string) => void,
  options?: { max?: number; hint?: string },
) {
  return (
    <div className="space-y-1">
      <label htmlFor={`pdf-margin-${id}`} className="text-sm font-semibold text-slate-800">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`pdf-margin-${id}`}
          type="number"
          min={0}
          max={options?.max ?? 144}
          step={1}
          value={value}
          onChange={(event) => onChange(id, event.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
        />
        <span className="shrink-0 text-xs text-slate-500">pt</span>
      </div>
      {options?.hint ? (
        <p className="text-xs text-slate-500">{options.hint}</p>
      ) : null}
    </div>
  );
}

type Props = {
  draft: DraftPdfMargins;
  onChange: (id: keyof PdfMargins, value: string) => void;
  showPreview?: boolean;
};

export function PdfMarginsFields({
  draft,
  onChange,
  showPreview = true,
}: Props) {
  const previewMargins = normalizeDraftPdfMargins(draft);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {marginField("top", "Top", draft.top, onChange)}
        {marginField("bottom", "Bottom", draft.bottom, onChange)}
        {marginField("left", "Left", draft.left, onChange)}
        {marginField("right", "Right", draft.right, onChange)}
      </div>

      {marginField(
        "pageOneRuleTop",
        "Page 1 rule from top",
        draft.pageOneRuleTop,
        onChange,
        {
          max: LETTER_HEIGHT,
          hint: "Distance from the page top to the horizontal rule below the title block.",
        },
      )}

      {marginField(
        "headerRuleTop",
        "Page 2+ rule from top",
        draft.headerRuleTop,
        onChange,
        {
          max: LETTER_HEIGHT,
          hint: "Distance from the page top to the horizontal rule below the running header.",
        },
      )}

      {showPreview ? <MarginPreview margins={previewMargins} /> : null}
    </div>
  );
}
