# Sola

**Compagnon de santé embarqué du vaisseau générationnel *Méridien* — 1 240 résidents, 4 128 jours de vol, aucun retour possible.**

Workshop EPSI — *Horizon 2080*, catégorie **Santé humaine**
Aylie · Lyam · Alexandre LS

---

## Le problème

Sur un vaisseau générationnel, la santé mentale se dégrade avant la santé physique, et elle se dégrade en silence. Personne ne consulte pour de la fatigue. L'équipe médicale de bord ne peut pas surveiller 1 240 personnes, et aucune évacuation n'est possible : tout doit être détecté à bord, tôt.

**Sola** est présente dans chaque cabine. Elle parle au résident tous les jours, mesure ses constantes par un bracelet, et ne remonte au médecin que ce qui franchit un seuil clinique — en prévenant le résident à chaque fois.

## Le parti pris : deux applications, aucune base commune

Un compagnon à qui on confie ses angoisses n'a de valeur que si l'on est certain qu'il ne rapporte pas tout. Nous ne l'avons pas promis dans une charte : nous l'avons rendu **structurellement impossible**.

```
   bracelet ESP32                borne de cabine                console médicale
   ──────────────                ───────────────                ────────────────
   FC · RR · RMSSD    ──BLE──▶   LLM embarqué      ──résumés──▶  agrégats équipage
   SpO₂ · activité               conversation                   fiche résident
   sommeil · chutes              tout reste ici                 file de triage

                                 ▲                              ▲
                                 │  aucune base de données partagée
                                 └──────────────────────────────┘
```

Les transcriptions n'arrivent jamais à la console médicale parce qu'elles **n'existent nulle part ailleurs que dans la cabine**. Le modèle de langage tourne en local sur la borne, résume, et n'envoie que le résumé. La garantie est architecturale, pas déclarative.

## Contenu du dépôt

| Dossier | Rôle |
|---|---|
| `web/borne` | **Écran 01** — la borne de cabine, vocale. Client Web Bluetooth du bracelet |
| `web/console` | **Écrans 02 à 04** — santé de l'équipage, fiche résident, registre triable, pour le médecin de bord |
| `web/backoffice` | Outil d'exploitation : état des tables, correction des dossiers, suivi des signaux, table des correspondances écran ↔ requête |
| `firmware/bracelet-i2c` | Firmware ESP32 **principal** : MAX30102 (FC, RR, RMSSD, SpO₂) + MPU6050 (activité, chutes, sommeil) |
| `firmware/bracelet` | Firmware ESP32 de **repli** : PPG analogique KY-039, FC + RR + RMSSD seuls |
| `server` | Service d'ingestion + API de lecture du serveur de bord |
| `db` | Les deux schémas, tous deux SQLite : `db/serveur` et `db/borne` — [pourquoi deux bases](db/README.md) |
| `scripts` | Chargement du schéma, génération du jeu de test, agrégation quotidienne |

**Stack** — React 18 · TypeScript 5 · Vite 5 (espaces de travail npm) · Express + SQLite (`node:sqlite`, Node 24) · ESP32 Arduino + NimBLE · Web Bluetooth.

SQLite plutôt que MySQL : un vaisseau générationnel n'a pas d'administrateur de base de données de garde. Un fichier unique, sans serveur à maintenir ni mot de passe à faire tourner, est le choix qui survit à quatre-vingts ans de vol — et `node:sqlite` évite jusqu'à la dépendance externe.

Aucune ressource n'est chargée depuis un CDN : les polices sont empaquetées avec l'application. Le vaisseau n'a pas Internet ; le prototype non plus.

## Démarrer

```bash
npm install
```

```bash
npm run dev:borne
```

```bash
npm run dev:console
```

La borne écoute sur <http://localhost:5173>, la console sur <http://localhost:5174>.
`npm run build` et `npm run typecheck` traversent tous les espaces de travail.

La console lit le serveur de bord quand il répond, et retombe sur son jeu de
démonstration sinon — en le disant dans son en-tête. Pour la brancher sur la
base (**Node 24 ou plus**, pour `node:sqlite`), copiez le modèle de
configuration et renseignez les deux jetons :

```bash
cp server/.env.example server/.env
```

