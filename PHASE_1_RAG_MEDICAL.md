# Phase 1 — Medical Space RAG
## SQLite + embeddings locaux + NASA/ESA + LLM local

## 1. Objectif du projet

Construire une première version fonctionnelle d'un système de RAG médical orienté **médecine spatiale**.

Le système doit permettre de :

1. stocker des données physiologiques structurées ;
2. ingérer des documents médicaux officiels NASA et ESA ;
3. transformer les documents en chunks ;
4. générer des embeddings ;
5. stocker les embeddings dans SQLite (BLOB) ;
6. rechercher les passages médicaux pertinents pour une question (similarité cosinus en Python) ;
7. envoyer au LLM uniquement les informations pertinentes ;
8. produire une analyse médicale structurée ;
9. citer les documents utilisés ;
10. signaler les incertitudes et les données manquantes.

Le système est une **aide à l'analyse destinée à un professionnel de santé**.

Il ne doit jamais présenter une conclusion comme un diagnostic médical certain.

---

# 2. Architecture cible

```text
                    ┌─────────────────────┐
                    │ Arduino / Sensors   │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Backend             │
                    │ FastAPI             │
                    └──────────┬──────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
       ┌─────────────────┐          ┌─────────────────────┐
       │ users_data      │          │ medical_documents   │
       │ SQLite          │          │ SQLite               │
       └─────────────────┘          │ + embeddings BLOB   │
                                    └──────────┬──────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │ Semantic Search     │
                                    │ cosine (Python)     │
                                    └──────────┬──────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │ Relevant chunks     │
                                    │ NASA + ESA          │
                                    └──────────┬──────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │ Local Medical LLM   │
                                    │ Ollama              │
                                    └──────────┬──────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │ Structured Analysis │
                                    │ + Sources           │
                                    └──────────┬──────────┘
                                               │
                                               ▼
                                            Doctor
```

---

# 3. Contraintes principales

## Langue

Le corpus documentaire doit être conservé en **anglais**.

Le modèle LLM utilisé dans Ollama est également un modèle anglais/médical.

Ne pas créer de corpus français pour cette phase.

Le modèle doit être configurable avec :

```env
OLLAMA_MODEL=nom_du_modele
```

Ne jamais hardcoder le nom du modèle dans plusieurs fichiers.

---

# 4. Stack technique

Utiliser :

- Python 3.11+
- SQLite (module stdlib `sqlite3`)
- Ollama
- Sentence Transformers
- numpy (similarité cosinus)
- SQLAlchemy (optionnel)
- python-dotenv
- PyMuPDF (`fitz`) pour les PDF
- éventuellement `python-docx` pour DOCX
- pandas pour CSV
- FastAPI seulement si nécessaire dans cette phase

Dépendances minimales :

```bash
pip install python-dotenv ollama sentence-transformers pymupdf sqlalchemy pandas numpy
```

---

# 5. SQLite

Créer le fichier de base :

```text
medical_app.db
```

Une seule base fichier locale. Pas de serveur, pas d'utilisateur, pas de port.

Se connecter via :

```python
import sqlite3

conn = sqlite3.connect(DB_PATH)
```

`DB_PATH` doit être lu depuis la configuration (voir §24).

---

# 6. Tables SQLite

## 6.1 Données physiologiques

Créer :

```sql
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
```

Pour cette phase, conserver ces champs car ils serviront à tester le système :

- poids
- fréquence cardiaque au repos
- sommeil
- température
- activité

---

# 7. Nouvelle architecture documentaire

Ne plus stocker un PDF entier comme un seul embedding.

Un document doit être traité comme ceci :

```text
PDF
 ↓
Extraction texte
 ↓
Nettoyage
 ↓
Découpage en chunks
 ↓
Embedding de chaque chunk
 ↓
SQLite (BLOB)
```

Exemple :

```text
NASA_STD_3001_VOL1.pdf
        ↓
texte
        ↓
chunks de 500-1000 mots
        ↓
embeddings
        ↓
SQLite
```

---

# 8. Table medical_documents

