"""RAG pipeline: semantic search + Ollama medical analysis."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import ollama

from config import (
    OLLAMA_HOST,
    OLLAMA_MODEL,
    OLLAMA_NUM_CTX,
    OLLAMA_THINK,
    RAG_MIN_SIMILARITY,
    RAG_TOP_K,
)
from database import blob_to_embedding, fetch_all_document_rows, get_connection, init_db
from embeddings import embed_text
from user_data import get_user_data_summary

SYSTEM_PROMPT = """SYSTEM ROLE

You are a medical decision-support assistant specialized in space medicine.

Your role is to assist a qualified medical professional by analyzing physiological data and relevant medical literature.

You are NOT the final medical decision-maker.

Rules:

1. Do not invent medical facts.
2. Do not invent sources.
3. Use the retrieved NASA/ESA sources whenever relevant.
4. Clearly distinguish observations from interpretations.
5. Clearly communicate uncertainty.
6. Identify missing information.
7. Highlight potentially urgent findings.
8. Do not claim to diagnose a disease from insufficient information.
9. Do not recommend a treatment as a definitive medical prescription.
10. If the retrieved documents do not support a conclusion, explicitly say so.
11. Cite the source title and page when available.
12. Only cite documents that appear in the RETRIEVED SOURCES section of the user message. Never invent a document title, page number, NASA requirement, ESA recommendation, medical threshold, or study result.
13. Respond in English using the required response structure.
14. Do not use the word "diagnosis" to present a hypothesis as a confirmed disease.

Required response structure:

## Clinical Data Summary

## Observations

## Potentially Relevant Findings

## Possible Explanations

## Missing Information

## Risk / Urgency Considerations

## Recommended Medical Review