```bash
npm run db:reset
```

```bash
npm run dev:server
```

```bash
npm run dev:backoffice
```

Le backoffice écoute sur <http://localhost:5176>, l'API sur <http://localhost:5175>.

Une commande par bloc : l'équipe est sous Windows PowerShell, qui ne connaît
pas l'enchaînement `&&`.

### Les jetons

`server/.env` en porte deux, et ils ne doivent jamais être le même :

| Variable | Qui s'en sert | Ce qu'il permet |
|---|---|---|
| `BORNE_TOKEN` | les bornes de cabine | écrire des mesures, des nuits, des résumés |
| `ADMIN_TOKEN` | le backoffice | lire et corriger les dossiers |

Une borne écrit des constantes ; elle n'a aucune raison de pouvoir modifier un
dossier médical. Le serveur refuse de démarrer si les deux jetons sont
identiques ou font moins de 32 caractères. Pour en fabriquer un :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Le jeu de test

`npm run db:load` charge le schéma, les vues et **13 résidents scriptés** — ceux
des maquettes, dont R-0448 dont la fiche raconte toute l'histoire du projet.
`npm run db:demo` complète jusqu'à **1 240 résidents** et environ 79 000 lignes :
constantes quotidiennes, nuits, scores de dépistage, conversations, signaux
ouverts et clos. `npm run db:reset` enchaîne les deux.

Le générateur est **déterministe** (graine 4 128) : deux exécutions donnent la
même base, donc la même soutenance. Et il est **calibré** — il tire une
population plausible, puis corrige le nombre de résidents au-dessus de chaque
seuil pour retomber exactement sur les chiffres des maquettes. Les 8,4 % de
PHQ-9 ≥ 10 affichés par l'écran 02 sont donc calculés sur 1 240 lignes, pas
écrits en dur quelque part.

Pour regarder dedans sans rien installer :

```bash
npm run db:sql
```

liste les tables et leurs volumes ; `npm run db:sql "SELECT …"` exécute une
requête, en lecture seule. Les autres chemins d'accès sont décrits dans
[db/README.md](db/README.md).

```bash
npm run db:rollup 2026-09-20
```

agrège les mesures à la minute d'une journée en une ligne par résident, comme
le ferait la tâche de nuit du serveur de bord.

### Les trois scénarios de la borne

Le sélecteur en haut à droite rejoue les trois états de l'écran 01 :

- **Échange** — trois prises de parole au bouton micro : la nuit courte, l'action de maintenance, puis le lien social et l'escalade vers le médecin, annoncée au résident ;
- **Apaisement** — respiration guidée 4-7-8, déclenchée dans la vraie vie par une hausse de stress ;
- **Alerte** — les secours sont en route, Sola reste présente.

## Le bracelet

### Matériel

| Composant | Rôle | Adresse |
|---|---|---|
| ESP32 DevKit v1 | calcul + BLE | — |
| MAX30102 | PPG rouge/infrarouge : FC, RR, SpO₂ | I²C `0x57` |
| MPU6050 | accéléromètre : activité, chutes, sommeil | I²C `0x68` |

Les deux capteurs partagent `3V3 / GND / GPIO21 (SDA) / GPIO22 (SCL)`. **3,3 V uniquement.** Un ESP32-S2 ne convient pas : il n'a pas de radio Bluetooth.

```bash
pio run -t upload -d firmware/bracelet-i2c
```

### Liaison

Le bracelet expose les profils **standard du Bluetooth SIG** — `0x180D` *Heart Rate* (FC, intervalles RR, contact peau) et `0x180F` *Battery*. N'importe quelle application cardio du commerce peut donc le lire, ce qui permet de vérifier la mesure sans passer par la borne.

Un service propre à Sola transporte ce que le standard ne prévoit pas : RMSSD, SpO₂, sommeil, activité, qualité du signal.

### Appairer depuis la borne

Le bouton **Appairer le bracelet**, en bas de l'écran, ouvre le sélecteur Web Bluetooth. Deux contraintes : **Chrome ou Edge** en contexte sécurisé (`localhost` suffit), et un **clic** de l'utilisateur — c'est pourquoi l'appairage n'est pas automatique. Une fois connectée, la barre d'état affiche la FC, le RMSSD et la batterie réels à la place des valeurs de démonstration.