Créer une table permettant de conserver les chunks et leur provenance.

```sql
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
```

Les embeddings sont sérialisés en BLOB (par ex. `array('f').tobytes()` ou `numpy.ndarray.tobytes()`), dimension 384 pour le modèle d'embedding de cette phase.

Pas d'index vectoriel SQL : la recherche sémantique se fait en Python (similarité cosinus) sur les embeddings chargés depuis SQLite.
---

# 9. Métadonnées obligatoires

Chaque chunk doit conserver au minimum :

```text
document_id
titre
chunk_index
contenu
source
organisation
category
page_number
```

Exemple :

```text
document_id:
NASA_STD_3001_VOL1

titre:
NASA-STD-3001 Volume 1 — Crew Health

chunk_index:
184

organisation:
NASA

category:
medical_operations

page_number:
142
```

Cela permettra au système de citer précisément la source.

---

# 10. Corpus documentaire officiel

Utiliser uniquement des documents provenant de sources institutionnelles NASA et ESA ou de leurs archives officielles.

## NASA — documents prioritaires

### 1. NASA-STD-3001 Volume 1 — Crew Health

Format :

```text
PDF
```

Nom local :

```text
NASA_STD_3001_VOL1_CREW_HEALTH.pdf
```

Catégorie :

```text
standards
```

Priorité :

```text
HIGH
```

---

### 2. NASA-STD-3001 Volume 2 — Human Factors, Habitability, and Environmental Health

Format :

```text
PDF
```

Nom local :

```text
NASA_STD_3001_VOL2_HUMAN_FACTORS.pdf
```

Catégorie :

```text
human_factors
```

Priorité :

```text
HIGH
```

---

### 3. Human Adaptation to Spaceflight

Format :

```text
PDF
```

Nom local :

```text
NASA_HUMAN_ADAPTATION_TO_SPACEFLIGHT.pdf
```

Catégorie :

```text
physiology
```

Priorité :

```text
VERY_HIGH
```

---

### 4. Risk of Cardiac Rhythm Problems During Spaceflight

Format :

```text
PDF
```

Nom local :

```text
NASA_EVIDENCE_CARDIAC_RHYTHM.pdf
```

Catégorie :

```text
cardiovascular
```

Priorité :

```text
VERY_HIGH
```

---

### 5. Risk of Cardiovascular Disease and Other Degenerative Tissue Effects from Radiation Exposure

Format :

```text
PDF
```

Nom local :

```text
NASA_EVIDENCE_CARDIOVASCULAR_RADIATION.pdf
```

Catégorie :

```text
radiation
```

Priorité :

```text
HIGH
```

---

### 6. NASA Evidence Report — Orthostatic Intolerance

Format :

```text
PDF
```

Nom local :

```text
NASA_EVIDENCE_ORTHOSTATIC_INTOLERANCE.pdf
```

Catégorie :

```text
cardiovascular
```

Priorité :

```text
VERY_HIGH
```

---

# 11. ESA — documents prioritaires

## 1. ESA Human Space Physiology

Utiliser les supports PDF officiellement disponibles lorsqu'ils sont téléchargeables.

Dossier :

```text
ESA_HUMAN_SPACE_PHYSIOLOGY/
```

Catégorie :

```text
physiology
```

Priorité :

```text
VERY_HIGH
```

---

## 2. ESA ThromBoShift Standard Study Measures

Format :

```text
PDF
```

Nom :

```text
ESA_THROMBOSHIFT_STANDARD_MEASURES.pdf
```

Catégorie :

```text
cardiovascular
```

Priorité :

```text
VERY_HIGH
```

---

## 3. ESA IBRIS Standard Study Measures

Format :

```text
PDF
```

Nom :

```text
ESA_IBRIS_STANDARD_MEASURES.pdf
```

Catégorie :

```text
physiology
```

Priorité :

```text
VERY_HIGH
```

---

## 4. ESA Bedrest Standard Study Measures

Format :

```text
PDF
```

Nom :

```text
ESA_BEDREST_STANDARD_MEASURES.pdf
```

Catégorie :

