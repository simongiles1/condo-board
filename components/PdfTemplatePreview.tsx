"use client";

import { useState } from "react";

import {
  buildPageOneTitle,
  buildPageOneTitleTokens,
  buildTemplatePreviewLayout,
  pctHeightOfMargin,
  pctWidthOfMargin,
  ptToPctX,
  ptToPctY,
  resolveTemplatePreviewValues,
  type PdfTemplatePreviewContext,
  type PdfTemplatePreviewValues,
} from "@/lib/pdf/template-preview";
import { LETTER_HEIGHT, LETTER_WIDTH, type PdfMargins } from "@/lib/pdf/margins";

type PreviewPage = "first" | "continued";
type PreviewMode = "values" | "variables";

function PageMarginChrome({
  margins,
  bodyTop,
}: {
  margins: PdfMargins;
  bodyTop: number;
}) {
  const contentHeightPct =
    100 - pctHeightOfMargin(bodyTop) - pctHeightOfMargin(margins.bottom);

  return (
    <>
      {/* Side and bottom physical margins */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-slate-200/80"
        style={{ height: `${pctHeightOfMargin(margins.bottom)}%` }}
      />
      <div
        className="absolute bg-slate-200/80"
        style={{
          top: `${pctHeightOfMargin(bodyTop)}%`,
          left: 0,
          width: `${pctWidthOfMargin(margins.left)}%`,
          height: `${contentHeightPct}%`,
        }}
      />
      <div
        className="absolute bg-slate-200/80"
        style={{
          top: `${pctHeightOfMargin(bodyTop)}%`,
          right: 0,
          width: `${pctWidthOfMargin(margins.right)}%`,
          height: `${contentHeightPct}%`,
        }}
      />
      {/* Header band above body content */}
      <div
        className="absolute left-0 right-0 top-0 bg-slate-100/90"
        style={{ height: `${pctHeightOfMargin(bodyTop)}%` }}
      />
      {/* Body content region */}
      <div
        className="absolute border border-dashed border-slate-400/70 bg-white"
        style={{
          top: `${pctHeightOfMargin(bodyTop)}%`,
          left: `${pctWidthOfMargin(margins.left)}%`,
          right: `${pctWidthOfMargin(margins.right)}%`,
          bottom: `${pctHeightOfMargin(margins.bottom)}%`,
        }}
      />
    </>
  );
}

function HeaderRuleLine({
  ruleTop,
  margins,
}: {
  ruleTop: number;
  margins: PdfMargins;
}) {
  return (
    <div
      className="absolute bg-slate-900"
      style={{
        top: `${ptToPctY(ruleTop)}%`,
        left: `${ptToPctX(margins.left)}%`,
        width: `${100 - ptToPctX(margins.left) - ptToPctX(margins.right)}%`,
        height: "0.2%",
      }}
    />
  );
}

function PageOneContent({
  margins,
  layout,
  mode,
  values,
}: {
  margins: PdfMargins;
  layout: ReturnType<typeof buildTemplatePreviewLayout>;
  mode: PreviewMode;
  values: PdfTemplatePreviewValues;
}) {
  const title =
    mode === "variables" ? buildPageOneTitleTokens() : buildPageOneTitle(values);
  const titleTop = layout.headerCorpTop;

  return (
    <>
      <p
        className={[
          "absolute px-[1px] text-[8px] leading-[1.25]",
          mode === "variables"
            ? "font-mono text-teal-800"
            : "text-slate-900",
        ].join(" ")}
        style={{
          top: `${ptToPctY(titleTop)}%`,
          left: `${ptToPctX(margins.left)}%`,
          right: `${ptToPctX(margins.right)}%`,
        }}
      >
        {mode === "variables" ? (
          title
        ) : (
          <>
            <span className="font-bold">MINUTES</span>
            <span>{title.slice("MINUTES".length)}</span>
          </>
        )}
      </p>
      <HeaderRuleLine ruleTop={layout.pageOneRuleTop} margins={margins} />
      <p
        className="absolute text-[7px] text-slate-400"
        style={{
          top: `${ptToPctY(layout.pageOneBodyTop + 4)}%`,
          left: `${ptToPctX(margins.left)}%`,
        }}
      >
        Present: …
      </p>
    </>
  );
}

function ContinuedPageContent({
  margins,
  layout,
  mode,
  values,
}: {
  margins: PdfMargins;
  layout: ReturnType<typeof buildTemplatePreviewLayout>;
  mode: PreviewMode;
  values: PdfTemplatePreviewValues;
}) {
  const corpShort = mode === "variables" ? "{corpShort}" : values.corpShort;
  const meetingType =
    mode === "variables" ? "{meetingType}" : values.meetingType;
  const meetingDate =
    mode === "variables" ? "{meetingDate}" : values.meetingDate;
  const pageLabel =
    mode === "variables" ? "Page {pageNumber}" : `Page ${values.pageNumber}`;

  const headerClass = [
    "absolute truncate text-[7px] font-bold leading-tight",
    mode === "variables" ? "font-mono text-teal-800" : "text-slate-900",
  ].join(" ");

  return (
    <>
      <p
        className={headerClass}
        style={{
          top: `${ptToPctY(layout.headerCorpTop)}%`,
          left: `${ptToPctX(margins.left)}%`,
          right: `${ptToPctX(margins.right)}%`,
        }}
      >
        {corpShort}
      </p>
      <p
        className={headerClass}
        style={{
          top: `${ptToPctY(layout.headerMeetingTypeTop)}%`,
          left: `${ptToPctX(margins.left)}%`,
          right: `${ptToPctX(margins.right)}%`,
        }}
      >
        {meetingType}
      </p>
      <p
        className={headerClass}
        style={{
          top: `${ptToPctY(layout.headerDateTop)}%`,
          left: `${ptToPctX(margins.left)}%`,
        }}
      >
        {meetingDate}
      </p>
      <p
        className={[headerClass, "text-right"].join(" ")}
        style={{
          top: `${ptToPctY(layout.headerDateTop)}%`,
          right: `${ptToPctX(margins.right)}%`,
        }}
      >
        {pageLabel}
      </p>
      <HeaderRuleLine ruleTop={layout.headerRuleTop} margins={margins} />
      <p
        className="absolute text-[7px] text-slate-400"
        style={{
          top: `${ptToPctY(layout.pagePaddingTop + 4)}%`,
          left: `${ptToPctX(margins.left)}%`,
        }}
      >
        Body content continues here…
      </p>
    </>
  );
}

function PreviewControls({
  page,
  mode,
  onPageChange,
  onModeChange,
}: {
  page: PreviewPage;
  mode: PreviewMode;
  onPageChange: (page: PreviewPage) => void;
  onModeChange: (mode: PreviewMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
        <button
          type="button"
          onClick={() => onPageChange("first")}
          className={[
            "rounded-lg px-3 py-1.5 transition",
            page === "first"
              ? "bg-white font-semibold text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          ].join(" ")}
        >
          Page 1
        </button>
        <button
          type="button"
          onClick={() => onPageChange("continued")}
          className={[
            "rounded-lg px-3 py-1.5 transition",
            page === "continued"
              ? "bg-white font-semibold text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          ].join(" ")}
        >
          Page 2+
        </button>
      </div>

      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
        <button
          type="button"
          onClick={() => onModeChange("values")}
          className={[
            "rounded-lg px-3 py-1.5 transition",
            mode === "values"
              ? "bg-white font-semibold text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          ].join(" ")}
        >
          Evaluated
        </button>
        <button
          type="button"
          onClick={() => onModeChange("variables")}
          className={[
            "rounded-lg px-3 py-1.5 transition",
            mode === "variables"
              ? "bg-white font-semibold text-teal-800 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          ].join(" ")}
        >
          Variables
        </button>
      </div>
    </div>
  );
}

type Props = {
  margins: PdfMargins;
  previewContext?: PdfTemplatePreviewContext;
};

export function PdfTemplatePreview({ margins, previewContext }: Props) {
  const [page, setPage] = useState<PreviewPage>("first");
  const [mode, setMode] = useState<PreviewMode>("values");

  const layout = buildTemplatePreviewLayout(margins);
  const values = resolveTemplatePreviewValues(previewContext);

  const pageLabel =
    page === "first" ? "Page 1 — title block" : "Page 2+ — running header";

  const bodyTop =
    page === "first" ? layout.pageOneBodyTop : layout.pagePaddingTop;

  return (
    <div className="space-y-4">
      <PreviewControls
        page={page}
        mode={mode}
        onPageChange={setPage}
        onModeChange={setMode}
      />

      <div className="flex flex-col items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          {pageLabel}
        </span>
        <div
          className="relative w-full max-w-[480px] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md"
          style={{ aspectRatio: `${LETTER_WIDTH} / ${LETTER_HEIGHT}` }}
        >
          <PageMarginChrome margins={margins} bodyTop={bodyTop} />
          {page === "first" ? (
            <PageOneContent
              margins={margins}
              layout={layout}
              mode={mode}
              values={values}
            />
          ) : (
            <ContinuedPageContent
              margins={margins}
              layout={layout}
              mode={mode}
              values={values}
            />
          )}
        </div>
      </div>

      <p className="text-center text-xs text-slate-500">
        Grey side/bottom areas are margins; the pale band is the header zone;
        dashed box is body content. Black lines are the page 1 and page 2+
        horizontal rules (each controlled separately).
        {mode === "values" &&
        (previewContext?.corporationName || previewContext?.meetingDate)
          ? " Showing this meeting's values."
          : mode === "values"
            ? " Showing sample values."
            : " Showing variable tokens."}
      </p>
    </div>
  );
}