## Mesure du sommeil

Méthode volontairement simple : **immobile + cœur descendu sous sa base de repos**.

Le firmware découpe le temps en époques d'une minute et calcule, pour chacune, une activité (variation moyenne de la norme de l'accélération) et une fréquence cardiaque. L'époque compte comme du sommeil si l'activité est sous le seuil **et** si la FC est au moins 4 bpm sous la base de repos éveillé. Quinze époques calmes consécutives déclarent l'endormissement, cinq époques agitées le réveil.

La base de repos est **gelée pendant le sommeil** : sinon elle suivrait le cœur qui ralentit, l'écart ne serait plus jamais franchi, et la détection s'éteindrait d'elle-même au bout d'une heure.

Trois réglages, en tête de `firmware/bracelet-i2c/src/main.cpp` :

| Constante | Défaut | À quoi ça sert |
|---|---|---|
| `EPOCH_MS` | `60000` | Mettre `5000` pour une démonstration : une « nuit » se joue en quelques minutes, tous les seuils suivent |
| `MOVE_TH` | `0.012` | Seuil d'immobilité en g. Calibrer en lisant `act=` sur le port série, bras posé immobile |
| `HR_DROP` | `4.0` | Écart en bpm sous la base de repos |

Le port série sort une ligne par époque — c'est ce journal qu'on compare à l'heure de coucher notée à la main pour chiffrer l'erreur de la méthode.

## Mesuré ou simulé

La fiche résident étiquette chaque constante. Rien n'est présenté comme mesuré s'il ne l'est pas.

| Constante | KY-039 (repli) | MAX30102 + MPU6050 |
|---|---|---|
| Fréquence cardiaque, RMSSD | mesuré | mesuré |
| Oxygénation (SpO₂) | simulé | mesuré, **non calibré** |
| Activité, secousses, chutes | simulé | mesuré |
| Durée de sommeil | simulé | **estimé** (voir ci-dessus) |
| Respiration, température, activité électrodermale, pas | simulé | simulé — le matériel ne les mesure pas |

Les étiquettes de la console reflètent aujourd'hui le firmware de repli ; elles seront mises à jour quand le bracelet I²C aura été validé en conditions réelles.

## Limites connues

- **L'estimation du sommeil surestime.** Rester allongé éveillé, immobile et détendu est classé comme du sommeil : compter une erreur de l'ordre de la demi-heure sur une nuit. Les stades (léger / profond / paradoxal) ne sont pas calculés — sans EEG, ce serait de l'invention.
- **La SpO₂ n'est pas calibrée.** Le rapport des rapports est appliqué avec les coefficients génériques de la littérature, sans oxymètre de référence. La valeur montre une tendance, elle ne pose pas un diagnostic.
- **Le PPG au poignet est difficile.** Le MAX30102 mesure par réflexion : le signal y est 5 à 10 fois plus faible qu'au doigt, et le moindre mouvement fait perdre le contact. C'est la contrainte matérielle la plus lourde du prototype.
- **Le LLM embarqué n'est pas implémenté.** La borne rejoue des scénarios scriptés : l'architecture réserve sa place et garantit son isolement, mais le modèle reste à intégrer.
- **La borne n'est pas branchée sur la base.** Les écrans 02 à 04 lisent le serveur de bord ; l'écran 01 rejoue encore ses scénarios scriptés, ce qui est cohérent avec le fait que son LLM n'est pas implémenté.
- **Il n'y a pas encore de comptes.** Le backoffice s'ouvre avec un jeton unique qui vit dans le `sessionStorage` du navigateur, et la console écrit une note sans rien demander du tout. Dans les deux cas, personne ne sait qui a touché le dossier. Une table `medecins` et une session par soignant sont en cours de conception : c'est la **première** chose à finir, parce qu'un vaisseau où l'on ne sait pas qui a modifié un dossier médical n'est pas un vaisseau où l'on peut se soigner.
- **Les données sont synthétiques.** Elles sont calibrées pour être vraisemblables et cohérentes entre elles, pas pour être vraies. Aucun chiffre de ce dépôt ne dit quoi que ce soit d'une population réelle.