```text
bedrest
```

Priorité :

```text
VERY_HIGH
```

---

# 12. Structure des documents

Créer :

```text
documents/
├── nasa/
│   ├── standards/
│   │   ├── NASA_STD_3001_VOL1_CREW_HEALTH.pdf
│   │   └── NASA_STD_3001_VOL2_HUMAN_FACTORS.pdf
│   │
│   ├── physiology/
│   │   └── NASA_HUMAN_ADAPTATION_TO_SPACEFLIGHT.pdf
│   │
│   └── evidence/
│       ├── NASA_EVIDENCE_CARDIAC_RHYTHM.pdf
│       ├── NASA_EVIDENCE_CARDIOVASCULAR_RADIATION.pdf
│       └── NASA_EVIDENCE_ORTHOSTATIC_INTOLERANCE.pdf
│
└── esa/
    ├── physiology/
    │   ├── ESA_HUMAN_SPACE_PHYSIOLOGY/
    │   └── ESA_IBRIS_STANDARD_MEASURES.pdf
    │
    ├── cardiovascular/
    │   └── ESA_THROMBOSHIFT_STANDARD_MEASURES.pdf
    │
    └── bedrest/
        └── ESA_BEDREST_STANDARD_MEASURES.pdf
```

Ne pas télécharger automatiquement des documents inconnus.

L'utilisateur ajoutera les fichiers officiellement obtenus dans ces dossiers.

---

# 13. Ingestion des PDF

Créer :

```text
ingest_documents.py
```

Le script doit :

1. parcourir récursivement `documents/`;
2. détecter les PDF ;
3. extraire le texte avec PyMuPDF ;
4. conserver le numéro de page ;
5. nettoyer le texte ;
6. découper le texte en chunks ;
7. créer les embeddings ;
8. insérer les chunks dans SQLite.

---

# 14. Chunking

Ne pas faire un chunk arbitraire uniquement caractère par caractère.

Créer une fonction :

```python
chunk_text()
```

Paramètres configurables :

```text
chunk_size = 800 mots environ
overlap = 100-150 mots
```

Conserver le numéro de page.

Un chunk ne doit jamais perdre son association avec :

```text
document
page
titre
organisation
category
```

---

# 15. Embeddings

Utiliser dans un premier temps :

```text
sentence-transformers/all-MiniLM-L6-v2
```

Ce modèle produit :

```text
384 dimensions
```

Donc stocker chaque embedding comme :

```text
BLOB de 384 floats (float32)
```

Exemple de sérialisation :

```python
import array

blob = array.array("f", embedding_vector).tobytes()
```

Le modèle d'embedding doit être configurable dans le code.

```env
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
```

---

# 16. Recherche vectorielle

Créer une méthode :

```python
search_relevant_documents(question, k=5)
```

Elle doit :

1. transformer la question en embedding ;
2. charger les embeddings depuis SQLite ;
3. calculer la similarité cosinus en Python (numpy) ;
4. rechercher les chunks les plus proches ;
5. retourner :
   - titre
   - contenu
   - source
   - organisation
   - category
   - page
   - similarity

Chargement SQL de base :

```sql
SELECT
    id,
    titre,
    contenu,
    source,
    organisation,
    category,
    page_number,
    embedding
FROM medical_documents;
```

Puis en Python :

```python
import numpy as np

def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)
```

Trier par similarité décroissante, appliquer le top-k, puis le seuil `RAG_MIN_SIMILARITY`.

Pour la Phase 1 (corpus NASA/ESA limité), charger tous les embeddings en mémoire est acceptable. Ne pas introduire d'index vectoriel externe.
---

# 17. Seuil de pertinence

Ne pas envoyer automatiquement n'importe quel résultat au LLM.

Créer un seuil configurable :

```env
RAG_MIN_SIMILARITY=0.65
```

Si aucun chunk ne dépasse ce seuil :

```text
No sufficiently relevant medical source was retrieved.
```

Le LLM doit alors indiquer qu'il ne dispose pas d'une source documentaire suffisamment pertinente.

Ne jamais inventer une source.

