"""SQLite schema and helpers for Phase 1 medical RAG."""

from __future__ import annotations

import array
import sqlite3
from contextlib import contextmanager
from typing import Iterator, Sequence

import numpy as np

from config import DB_PATH, EMBEDDING_DIM


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    poids REAL,
    fc_repos INTEGER,
    sommeil REAL,
    temperature REAL,
    activite INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medical_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    titre TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    contenu TEXT NOT NULL,
    embedding BLOB NOT NULL,
    source TEXT NOT NULL,
    organisation TEXT,
    category TEXT,
    page_number INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_medical_documents_document_id
    ON medical_documents(document_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_medical_documents_doc_chunk
    ON medical_documents(document_id, chunk_index);
"""


def embedding_to_blob(vector: Sequence[float]) -> bytes:
    """Serialize a float embedding to a float32 BLOB."""
    arr = array.array("f", vector)
    if len(arr) != EMBEDDING_DIM:
        raise ValueError(
            f"Expected embedding dim {EMBEDDING_DIM}, got {len(arr)}"
        )
    return arr.tobytes()


def blob_to_embedding(blob: bytes) -> np.ndarray:
    """Deserialize a float32 BLOB into a numpy vector."""
    arr = array.array("f")
    arr.frombytes(blob)
    return np.asarray(arr, dtype=np.float32)


@contextmanager
def get_connection(db_path: str | None = None) -> Iterator[sqlite3.Connection]:
    path = str(db_path or DB_PATH)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: str | None = None) -> None:
    """Create tables if they do not exist."""
    with get_connection(db_path) as conn:
        conn.executescript(SCHEMA_SQL)


def delete_document_chunks(conn: sqlite3.Connection, document_id: str) -> None:
    conn.execute(
        "DELETE FROM medical_documents WHERE document_id = ?",
        (document_id,),
    )


def insert_chunk(
    conn: sqlite3.Connection,
    *,
    document_id: str,
    titre: str,
    chunk_index: int,
    contenu: str,
    embedding: Sequence[float],
    source: str,
    organisation: str | None,
    category: str | None,
    page_number: int | None,
) -> None:
    conn.execute(
        """
        INSERT INTO medical_documents (
            document_id, titre, chunk_index, contenu, embedding,
            source, organisation, category, page_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            document_id,
            titre,
            chunk_index,
            contenu,
            embedding_to_blob(embedding),
            source,
            organisation,
            category,
            page_number,
        ),
    )


def fetch_all_document_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            """
            SELECT
                id,
                document_id,
                titre,
                chunk_index,
                contenu,
                source,
                organisation,
                category,
                page_number,
                embedding
            FROM medical_documents
            """
        )
    )


def count_chunks(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT COUNT(*) AS n FROM medical_documents").fetchone()
    return int(row["n"]) if row else 0


if __name__ == "__main__":
    init_db()
    print(f"Initialized database at {DB_PATH}")
