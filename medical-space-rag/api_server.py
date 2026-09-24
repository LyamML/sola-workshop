"""
Serveur RAG médical — API HTTP minimale pour la borne.

La borne ne peut pas appeler directement le pipeline Python : elle est une
page web. Ce serveur expose un seul point d'entrée que la borne peut
requêter via le proxy Vite (/rag → localhost:8000).

Lancement :
    cd medical-space-rag
    .venv\\Scripts\\activate
    uvicorn api_server:app --port 8000

Le serveur charge les embeddings au démarrage (une fois), puis répond
rapidement à chaque requête de recherche.

CORS : la borne est sur localhost:5173, le serveur RAG sur localhost:8000.
On autorise localhost:5173 explicitement — jamais '*'.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from database import count_chunks, get_connection, init_db
from rag_system import (
    NO_SOURCE_MESSAGE,
    format_sources_for_prompt,
    search_relevant_documents,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialise la base et compte les chunks au démarrage."""
    init_db()
    with get_connection() as conn:
        n = count_chunks(conn)
    logger.info("Base médicale prête : %d chunks indexés.", n)
    if n == 0:
        logger.warning(
            "Aucun chunk trouvé. Lancez `python ingest_documents.py` pour indexer les documents."
        )
    yield


app = FastAPI(
    title="Sola Medical RAG",
    description="Recherche sémantique sur les documents NASA/ESA pour la borne Sola.",
    version="1.0.0",
    lifespan=lifespan,
)

# La borne est servie par Vite sur localhost:5173. On autorise explicitement
# cette origine pour que le proxy Vite puisse relayer les requêtes.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


class SearchRequest(BaseModel):
    question: str = Field(..., min_length=5, max_length=2000)
    k: int = Field(default=3, ge=1, le=10)
    min_similarity: float = Field(default=0.45, ge=0.0, le=1.0)


class SearchResponse(BaseModel):
    context: str
    """Extraits NASA/ESA formatés, prêts à être injectés dans un prompt LLM."""
    sources_found: int
    """Nombre de chunks retenus au-dessus du seuil de similarité."""


@app.post("/search", response_model=SearchResponse)
def search(body: SearchRequest) -> SearchResponse:
    """
    Recherche sémantique dans les documents médicaux NASA/ESA.

    Retourne les passages les plus pertinents pour la question posée,
    formatés pour être injectés directement dans un prompt LLM.

    Si aucun document n'atteint le seuil de similarité, `context` indique
    explicitement qu'aucune source n'a été trouvée — le LLM ne doit pas
    inventer de source.
    """
    try:
        chunks = search_relevant_documents(
            body.question,
            k=body.k,
            min_similarity=body.min_similarity,
        )
    except Exception as exc:
        logger.error("Erreur de recherche RAG : %s", exc)
        raise HTTPException(status_code=500, detail="Erreur de recherche dans la base médicale.") from exc

    context = format_sources_for_prompt(chunks)
    return SearchResponse(context=context, sources_found=len(chunks))


@app.get("/health")
def health() -> dict[str, object]:
    """Vérification rapide de l'état du serveur."""
    try:
        with get_connection() as conn:
            n = count_chunks(conn)
        return {"status": "ok", "chunks": n}
    except Exception as exc:
        logger.error("Erreur de santé RAG : %s", exc)
        raise HTTPException(status_code=503, detail="Base médicale inaccessible.") from exc