---

# 18. Prompt du LLM

Créer un prompt système spécialisé.

Le LLM doit recevoir :

```text
SYSTEM ROLE

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
```

---

# 19. Format de réponse attendu

Le LLM doit répondre avec cette structure :

```text
## Clinical Data Summary

...

## Observations

...

## Potentially Relevant Findings

...

## Possible Explanations

...

## Missing Information

...

## Risk / Urgency Considerations

...

## Recommended Medical Review

...

## Sources

1. NASA-STD-3001 Volume 1, p. XXX
2. ESA ThromBoShift Standard Study Measures, p. XX
```

Le terme "diagnosis" ne doit pas être utilisé pour transformer une hypothèse en diagnostic certain.

---

# 20. Données utilisateur

La fonction :

```python
get_user_data_summary(days=7)
```

doit rester disponible.

Mais ne pas seulement calculer des moyennes.

Ajouter également :

```text
minimum
maximum
average
latest value
variation
trend
```

Exemple :

```text
Resting heart rate:
- latest: 82 bpm
- 7-day average: 77 bpm
- minimum: 72 bpm
- maximum: 82 bpm
- change from first to latest: +10 bpm
```

Cela permettra au RAG/LLM d'analyser une évolution plutôt qu'une simple valeur moyenne.

---

# 21. Test RAG

Créer :

```text
test_rag.py
```

Tests minimum :

### Test 1

```text
The astronaut has a resting heart rate of 82 bpm.
Analyze this value using the available medical spaceflight literature.
```

### Test 2

```text
The astronaut's resting heart rate increased from 70 bpm to 84 bpm over seven days.
What information should a physician consider?
```

### Test 3

```text
The astronaut reports dizziness after standing.
Which NASA or ESA information is relevant?
```

### Test 4

```text
The astronaut has reduced sleep duration for several days.
What physiological factors could be relevant?
```

### Test 5 — source limitation

```text
Can the available documents determine whether this astronaut has a specific disease?
```

Le système doit reconnaître lorsqu'il ne peut pas conclure.

---

# 22. Test de traçabilité

Pour chaque réponse, vérifier que le système peut afficher :

```text
Source
Organization
Document
Page
Similarity
Retrieved chunk
```

Exemple :

```text
SOURCE
NASA

DOCUMENT
NASA-STD-3001 Volume 1

PAGE
142

SIMILARITY
0.84
```

Le médecin doit pouvoir savoir **d'où vient l'information**.

---

# 23. Protection contre les hallucinations

Ajouter une règle fondamentale :

```text
The LLM must not cite a document that was not retrieved.
```

Il ne doit jamais inventer :

```text
document title
page number
NASA requirement
ESA recommendation
medical threshold
study result
```

Si l'information n'est pas présente dans les sources récupérées :

```text
The retrieved sources do not provide sufficient information to support this conclusion.
```

---

# 24. Configuration

Créer :

```text
config.env
```

avec :

```env
DB_PATH=medical_app.db

OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=YOUR_MEDICAL_ENGLISH_MODEL

EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2

RAG_TOP_K=5
RAG_MIN_SIMILARITY=0.65
```

Ne jamais commit `config.env`.

Créer :

```text
.gitignore
```

contenant :

```text
config.env
.env
__pycache__/
*.pyc
.venv/
venv/
medical_app.db
*.db
```

---

# 25. Arborescence finale

Le projet doit tendre vers :

```text
medical-space-rag/
│
├── documents/
│   ├── nasa/
│   │   └── ...
│   └── esa/
│       └── ...
│
├── database.py
├── rag_system.py
├── ingest_documents.py
├── populate_user_data.py
├── test_rag.py
│
├── medical_app.db
├── config.env
├── .gitignore
├── requirements.txt
└── README.md
```

---

# 26. requirements.txt

Créer un fichier avec les dépendances réellement utilisées.

Minimum :

```text
python-dotenv
ollama
sentence-transformers
pymupdf
sqlalchemy
pandas
numpy
```

Ne pas ajouter de dépendances inutilisées.
---

