"""Load Phase 1 configuration from config.env / environment."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent
DOCUMENTS_DIR = ROOT_DIR / "documents"

_env_path = ROOT_DIR / "config.env"
if _env_path.exists():
    load_dotenv(_env_path)
else:
    load_dotenv(ROOT_DIR / "config.env.example")


def _float(name: str, default: float) -> float:
    return float(os.getenv(name, str(default)))


def _int(name: str, default: int) -> int:
    return int(os.getenv(name, str(default)))


DB_PATH = Path(os.getenv("DB_PATH", "medical_app.db"))
if not DB_PATH.is_absolute():
    DB_PATH = ROOT_DIR / DB_PATH

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "YOUR_MEDICAL_ENGLISH_MODEL")
# Prompt + answer must fit in num_ctx, otherwise Ollama silently drops the
# start of the conversation (the system prompt).
OLLAMA_NUM_CTX = _int("OLLAMA_NUM_CTX", 8192)
OLLAMA_THINK = os.getenv("OLLAMA_THINK", "false").strip().lower() in ("1", "true", "yes")

EMBEDDING_MODEL = os.getenv(
    "EMBEDDING_MODEL",
    "sentence-transformers/all-MiniLM-L6-v2",
)

RAG_TOP_K = _int("RAG_TOP_K", 5)
RAG_MIN_SIMILARITY = _float("RAG_MIN_SIMILARITY", 0.45)

CHUNK_SIZE_WORDS = _int("CHUNK_SIZE_WORDS", 800)
CHUNK_OVERLAP_WORDS = _int("CHUNK_OVERLAP_WORDS", 120)

EMBEDDING_DIM = 384
