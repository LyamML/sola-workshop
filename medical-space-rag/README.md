# Medical Space RAG — Phase 1

Local RAG for space-medicine decision support: SQLite + MiniLM embeddings + Ollama.

## Prerequisites

1. Python 3.11+
2. [Ollama](https://ollama.com) running locally with an English/medical model:
   ```bash
   ollama pull <your_model>
   ```
3. Official NASA/ESA PDFs placed under `documents/` (see folder layout below). Do not invent or auto-scrape documents.

## Setup

```bash
cd medical-space-rag
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
copy config.env.example config.env   # Windows
# cp config.env.example config.env   # macOS/Linux
```

Edit `config.env` and set `OLLAMA_MODEL` to the exact Ollama model name.

## Document layout

```text
documents/
├── nasa/
│   ├── standards/
│   │   ├── NASA_STD_3001_VOL1_CREW_HEALTH.pdf
│   │   └── NASA_STD_3001_VOL2_HUMAN_FACTORS.pdf
│   ├── physiology/
│   │   └── NASA_HUMAN_ADAPTATION_TO_SPACEFLIGHT.pdf
│   └── evidence/
│       ├── NASA_EVIDENCE_CARDIAC_RHYTHM.pdf
│       ├── NASA_EVIDENCE_CARDIOVASCULAR_RADIATION.pdf
│       └── NASA_EVIDENCE_ORTHOSTATIC_INTOLERANCE.pdf
└── esa/
    ├── physiology/
    │   ├── ESA_HUMAN_SPACE_PHYSIOLOGY/
    │   └── ESA_IBRIS_STANDARD_MEASURES.pdf
    ├── cardiovascular/
    │   └── ESA_THROMBOSHIFT_STANDARD_MEASURES.pdf
    └── bedrest/
        └── ESA_BEDREST_STANDARD_MEASURES.pdf
```

## Commands

```bash
python ingest_documents.py
python populate_user_data.py
python test_rag.py
```

## Notes

- This is decision-support for a qualified clinician, not a diagnostic system.
- Corpus and LLM prompts are in English.
- Embeddings are stored as float32 BLOBs in SQLite; similarity is cosine search in Python.