## Le serveur de bord

`server/` fait deux choses : recevoir ce que les bornes envoient, et servir ce que la console lit.

| Route | Qui appelle | Rôle |
|---|---|---|
| `POST /ingest/mesure` | la borne | lot de constantes, jusqu'à 1 440 minutes d'un coup après une coupure |
| `POST /ingest/nuit` | la borne | durée de sommeil estimée de la nuit |
| `POST /ingest/conversation` | la borne | **résumé** clinique — voir ci-dessous |
| `POST /ingest/evenement` | la borne | chute, secousse, bouton d'urgence |
| `GET /api/crew` | la console | écran 02 : indicateurs, courbes, file de triage |
| `GET /api/residents/:code` | la console | écran 03 : la fiche complète |
| `GET /api/equipage` | la console | écran 04 : les 1 240 résidents, triés et filtrés par le serveur |
| `GET /api/signaux` | la console | écran 04 : les signaux, de l'ouverture à la clôture |
| `POST /api/residents/:code/particularites` | la console | écran 03 : une note de particularité écrite par le médecin |
| `GET /admin/…` | le backoffice | lecture des tables, correction des dossiers, suivi des signaux |

L'ingestion et le backoffice demandent un jeton porteur, comparé à temps constant. L'écriture d'une note par la console, elle, est **ouverte pour l'instant** : elle attend la session médecin, parce qu'un jeton partagé ne dit pas qui a écrit la note — voir les limites. Toutes les requêtes sont préparées avec des paramètres nommés — **aucune concaténation SQL nulle part**, y compris pour le tri : le nom de colonne envoyé par l'écran 04 passe par une table de correspondance, et une clé inconnue retombe sur le tri par défaut au lieu d'atteindre le SQL.

Les filtres sont neutralisés *dans* la requête plutôt qu'en la recomposant :

```sql
WHERE (:q = '' OR r.nom LIKE '%' || :q || '%')
  AND (:module = '' OR SUBSTR(r.cabine, 1, 1) = :module)
```

Une seule requête préparée sert tous les cas de figure, et il n'existe aucun chemin où un paramètre devient du code.

**Le serveur refuse les transcriptions.** `POST /ingest/conversation` inspecte toute la charge utile, à n'importe quelle profondeur, et rejette en `422` tout champ de verbatim :

```
$ curl -X POST .../ingest/conversation -d '{"...","transcript":[…]}'
{"erreur":"Transcription refusee.","champ":"transcript",
 "detail":"Le serveur de bord n'accepte que des resumes. …"}
```

C'est la promesse du projet rendue exécutable : l'architecture ne se contente pas de ne pas transmettre le verbatim, elle est incapable de l'accepter.

## Le backoffice

`web/backoffice` est l'outil d'exploitation, séparé de la console médicale
parce qu'il ne répond pas à la même question. La console demande « comment va
cette personne ? » ; le backoffice demande « est-ce que ce que l'écran affiche
est bien ce que la base contient ? ».

| Onglet | Ce qu'il montre |
|---|---|
| **Aperçu** | nombre de lignes par table, fraîcheur des données, indicateurs du jour |
| **Équipage** | recherche, filtres, accès au dossier de n'importe quel résident |
| **Signaux** | assignation et clôture — une clôture exige un motif |
| **Écrans et sources** | chaque bloc de chaque écran, la requête qui l'alimente, et sa valeur actuelle |
| **Tables** | les lignes brutes, pour vérifier sans passer par `sqlite3` |

L'onglet **Écrans et sources** est le plus utile en soutenance : il met côte à
côte le bloc affiché, la vue SQL qui le remplit et la valeur qu'elle renvoie à
l'instant. La correspondance entre l'interface et la base devient vérifiable
d'un coup d'œil, au lieu d'être promise dans un document.

Une clôture de signal **exige un motif** parce que ce motif est la seule chose
qui permettra plus tard de mesurer les faux positifs du moteur de règles. Sans
lui, on sait qu'un signal a été fermé, jamais s'il aurait dû être ouvert.

## Licence

Projet pédagogique, fourni tel quel. **Aucun usage médical.**
