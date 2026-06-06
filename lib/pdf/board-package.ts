import { extractPdfPages } from "@/lib/pdf/extract-pages";

export type BoardPackageSelection = {
  sourceFile: File;
  pageCount: number;
  selectedPages: number[];
};

/** Build trimmed PDF file for upload from current selection. */
export async function buildTrimmedBoardPackage(
  selection: BoardPackageSelection,
): Promise<File> {
  const bytes = await extractPdfPages(
    await selection.sourceFile.arrayBuffer(),
    selection.selectedPages,
  );
  const base = selection.sourceFile.name.replace(/\.pdf$/i, "");
  return new File(
    [new Uint8Array(bytes)],
    `${base}-pages-${selection.selectedPages.length}.pdf`,
    { type: "application/pdf" },
  );
}
