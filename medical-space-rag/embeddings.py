"""Embedding model wrapper for Phase 1 RAG."""

from __future__ import annotations

from functools import lru_cache
from typing import Sequence

from sentence_transformers import SentenceTransformer

from config import EMBEDDING_MODEL


@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    return SentenceTransformer(EMBEDDING_MODEL)


def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    """Embed one or more texts; returns list of float vectors."""
    if not texts:
        return []
    model = get_embedding_model()
    vectors = model.encode(
        list(texts),
        normalize_embeddings=False,
        show_progress_bar=False,
    )
    return [v.tolist() for v in vectors]


def embed_text(text: str) -> list[float]:
    return embed_texts([text])[0]
