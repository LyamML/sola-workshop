"""Phase 1 RAG smoke tests (retrieval + optional Ollama analysis)."""

from __future__ import annotations

import sys
import traceback

from config import OLLAMA_MODEL, RAG_MIN_SIMILARITY
from database import count_chunks, get_connection, init_db
from rag_system import analyze, search_relevant_documents
from user_data import get_user_data_summary

TESTS = [
    {
        "name": "Test 1 - resting HR absolute",
        "question": (
            "The astronaut has a resting heart rate of 82 bpm. "
            "Analyze this value using the available medical spaceflight literature."
        ),
    },
    {
        "name": "Test 2 - rising HR over 7 days",
        "question": (
            "The astronaut's resting heart rate increased from 70 bpm to 84 bpm "
            "over seven days. What information should a physician consider?"
        ),
    },
    {
        "name": "Test 3 - dizziness after standing",
        "question": (
            "The astronaut reports dizziness after standing. "
            "Which NASA or ESA information is relevant?"
        ),
    },
    {
        "name": "Test 4 - reduced sleep",
        "question": (
            "The astronaut has reduced sleep duration for several days. "
            "What physiological factors could be relevant?"
        ),
    },
    {
        "name": "Test 5 - source limitation",
        "question": (
            "Can the available documents determine whether this astronaut "
            "has a specific disease?"
        ),
    },
]


def _print_header(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def run_tests(*, call_llm: bool = True) -> int:
    init_db()

    with get_connection() as conn:
        n_chunks = count_chunks(conn)

    _print_header("Preflight")
    print(f"Chunks in medical_documents: {n_chunks}")
    print(f"OLLAMA_MODEL: {OLLAMA_MODEL}")
    print(f"RAG_MIN_SIMILARITY: {RAG_MIN_SIMILARITY}")
    print("\nUser data summary:\n")
    print(get_user_data_summary(days=7))

    if n_chunks == 0:
        print(
            "\nWARNING: No documents indexed. "
            "Add NASA/ESA PDFs under documents/ and run ingest_documents.py."
        )

    failures = 0

    for spec in TESTS:
        _print_header(spec["name"])
        question = spec["question"]
        print(f"Q: {question}\n")

        try:
            chunks = search_relevant_documents(question)
            print(f"Retrieved chunks above threshold: {len(chunks)}")
            for i, c in enumerate(chunks, start=1):
                page = c.page_number if c.page_number is not None else "n/a"
                print(
                    f"  [{i}] sim={c.similarity:.3f} | {c.organisation} | "
                    f"{c.titre} | p.{page}"
                )

            if spec["name"].startswith("Test 5"):
                # Limitation test: answer must not invent certainty even if chunks exist
                print(
                    "\nNote: model must acknowledge that documents cannot confirm "
                    "a specific disease."
                )

            if call_llm:
                result = analyze(question, include_user_data=True)
                print("\n--- Traceability ---\n")
                print(result["traceability"])
                print("\n--- Answer ---\n")
                print(result["answer"])
            else:
                print("\n(Skipping Ollama call; retrieval-only mode)")

        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAILED: {exc}", file=sys.stderr)
            traceback.print_exc()

    _print_header("Summary")
    print(f"Failures: {failures}/{len(TESTS)}")
    return 1 if failures else 0


if __name__ == "__main__":
    llm = "--retrieval-only" not in sys.argv
    raise SystemExit(run_tests(call_llm=llm))