## Sources
"""

NO_SOURCE_MESSAGE = (
    "No sufficiently relevant medical source was retrieved."
)

RESPONSE_SECTIONS = (
    "## Clinical Data Summary",
    "## Observations",
    "## Potentially Relevant Findings",
    "## Possible Explanations",
    "## Missing Information",
    "## Risk / Urgency Considerations",
    "## Recommended Medical Review",
    "## Sources",
)


@dataclass
class RetrievedChunk:
    id: int
    document_id: str
    titre: str
    chunk_index: int
    contenu: str
    source: str
    organisation: str | None
    category: str | None
    page_number: int | None
    similarity: float


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


def search_relevant_documents(
    question: str,
    k: int | None = None,
    min_similarity: float | None = None,
) -> list[RetrievedChunk]:
    """Embed the question and return top-k chunks above the similarity threshold."""
    top_k = RAG_TOP_K if k is None else k
    threshold = RAG_MIN_SIMILARITY if min_similarity is None else min_similarity

    query_vec = np.asarray(embed_text(question), dtype=np.float32)

    with get_connection() as conn:
        rows = fetch_all_document_rows(conn)

    scored: list[RetrievedChunk] = []
    for row in rows:
        emb = blob_to_embedding(row["embedding"])
        sim = cosine_similarity(query_vec, emb)
        scored.append(
            RetrievedChunk(
                id=row["id"],
                document_id=row["document_id"],
                titre=row["titre"],
                chunk_index=row["chunk_index"],
                contenu=row["contenu"],
                source=row["source"],
                organisation=row["organisation"],
                category=row["category"],
                page_number=row["page_number"],
                similarity=sim,
            )
        )

    scored.sort(key=lambda c: c.similarity, reverse=True)
    filtered = [c for c in scored if c.similarity >= threshold]
    return filtered[:top_k]


def format_sources_for_prompt(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return NO_SOURCE_MESSAGE

    blocks: list[str] = []
    for i, c in enumerate(chunks, start=1):
        page = f"p. {c.page_number}" if c.page_number is not None else "page n/a"
        blocks.append(
            f"[{i}] {c.titre} ({c.organisation or 'UNKNOWN'}, {c.category or 'n/a'}, {page})\n"
            f"source file: {c.source}\n"
            f"similarity: {c.similarity:.3f}\n"
            f"excerpt:\n{c.contenu}"
        )
    return "\n\n".join(blocks)


def format_traceability(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return "No retrieved chunks above similarity threshold."

    lines: list[str] = []
    for i, c in enumerate(chunks, start=1):
        lines.append(
            f"--- Retrieved #{i} ---\n"
            f"SOURCE: {c.organisation or 'UNKNOWN'}\n"
            f"DOCUMENT: {c.titre}\n"
            f"DOCUMENT_ID: {c.document_id}\n"
            f"PAGE: {c.page_number if c.page_number is not None else 'n/a'}\n"
            f"SIMILARITY: {c.similarity:.4f}\n"
            f"CATEGORY: {c.category or 'n/a'}\n"
            f"FILE: {c.source}\n"
            f"CHUNK:\n{c.contenu[:500]}{'...' if len(c.contenu) > 500 else ''}"
        )
    return "\n\n".join(lines)


def build_user_prompt(
    question: str,
    chunks: list[RetrievedChunk],
    user_summary: str | None,
) -> str:
    vitals = user_summary or "No physiological summary available."
    sources = format_sources_for_prompt(chunks)
    guidance = (
        "Use only the retrieved sources below. "
        "If sources are insufficient, state that clearly."
        if chunks
        else (
            f"{NO_SOURCE_MESSAGE} "
            "Explicitly tell the clinician that no sufficiently relevant "
            "documentary source was retrieved, and do not invent sources."
        )
    )
    sections = "\n".join(RESPONSE_SECTIONS)
    return (
        f"PHYSIOLOGICAL DATA SUMMARY\n{vitals}\n\n"
        f"CLINICAL QUESTION\n{question}\n\n"
        f"RETRIEVED SOURCES\n{sources}\n\n"
        f"INSTRUCTIONS\n{guidance}\n"
        "Answer the CLINICAL QUESTION directly. If the retrieved sources cannot "
        "answer it, say so explicitly instead of summarizing unrelated content.\n"
        "State uncertainty and missing information explicitly.\n"
        "Respond in English using exactly these section headings, in this order:\n"
        f"{sections}"
    )


def call_ollama(system_prompt: str, user_prompt: str) -> str:
    client = ollama.Client(host=OLLAMA_HOST)
    response = client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        options={"num_ctx": OLLAMA_NUM_CTX},
        think=OLLAMA_THINK,
    )
    message = response.get("message") or {}
    content = message.get("content")
    if not content:
        raise RuntimeError(f"Empty Ollama response: {response!r}")
    return str(content)


def analyze(
    question: str,
    *,
    days: int = 7,
    include_user_data: bool = True,
    k: int | None = None,
    min_similarity: float | None = None,
) -> dict[str, Any]:
    """
    Full RAG pass: retrieve chunks, optionally attach vitals, call Ollama.

    Returns dict with question, chunks, traceability, answer, and flags.
    """
    init_db()
    chunks = search_relevant_documents(
        question, k=k, min_similarity=min_similarity
    )
    user_summary = get_user_data_summary(days=days) if include_user_data else None
    user_prompt = build_user_prompt(question, chunks, user_summary)
    answer = call_ollama(SYSTEM_PROMPT, user_prompt)

    return {
        "question": question,
        "chunks": chunks,
        "sources_found": bool(chunks),
        "user_summary": user_summary,
        "traceability": format_traceability(chunks),
        "answer": answer,
        "model": OLLAMA_MODEL,
    }


if __name__ == "__main__":
    demo = (
        "The astronaut has a resting heart rate of 82 bpm. "
        "Analyze this value using the available medical spaceflight literature."
    )
    result = analyze(demo)
    print(result["traceability"])
    print("\n==== ANSWER ====\n")
    print(result["answer"])
