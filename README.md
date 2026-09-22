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
| `web/console` | **Écrans 02 et 03** — santé de l'équipage et fiche résident, pour le médecin de bord |
| `firmware/bracelet-i2c` | Firmware ESP32 **principal** : MAX30102 (FC, RR, RMSSD, SpO₂) + MPU6050 (activité, chutes, sommeil) |
| `firmware/bracelet` | Firmware ESP32 de **repli** : PPG analogique KY-039, FC + RR + RMSSD seuls |
| `server` | Service d'ingestion + API de lecture du serveur de bord |
| `db` | Les deux schémas : MySQL côté serveur, SQLite côté cabine — [pourquoi deux](db/README.md) |

**Stack** — React 18 · TypeScript 5 · Vite 5 (espaces de travail npm) · Express + MySQL 8 · ESP32 Arduino + NimBLE · Web Bluetooth.

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

Le serveur de bord est optionnel pour la démonstration : les deux interfaces
tournent sur leurs jeux de données locaux. Pour le lancer (MySQL 8 et Node 20.6
ou plus requis), copiez le modèle de configuration et renseignez vos
identifiants MySQL :

```bash
cp server/.env.example server/.env
```

```bash
npm run db:load
```

```bash
npm run dev:server
```

Une commande par bloc : l'équipe est sous Windows PowerShell, qui ne connaît
pas l'enchaînement `&&`.

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
- **Les interfaces ne lisent pas encore la base.** Le schéma, le service d'ingestion et les requêtes de lecture existent et sont testés ; les trois écrans affichent toujours leurs jeux de données locaux. Le branchement est le prochain chantier, fichier par fichier.
- **Le serveur de bord n'a pas été exécuté contre un vrai MySQL.** Les routes, la validation et le refus de transcription sont vérifiés ; les requêtes SQL elles-mêmes attendent leur première exécution.

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

L'écriture demande un jeton porteur, comparé à temps constant. Toutes les requêtes sont préparées avec des paramètres nommés — aucune concaténation SQL nulle part.

**Le serveur refuse les transcriptions.** `POST /ingest/conversation` inspecte toute la charge utile, à n'importe quelle profondeur, et rejette en `422` tout champ de verbatim :

```
$ curl -X POST .../ingest/conversation -d '{"...","transcript":[…]}'
{"erreur":"Transcription refusee.","champ":"transcript",
 "detail":"Le serveur de bord n'accepte que des resumes. …"}
```

C'est la promesse du projet rendue exécutable : l'architecture ne se contente pas de ne pas transmettre le verbatim, elle est incapable de l'accepter.

## Licence

Projet pédagogique, fourni tel quel. **Aucun usage médical.**
