"""PDF ingestion: extract, clean, chunk, embed, store in SQLite."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

import pymupdf

from config import CHUNK_OVERLAP_WORDS, CHUNK_SIZE_WORDS, DOCUMENTS_DIR
from database import (
    count_chunks,
    delete_document_chunks,
    get_connection,
    init_db,
    insert_chunk,
)


@dataclass
class PageText:
    page_number: int
    text: str


@dataclass
class TextChunk:
    chunk_index: int
    contenu: str
    page_number: int | None


def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_pdf_pages(pdf_path: Path) -> list[PageText]:
    pages: list[PageText] = []
    with pymupdf.open(pdf_path) as doc:
        for i, page in enumerate(doc):
            raw = page.get_text("text") or ""
            cleaned = clean_text(raw)
            if cleaned:
                pages.append(PageText(page_number=i + 1, text=cleaned))
    return pages


def chunk_text(
    pages: list[PageText],
    chunk_size: int = CHUNK_SIZE_WORDS,
    overlap: int = CHUNK_OVERLAP_WORDS,
) -> list[TextChunk]:
    """
    Chunk approximately by words while preserving page association.

    Words are tagged with the page they came from; each chunk records the
    page of its first word.
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap must be >= 0 and < chunk_size")

    tagged: list[tuple[str, int]] = []
    for page in pages:
        for word in page.text.split():
            if word:
                tagged.append((word, page.page_number))

    if not tagged:
        return []

    chunks: list[TextChunk] = []
    start = 0
    chunk_index = 0
    n = len(tagged)

    while start < n:
        end = min(start + chunk_size, n)
        window = tagged[start:end]
        contenu = " ".join(w for w, _ in window)
        page_number = window[0][1]
        chunks.append(
            TextChunk(
                chunk_index=chunk_index,
                contenu=contenu,
                page_number=page_number,
            )
        )
        chunk_index += 1
        if end >= n:
            break
        start = end - overlap

    return chunks


def infer_metadata(pdf_path: Path, documents_root: Path) -> dict[str, str]:
    """Derive document_id, organisation, category, titre from path."""
    relative = pdf_path.relative_to(documents_root)
    parts = relative.parts
    organisation = parts[0].upper() if parts else "UNKNOWN"
    category = parts[1] if len(parts) > 1 else "general"
    document_id = pdf_path.stem
    titre = document_id.replace("_", " ")
    source = str(relative).replace("\\", "/")
    return {
        "document_id": document_id,
        "titre": titre,
        "organisation": organisation,
        "category": category,
        "source": source,
    }


def discover_pdfs(documents_root: Path) -> list[Path]:
    if not documents_root.exists():
        return []
    return sorted(documents_root.rglob("*.pdf"))


def ingest_pdf(pdf_path: Path, documents_root: Path = DOCUMENTS_DIR) -> int:
    """Ingest one PDF. Returns number of chunks inserted."""
    from embeddings import embed_texts

    meta = infer_metadata(pdf_path, documents_root)
    pages = extract_pdf_pages(pdf_path)
    chunks = chunk_text(pages)
    if not chunks:
        print(f"  skip (no text): {pdf_path.name}")
        return 0

    embeddings = embed_texts([c.contenu for c in chunks])

    with get_connection() as conn:
        delete_document_chunks(conn, meta["document_id"])
        for chunk, vector in zip(chunks, embeddings):
            insert_chunk(
                conn,
                document_id=meta["document_id"],
                titre=meta["titre"],
                chunk_index=chunk.chunk_index,
                contenu=chunk.contenu,
                embedding=vector,
                source=meta["source"],
                organisation=meta["organisation"],
                category=meta["category"],
                page_number=chunk.page_number,
            )

        print(
            f"  indexed {len(chunks)} chunks - "
            f"{meta['organisation']} / {meta['category']} / {pdf_path.name}"
        )
    return len(chunks)


def ingest_all(documents_root: Path = DOCUMENTS_DIR) -> int:
    init_db()
    pdfs = discover_pdfs(documents_root)
    if not pdfs:
        print(
            f"No PDF files found under {documents_root}.\n"
            "Add official NASA/ESA documents, then re-run."
        )
        return 0

    print(f"Found {len(pdfs)} PDF(s) under {documents_root}")
    total = 0
    for pdf in pdfs:
        try:
            total += ingest_pdf(pdf, documents_root)
        except Exception as exc:  # noqa: BLE001 — report and continue
            print(f"  ERROR {pdf}: {exc}", file=sys.stderr)
    with get_connection() as conn:
        print(f"Done. Total chunks in DB: {count_chunks(conn)}")
    return total


if __name__ == "__main__":
    ingest_all()