# 27. Fonctionnement attendu

Commande pour ingérer les documents :

```bash
python ingest_documents.py
```

Commande pour ajouter les données de test :

```bash
python populate_user_data.py
```

Commande pour tester le RAG :

```bash
python test_rag.py
```

---

# 28. Important : ne pas supprimer l'existant

Avant toute modification :

1. inspecter les fichiers existants ;
2. comprendre l'architecture actuelle ;
3. réutiliser le code existant lorsqu'il est correct ;
4. ne pas supprimer SQLite ;
5. ne pas supprimer le stockage BLOB des embeddings ;
6. ne pas supprimer Ollama ;
7. ne pas modifier inutilement le modèle d'embedding ;
8. ne pas créer une deuxième base de données ;
9. ne pas dupliquer les classes existantes.

Si une modification importante est nécessaire, expliquer pourquoi dans le code ou dans le README.

---

# 29. Critères de réussite de la Phase 1

La Phase 1 est terminée lorsque :

- [ ] SQLite fonctionne ;
- [ ] le fichier `medical_app.db` est créé ;
- [ ] les tables sont créées ;
- [ ] les PDF NASA sont ingérés ;
- [ ] les PDF ESA sont ingérés ;
- [ ] les PDF sont découpés en chunks ;
- [ ] chaque chunk possède sa page ;
- [ ] les embeddings sont stockés en BLOB dans SQLite ;
- [ ] la recherche sémantique (cosine) fonctionne ;
- [ ] le système récupère les bons passages ;
- [ ] le LLM reçoit uniquement les passages pertinents ;
- [ ] le LLM répond en anglais ;
- [ ] les sources sont affichées ;
- [ ] les pages sont affichées lorsqu'elles sont disponibles ;
- [ ] les hallucinations de sources sont évitées ;
- [ ] les données physiologiques SQLite sont intégrées au contexte ;
- [ ] le système sait signaler les données manquantes ;
- [ ] le système sait exprimer son incertitude ;
- [ ] `test_rag.py` fonctionne sans erreur.

---

# 30. Priorité d'implémentation

Ne pas essayer de construire tout le projet en même temps.

Faire exactement dans cet ordre :

```text
STEP 1
SQLite
    ↓
STEP 2
medical_documents (BLOB)
    ↓
STEP 3
PDF extraction
    ↓
STEP 4
chunking
    ↓
STEP 5
embeddings
    ↓
STEP 6
document ingestion
    ↓
STEP 7
semantic search (cosine)
    ↓
STEP 8
Ollama
    ↓
STEP 9
RAG
    ↓
STEP 10
user physiological data
    ↓
STEP 11
source citations
    ↓
STEP 12
tests
```

Ne pas passer à l'étape suivante tant que l'étape précédente n'est pas fonctionnelle.

---

# 31. Consigne finale pour Cursor

Tu dois agir comme un développeur senior chargé de réaliser cette Phase 1.

Commence par inspecter le projet existant.

Ensuite :

1. indique les fichiers qui doivent être créés/modifiés ;
2. implémente les changements ;
3. conserve l'architecture existante lorsqu'elle est correcte ;
4. installe uniquement les dépendances nécessaires ;
5. crée les scripts d'ingestion ;
6. crée le système de chunking ;
7. implémente les embeddings ;
8. implémente la recherche cosine sur embeddings SQLite ;
9. connecte Ollama ;
10. implémente le prompt médical ;
11. ajoute les citations de sources ;
12. crée les tests ;
13. vérifie que tout fonctionne.

Ne crée pas de données médicales fictives présentées comme des sources réelles.

Les seuls documents médicaux utilisés comme sources doivent provenir de documents NASA/ESA réellement présents dans le dossier `documents/`.

Si un document NASA ou ESA manque, ne l'invente pas et ne génère pas son contenu : indique simplement que le fichier doit être ajouté.

À la fin, fournir un résumé :

```text
Files created:
...

Files modified:
...

Dependencies:
...

Database changes:
...

Documents indexed:
...

Tests performed:
...

Remaining issues:
...
```