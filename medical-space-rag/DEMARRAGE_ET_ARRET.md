# Démarrage et arrêt — Medical Space RAG (Phase 1)

Guide pratique pour lancer le système dans PowerShell (Windows), et pour
l'arrêter proprement quand l'appel au LLM (Ollama) prend trop de temps.

---

## 1. Démarrage

### 1.1 Vérifier qu'Ollama tourne et que le modèle est présent

```powershell
ollama list
```

`qwen3:8b` doit apparaître. Sinon :

```powershell
ollama pull qwen3:8b
```

Si `ollama list` répond une erreur de connexion, lancer le serveur dans un
**terminal séparé** (et le laisser ouvert) :

```powershell
ollama serve
```

### 1.2 Se placer dans le projet et activer l'environnement Python

```powershell
cd C:\Users\pivet\Documents\SOLA\medical-space-rag
.\.venv\Scripts\Activate.ps1
$env:PYTHONIOENCODING = "utf-8"
```

> Si PowerShell refuse d'activer le venv (« l'exécution de scripts est
> désactivée »), lancer une fois :
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### 1.3 Préparer les données (une seule fois, déjà fait)

```powershell
python ingest_documents.py      # PDF NASA/ESA -> chunks + embeddings dans medical_app.db
python populate_user_data.py    # données physiologiques de test (7 jours)
```

À refaire uniquement si tu ajoutes/modifies des PDF dans `documents/`.

### 1.4 Lancer les tests

**Rapide, sans IA** (quelques secondes) — vérifie la recherche des passages :

```powershell
python test_rag.py --retrieval-only
```

**Complet, avec IA** (5 questions envoyées à Ollama, peut être long) :

```powershell
python test_rag.py
```

**Une seule question avec IA** (démo) :

```powershell
python rag_system.py
```

---

## 2. Combien de temps attendre ?

Sur ce PC (RTX 4050 Laptop, 6 Go de VRAM), `qwen3:8b` ne tient pas entièrement
dans la carte graphique : environ 30 % tourne sur le CPU. Mesuré : environ
**3 min 20 s par appel**. `test_rag.py` en fait 5, donc compter **15 à 20 minutes**
pour le test complet. Pendant ce temps, le terminal n'affiche rien : c'est normal.

Pour voir où tourne le modèle pendant un appel, dans un **autre terminal** :

```powershell
ollama ps
```

La colonne `PROCESSOR` indique la répartition, par exemple `30%/70% CPU/GPU`.
`100% GPU` = rapide ; toute part de CPU = beaucoup plus lent.

Règle pratique : **si rien ne s'affiche après ~6 minutes pour une seule
question, arrêter** (section 3) et appliquer une des solutions de la section 4.

---

## 3. Arrêter le processus

### 3.1 Méthode normale : Ctrl + C

Dans le terminal où tourne le script, appuyer sur **Ctrl + C**
(une ou deux fois). Le script Python s'arrête avec un `KeyboardInterrupt`.

### 3.2 Si Ctrl + C ne répond pas : tuer le processus Python

Depuis un **autre terminal** PowerShell :

```powershell
# Voir les processus Python du projet
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like '*medical-space-rag*' -or $_.CommandLine -like '*test_rag*' -or $_.CommandLine -like '*rag_system*' } |
  Select-Object ProcessId, CommandLine

# Les arrêter
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like '*test_rag*' -or $_.CommandLine -like '*rag_system*' -or $_.CommandLine -like '*_check_phase1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Ou, plus radical (arrête **tous** les Python de la machine) :

```powershell
Stop-Process -Name python -Force
```

### 3.3 Libérer le modèle dans Ollama

Même après l'arrêt du script, Ollama peut finir de générer la réponse et
garde le modèle en mémoire ~5 minutes. Pour le décharger tout de suite :

```powershell
ollama stop qwen3:8b
ollama ps          # doit afficher une liste vide
```

### 3.4 Arrêter complètement Ollama (optionnel)

```powershell
Stop-Process -Name ollama -Force
```

(ou clic droit sur l'icône Ollama dans la barre des tâches → *Quit Ollama*).

---

## 4. Rendre l'appel à l'IA plus rapide

Par ordre de simplicité :

1. **Utiliser un modèle plus petit qui tient à 100 % dans le GPU.**
   ```powershell
   ollama pull qwen3:4b
   ```
   Puis dans `config.env` : `OLLAMA_MODEL=qwen3:4b`.
   Vérifier avec `ollama ps` pendant un appel : il faut `100% GPU`.

2. **Envoyer moins de texte au modèle.** Dans `config.env` :
   ```text
   RAG_TOP_K=3
   ```
   Avec 5 extraits de ~800 mots, le prompt dépasse la fenêtre de contexte par
   défaut d'Ollama (4096 tokens, visible dans `ollama ps`) : le prompt est
   alors tronqué, ce qui ralentit **et** peut faire perdre une partie des
   instructions. Réduire `RAG_TOP_K` ou `CHUNK_SIZE_WORDS` (puis relancer
   `ingest_documents.py`) limite ce problème.

3. **Désactiver le mode « réflexion » de Qwen3.** `qwen3` génère d'abord un
   long raisonnement caché avant de répondre. Ajouter `/no_think` à la fin de
   la question ou du prompt système réduit fortement la durée.

4. **Fermer les applications qui utilisent le GPU** (navigateur avec
   accélération matérielle, jeux, etc.) pour laisser plus de VRAM à Ollama.

---

## 5. Aide-mémoire

| Action | Commande |
|---|---|
| Activer le venv | `.\.venv\Scripts\Activate.ps1` |
| Test rapide sans IA | `python test_rag.py --retrieval-only` |
| Test complet avec IA | `python test_rag.py` |
| Voir CPU/GPU du modèle | `ollama ps` |
| Interrompre le script | `Ctrl + C` |
| Forcer l'arrêt de Python | `Stop-Process -Name python -Force` |
| Décharger le modèle | `ollama stop qwen3:8b` |
