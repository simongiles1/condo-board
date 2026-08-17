"""
Local Docling sidecar for Extraction Lab A/B (not production pipeline).

Supports whole-PDF or page-scoped conversion (text-route pages for mixed docs).

Run via: npm run docling:sidecar
Env:
  ATTACHMENTS_ROOT — directory of {contentHash}.pdf (default: <cwd>/data/email-attachments)
  DOCLING_SIDECAR_HOST — bind host (default 127.0.0.1)
  DOCLING_SIDECAR_PORT — bind port (default 5001)
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path

# Windows: torch.compile needs MSVC `cl`; disable before importing torch/docling.
os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")
os.environ.setdefault("TORCH_COMPILE_DISABLE", "1")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

HASH_RE = re.compile(r"^[a-f0-9]{64}$")

ATTACHMENTS_ROOT = Path(
    os.environ.get(
        "ATTACHMENTS_ROOT",
        str(Path.cwd() / "data" / "email-attachments"),
    )
).resolve()

app = FastAPI(title="Condo Board Docling Sidecar", version="0.2.0")

_converter: DocumentConverter | None = None


def get_converter() -> DocumentConverter:
    global _converter
    if _converter is None:
        pipeline_options = PdfPipelineOptions()
        pipeline_options.accelerator_options = AcceleratorOptions(
            device=AcceleratorDevice.CPU,
        )
        _converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
            }
        )
    return _converter


def collapse_page_ranges(pages: list[int]) -> list[tuple[int, int]]:
    """Collapse sorted unique 1-based page numbers into inclusive (start, end) ranges."""
    unique = sorted({int(p) for p in pages if int(p) >= 1})
    if not unique:
        return []
    ranges: list[tuple[int, int]] = []
    start = prev = unique[0]
    for page in unique[1:]:
        if page == prev + 1:
            prev = page
            continue
        ranges.append((start, prev))
        start = prev = page
    ranges.append((start, prev))
    return ranges


class ConvertRequest(BaseModel):
    content_hash: str = Field(..., description="64-char hex content hash")
    pages: list[int] | None = Field(
        default=None,
        description="Optional 1-based page numbers to convert (e.g. text-route only). "
        "Omitting converts the full PDF.",
    )


class PageMarkdown(BaseModel):
    page_no: int
    markdown: str


class ConvertResponse(BaseModel):
    content_hash: str
    markdown: str
    pages: list[PageMarkdown]
    elapsed_ms: int
    page_count: int | None = None
    requested_pages: list[int] | None = None


@app.get("/health")
def health() -> dict[str, str | bool | int]:
    return {
        "ok": True,
        "version": "0.2.0",
        "attachments_root": str(ATTACHMENTS_ROOT),
        "attachments_root_exists": ATTACHMENTS_ROOT.is_dir(),
    }


def resolve_pdf(content_hash: str) -> Path:
    if not HASH_RE.match(content_hash):
        raise HTTPException(status_code=400, detail="content_hash must be 64 hex chars.")

    pdf_path = (ATTACHMENTS_ROOT / f"{content_hash}.pdf").resolve()
    try:
        pdf_path.relative_to(ATTACHMENTS_ROOT)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid path.") from exc

    if not pdf_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="PDF not found for hash under attachments root.",
        )
    return pdf_path


@app.post("/convert", response_model=ConvertResponse)
def convert(body: ConvertRequest) -> ConvertResponse:
    content_hash = body.content_hash.strip().lower()
    pdf_path = resolve_pdf(content_hash)

    requested: list[int] | None = None
    if body.pages is not None:
        requested = sorted({int(p) for p in body.pages if int(p) >= 1})
        if not requested:
            raise HTTPException(
                status_code=400,
                detail="pages must include at least one page number >= 1.",
            )

    started = time.perf_counter()
    page_markdowns: list[PageMarkdown] = []

    try:
        converter = get_converter()
        if requested is None:
            result = converter.convert(str(pdf_path))
            doc = result.document
            try:
                page_nos = sorted(int(p) for p in doc.pages.keys())  # type: ignore[attr-defined]
            except Exception:
                page_nos = []
            if not page_nos:
                full = doc.export_to_markdown().strip()
                page_markdowns.append(PageMarkdown(page_no=1, markdown=full))
            else:
                for page_no in page_nos:
                    md = doc.export_to_markdown(page_no=page_no).strip()
                    page_markdowns.append(PageMarkdown(page_no=page_no, markdown=md))
        else:
            for start, end in collapse_page_ranges(requested):
                result = converter.convert(
                    str(pdf_path),
                    page_range=(start, end),
                )
                doc = result.document
                for page_no in range(start, end + 1):
                    md = doc.export_to_markdown(page_no=page_no).strip()
                    page_markdowns.append(PageMarkdown(page_no=page_no, markdown=md))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Docling conversion failed: {exc}",
        ) from exc

    page_markdowns.sort(key=lambda p: p.page_no)
    blocks = [
        f"<!-- docling:page={p.page_no} -->\n{p.markdown}\n<!-- /docling:page={p.page_no} -->"
        for p in page_markdowns
        if p.markdown
    ]
    markdown = "\n\n".join(blocks).strip()
    if not markdown:
        raise HTTPException(status_code=500, detail="Docling returned empty markdown.")

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return ConvertResponse(
        content_hash=content_hash,
        markdown=markdown,
        pages=page_markdowns,
        elapsed_ms=elapsed_ms,
        page_count=len(page_markdowns),
        requested_pages=requested,
    )
