# Official corpus (manual placement only)

Place authentic NASA/ESA PDFs here. Do not invent document content.

Expected filenames (see PHASE_1_RAG_MEDICAL.md §10–12):

## NASA

- `nasa/standards/NASA_STD_3001_VOL1_CREW_HEALTH.pdf`
- `nasa/standards/NASA_STD_3001_VOL2_HUMAN_FACTORS.pdf`
- `nasa/physiology/NASA_HUMAN_ADAPTATION_TO_SPACEFLIGHT.pdf`
- `nasa/evidence/NASA_EVIDENCE_CARDIAC_RHYTHM.pdf`
- `nasa/evidence/NASA_EVIDENCE_CARDIOVASCULAR_RADIATION.pdf`
- `nasa/evidence/NASA_EVIDENCE_ORTHOSTATIC_INTOLERANCE.pdf`

## ESA

- `esa/physiology/ESA_HUMAN_SPACE_PHYSIOLOGY/` (official PDFs)
- `esa/physiology/ESA_IBRIS_STANDARD_MEASURES.pdf`
- `esa/cardiovascular/ESA_THROMBOSHIFT_STANDARD_MEASURES.pdf`
- `esa/bedrest/ESA_BEDREST_STANDARD_MEASURES.pdf`

Then run:

```bash
python ingest_documents.py
```
