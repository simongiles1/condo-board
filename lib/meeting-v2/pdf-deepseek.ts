type PdfPageText = {
  pageNumber: number;
  heading: string | null;
  text: string;
};

export async function maybeCleanupPdfPagesWithDeepSeek(
  pages: PdfPageText[],
): Promise<PdfPageText[]> {
  return pages;
}
