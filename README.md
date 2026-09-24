# Sola

**Compagnon de santé embarqué du vaisseau générationnel *Projet Odyssée* — 1 240 résidents, 4 128 jours de vol, aucun retour possible.**

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
   SpO₂ · activité               conversation      ─constantes▶ fiche résident
   sommeil · chutes              la parole reste ici            file de triage

                                 ▲                              ▲
                                 │  aucune base de données partagée
                                 └──────────────────────────────┘
```

Les transcriptions n'arrivent jamais à la console médicale parce qu'elles **n'existent nulle part ailleurs que dans la cabine**. Le modèle de langage tourne en local sur la borne, résume, et n'envoie que le résumé. La garantie est architecturale, pas déclarative.

## Contenu du dépôt

| Dossier | Rôle |
|---|---|
| `web/borne` | **Écran 01** — la borne de cabine, vocale. Client Web Bluetooth du bracelet, et relais de ses trames vers le serveur de bord |
| `web/console` | **Écrans 02 à 04** — santé de l'équipage, fiche résident, registre triable, pour le médecin de bord |
| `web/backoffice` | Outil d'exploitation, en lecture : correspondance écran ↔ requête, fraîcheur des flux et tables brutes, comptes |
| `firmware/bracelet-i2c` | Firmware ESP32 **principal** : MAX30102 (FC, RR, RMSSD, SpO₂) + MPU6050 (activité, chutes, sommeil) |
| `firmware/bracelet` | Firmware ESP32 de **repli** : PPG analogique KY-039, FC + RR + RMSSD seuls |
| `server` | Service d'ingestion + API de la console et du backoffice |
| `db` | Les deux schémas, tous deux SQLite : `db/serveur` et `db/borne` — [pourquoi deux bases](db/README.md) |
| `scripts` | Chargement du schéma, génération du jeu de test, agrégation quotidienne |
| `docker` | Démarrage du serveur et service des fichiers statiques sous Docker ; `Dockerfile` et `compose.yaml` sont à la racine — voir [Avec Docker](#avec-docker) |

**Stack** — React 18 · TypeScript 5 · Vite 5 (espaces de travail npm) · Express + SQLite (`node:sqlite`, Node 24) · ESP32 Arduino + NimBLE · Web Bluetooth.

SQLite plutôt que MySQL : un vaisseau générationnel n'a pas d'administrateur de base de données de garde. Un fichier unique, sans serveur à maintenir ni mot de passe à faire tourner, est le choix qui survit à quatre-vingts ans de vol — et `node:sqlite` évite jusqu'à la dépendance externe.

Aucune ressource n'est chargée depuis un CDN : les polices sont empaquetées avec l'application. Le vaisseau n'a pas Internet ; le prototype non plus, à la voix près : dans Chrome, ce que la borne entend et ce qu'elle dit passent par Google (voir [les limites](#limites-connues)).

## Démarrer

**Node 24 ou plus** est requis, pour `node:sqlite`.

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

La conversation de la borne passe par un modèle de langage **local**, servi
par [Ollama](https://ollama.com) sur la même machine. Une fois Ollama installé
et lancé :

```bash
ollama pull qwen3:8b
```

Le serveur de la borne relaie `/ollama` vers `http://127.0.0.1:11434` : aucune
configuration CORS à faire côté Ollama. Pour un autre modèle, par exemple plus
léger, créez `web/borne/.env.local` avec `VITE_OLLAMA_MODEL=qwen3:4b`.

À la sortie de la scène « Échange », la borne produit un **résumé clinique**
(jamais le verbatim) et l'envoie au serveur de bord via le proxy `/bord`, qui
ajoute `BORNE_TOKEN` lu dans `server/.env` — le navigateur ne voit jamais le
jeton. Il faut donc `npm run dev:server` en parallèle pour que la remontée
aboutisse ; sinon la barre d'état affiche « Serveur de bord injoignable ».

La console lit le serveur de bord quand il répond, et retombe sur son jeu de
démonstration sinon — en le disant dans son en-tête. Pour la brancher sur la
base (**Node 24 ou plus**, pour `node:sqlite`), copiez le modèle de
configuration et renseignez le jeton des bornes :

```bash
cp server/.env.example server/.env
```

Renseignez le jeton des bornes dans `server/.env` (voir
[Qui entre, et comment](#qui-entre-et-comment)), puis chargez la base :

```bash
npm run db:reset
```

```bash
npm run dev
```

lance les quatre services dans un seul terminal. Chaque ligne porte le nom du
service qui l'a écrite, Ctrl+C les arrête tous, et la dernière chose affichée
est la liste des adresses :

| Service | Adresse |
|---|---|
| Borne — écran 01 | <http://localhost:5173> |
| Console — écrans 02 à 04 | <http://localhost:5174> |
| Serveur de bord — l'API | <http://localhost:5175> |
| Backoffice | <http://localhost:5176> |
| Serveur de bord, côté Wi-Fi — pour le bracelet et l'équipe nutrition | `http://<adresse du poste>:5177`, ouvert seulement si `BRACELET_TOKEN` ou `NUTRITION_TOKEN` est renseigné — voir [En Wi-Fi, sans borne](#en-wi-fi-sans-borne) et [L'équipe nutrition](#léquipe-nutrition) |

Sola n'ouvre que ces cinq ports, et aucun ne bouge : un port déjà pris fait
échouer son service au lieu de le décaler au suivant — une console servie
ailleurs que sur 5174 ne serait plus une origine autorisée par le serveur, et
la connexion échouerait sans raison visible. Un port que tient encore un
ancien serveur Sola, oublié dans un autre terminal, `npm run dev` le libère
avant de lancer le sien ; tenu par un autre programme, il n'y touche pas et
dit lequel.

`npm run dev -- console server` n'en lance que certains, et `npm run dev:borne`,
`dev:console`, `dev:server` ou `dev:backoffice` en lance un seul, sans rien
libérer.

La console lit le serveur de bord quand il répond, et retombe sur son jeu de
démonstration sinon — en le disant dans son en-tête. Sans `server/.env`,
`npm run dev` lance les trois interfaces seules et le signale.
`npm run build` et `npm run typecheck` traversent tous les espaces de travail.

Une commande par bloc : l'équipe est sous Windows PowerShell, qui ne connaît
pas l'enchaînement `&&`.

### Avec Docker

Les quatre services tournent aussi sous Docker, aux mêmes adresses, sans
`npm install` sur le poste. Il faut Docker — Docker Desktop sous Windows,
démarré — et `server/.env`, rempli comme plus haut :

```bash
docker compose --env-file server/.env up --build
```

Le premier lancement construit les images et crée la base. Ctrl+C arrête
tout ; `docker compose down` retire ensuite les conteneurs, sans toucher à la
base.

`--env-file` ne sert qu'au jeton des bornes : Compose le lit dans `server/.env`
et ne le passe qu'à la borne, quand le serveur reçoit tout le fichier. Sans
cette option, la borne démarre sans jeton et le dit dans son journal : résumés
et trames ne partent plus.

Ce qui change par rapport à `npm run dev` :

- **La base n'est pas `sola.db`.** Celle du serveur vit dans le volume
  `sola_donnees`, créée au premier démarrage avec le même jeu de démonstration
  et les mêmes comptes que `npm run db:reset`, puis gardée d'un lancement à
  l'autre. `npm run db:sql` et `npm run compte` ne la voient pas ; les mêmes
  scripts tournent dans le conteneur :

  ```bash
  docker compose exec server node scripts/db-sql.mjs "SELECT COUNT(*) FROM signaux"
  ```

  ```bash
  docker compose exec server node scripts/db-compte.mjs liste
  ```

  `docker compose down --volumes` l'efface, comme `npm run db:reset` efface
  `sola.db` : même précaution, on demande avant.
- **La borne est servie par `vite preview`**, sur son build : c'est ce qui lui
  garde son relais, le même, lu dans `web/borne/vite.config.ts`. Ollama reste
  sur le poste, et la borne le joint par `host.docker.internal`. La console et
  le backoffice sont des fichiers statiques, servis par nginx.
- **Les ports sont publiés sur `127.0.0.1`**, comme `npm run dev` n'écoute que
  sur le poste. Seul 5177, le port réseau, s'ouvre au Wi-Fi : c'est son rôle.
  Le journal du serveur y annonce les adresses du conteneur, que le Wi-Fi ne
  joint pas : c'est celle du poste qu'on écrit dans le bracelet. Sous Windows,
  le pare-feu doit alors laisser passer Docker Desktop sur ce réseau, comme il
  laissait passer Node.

Docker et `npm run dev` publient les mêmes ports : arrêter l'un
(`docker compose down`) avant de lancer l'autre.

### Qui entre, et comment

Deux portes, et elles ne se ressemblent pas, parce qu'elles ne laissent pas
passer la même chose.

**Les bornes de cabine** portent `BORNE_TOKEN`, un jeton dans `server/.env`,
comparé à temps constant. Une borne est une machine : elle ne tape pas de mot
de passe, et elle n'écrit que des mesures, des nuits, des résumés. Elle n'a
aucune raison de pouvoir modifier un dossier. Le serveur refuse de démarrer si
le jeton fait moins de 32 caractères. Pour en fabriquer un :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Un bracelet qui envoie lui-même en Wi-Fi** porte un second jeton de machine,
`BRACELET_TOKEN`, fabriqué de la même façon et distinct du premier : le serveur
refuse de démarrer sinon. Il est écrit dans le code du bracelet, et un bracelet
se perd plus facilement qu'une borne ; il n'ouvre donc que l'envoi des trames,
sur un port à part — voir [En Wi-Fi, sans borne](#en-wi-fi-sans-borne).

**L'équipe nutrition** porte un troisième jeton de machine, `NUTRITION_TOKEN`,
distinct des deux autres. Il se confie à une autre équipe : il n'ouvre que la
lecture des moyennes des bilans sanguins, sur le même port, et le changer lui
retire l'accès — voir [L'équipe nutrition](#léquipe-nutrition).

**Les soignants et les administrateurs** ont un compte : une adresse, un mot de
passe haché en **argon2id** (paramètres OWASP : 19 MiB, 2 passes), et une
session de douze heures dans un cookie `httpOnly` que nul script de la page ne
peut lire. La base ne garde que l'empreinte SHA-256 du jeton de session — une
copie du fichier `sola.db` n'ouvre aucune session.

Un médecin ouvre la console, un administrateur ouvre la console **et** le
backoffice. Dans la console, l'administrateur voit ce que voit un médecin mais
n'y fait aucun geste de soin : prendre ou clore un signal, signer une note, le
serveur le réserve aux comptes soignants. La borne de cabine, elle, reste
accessible à tous : c'est une porte de couloir, pas un dossier.

Le premier compte se crée au terminal, donc physiquement à bord — c'est la
réponse la plus simple au problème du premier compte, celui qu'aucun compte
existant ne peut créer :

```bash
npm run compte -- admin
```

```bash
npm run compte -- medecin
```

```bash
npm run compte -- mdp quelquun@odyssee.vol
```

`npm run compte -- liste` affiche les comptes existants. Le mot de passe se
tape sans écho et n'apparaît jamais dans un argument de commande, donc jamais
dans l'historique du shell.

Derrière HTTPS, mettre `COOKIE_SECURE=1` dans `server/.env` : le cookie porte
alors l'attribut `Secure`. En développement sur `http://localhost`, le laisser
à `0`, sinon le navigateur refuse de le poser.

### Le jeu de test

`npm run db:load` charge le schéma, les vues et **13 résidents scriptés** — ceux
des maquettes, dont R-0448 dont la fiche raconte toute l'histoire du projet.
`npm run db:demo` complète jusqu'à **1 240 résidents** et environ 190 000 lignes :
constantes quotidiennes, nuits, scores de dépistage, conversations, signaux
ouverts et clos, et 3 720 bilans sanguins. `npm run db:reset` enchaîne les deux.

Le générateur crée aussi **huit comptes de démonstration** — cinq soignants,
trois administrateurs — et imprime adresses et mots de passe à la fin. C'est un
jeu de démonstration sur une base synthétique et locale, pas une base de
production, et le dire vaut mieux que le cacher à moitié.

Parmi eux, un passe-partout pour le développement : **`root@root.com`**, mot de
passe **`admin`**. Il est administrateur, donc il ouvre la console *et* le
backoffice. Il ne signe pas de note de dossier et ne prend aucun signal —
`auteur_id` pointe sur `medecins`, et un geste clinique porte le nom d'un
soignant. Le bouton « Ajouter une note » lui reste affiché, grisé, et dit
pourquoi ; pour écrire ou prendre un signal, se connecter avec un des cinq
comptes médecin. **Ce compte n'a
rien à faire sur une instance accessible à d'autres** : supprimer sa ligne dans
`scripts/db-demo.mjs` avant tout déploiement.

Le générateur est **déterministe** (graine 4 128) : deux exécutions donnent la
même base, donc la même soutenance — datée du jour où elle est générée, pour
que la démonstration se passe toujours « aujourd'hui ». Et il est **calibré** —
il tire une population plausible, puis corrige le nombre de résidents au-dessus
de chaque seuil pour retomber exactement sur les chiffres des maquettes. Les
8,4 % de PHQ-9 ≥ 10 affichés par l'écran 02 sont donc calculés sur 1 240 lignes,
pas écrits en dur quelque part.

```bash
npm run db:repli
```

fige deux réponses du serveur de bord — l'écran 02 et la fiche de R-0448 —
dans `web/console/src/data/`. C'est ce que la console affiche serveur éteint :
la réponse de la base, passée par le même adaptateur que la réponse vivante,
et non un second jeu de chaînes tenu à la main. À relancer après chaque
`db:reset`, puisque le repli garde les dates du jour où il a été figé ;
`npm run db:repli -- --verifier` dit s'il a dérivé, sans rien écrire.

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

recalcule une journée entière, des mesures à la minute à une ligne par
résident. Le serveur de bord, lui, tient à jour la ligne du jour à chaque trame
reçue : ce script ne sert qu'à refaire un jour.

### La borne se parle, elle ne se touche pas

L'écran 01 n'a aucune commande. On lui parle, elle répond à voix haute, et
l'écran ne garde de l'échange que la dernière phrase du résident et la réponse
de Sola, sous le chat qui en occupe l'essentiel. Rien ne défile — la borne est
un mur, elle occupe exactement l'écran.

Au premier chargement, un voile demande un geste : ni le micro ni la synthèse
vocale ne s'ouvrent sans lui, c'est une règle du navigateur. Ensuite la borne
écoute en continu, sans mot d'éveil : en conversation libre, chaque phrase
entendue part à Sola.

**On peut lui couper la parole.** Le micro reste ouvert pendant qu'elle parle :
la question affichée se répond sans attendre la fin de la phrase, et Sola se
tait dès qu'on lui parle dessus. Elle s'entend donc elle-même — un filtre
compare ce qui est entendu à ce qu'elle dit ou vient de dire, et n'en retient
que l'autre voix. Ce filtre travaille sur du texte, pas sur du son : au casque
il n'a rien à faire, et c'est la configuration à préférer pour une
démonstration.

**Les questions passent par une fenêtre.** Quand Sola demande quelque chose, le
chat se range à gauche et une feuille monte du bas avec les réponses possibles.
Chacune porte son bouton *et* le mot qui suffit à la dire — « oui », « non »,
« annule ». Le doigt sert à qui est debout devant la borne ; la voix sert à qui
ne l'est pas, ce qui est précisément le cas dans le scénario d'alerte.

**En alerte, le chat cède la place.** Il se range dans un coin, et l'écran dit
en grand qui arrive et dans combien de minutes, ce qui est déjà fait — porte
déverrouillée, contact de confiance prévenu — et la question que Sola pose à
voix haute. D'une disposition à l'autre, le chat glisse et change de taille
pendant que le reste s'efface ; si le système demande moins d'animations, la
bascule est immédiate.

**La pastille du haut dit ce qui a quitté la cabine** : « Rien n'a quitté la
cabine », puis ce qui en est sorti — l'alerte partie à l'infirmerie, le résumé
d'un échange quand on le quitte, « remonté à ton médecin » quand il l'est. Elle
ne revient pas à « rien » d'une scène à l'autre : ce qui est parti l'est pour de
bon, une minute de constantes comprise. La barre d'état n'affiche le reste —
micro, envoi des trames, batterie du bracelet — que quand il y a quelque chose
à en dire.

**La barre d'espace double la voix de bout en bout**, et les touches `1` et `2`
répondent à une question ouverte : c'est ce qui sauve la démonstration quand le
micro est refusé ou la salle trop bruyante. En conversation libre, il n'y a pas
de réplique toute prête à faire dire au résident : la barre d'espace place le
curseur dans le champ « Ou écris à Sola », en pied de borne.

Le bandeau effacé en bas à droite rejoue les trois états de l'écran :

- **Échange** — conversation libre : Sola dit bonjour, puis chaque phrase du résident part au modèle local (`web/borne/src/ia.ts`), qui répond en une à trois phrases, à voix haute. L'historique ne vit que dans la page et s'efface au changement de scène ;
- **Apaisement** — respiration guidée 4-7-8, déclenchée dans la vraie vie par une hausse de stress ; Sola demande au bout d'un cycle si ça descend ;
- **Alerte** — les secours sont en route, Sola reste présente et vérifie qu'on l'entend.

Ce bandeau n'est pas l'interface de la borne, c'est la main de celui qui
présente : il s'efface au repos et revient au survol.

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

Le bouton **Appairer**, dans le bandeau de démonstration en bas à droite, ouvre le sélecteur Web Bluetooth. Deux contraintes : **Chrome ou Edge** en contexte sécurisé (`localhost` suffit), et un **clic** de l'utilisateur — c'est pourquoi l'appairage n'est pas automatique, et c'est aussi pourquoi il est resté dans le bandeau plutôt que sur l'écran de la borne, qui n'a plus de bouton. Une fois connectée, le bandeau affiche la FC et le RMSSD réels à la place des valeurs de démonstration. La batterie, elle, reste une valeur fixe du firmware : l'ESP32 du prototype n'est pas sur batterie.

### Transmettre au serveur de bord

Appairée, la borne relaie au serveur de bord chaque trame du service Sola, une par seconde. Elle ne calcule rien : elle horodate — l'ESP32 n'a pas d'horloge —, range les trames par minute et n'envoie que des minutes closes, dix au plus par envoi. Le serveur fait de chaque minute **une ligne de `mesures`**, puis recalcule la ligne du jour de `mesures_jour`, que lisent la fiche et le registre. La barre d'état dit où en est l'envoi : première minute en cours, heure du dernier envoi, serveur injoignable avec le nombre de minutes en attente, ou le motif d'un refus.

Le jeton de `/ingest` n'est jamais dans la page. Le serveur de développement de la borne l'ajoute en relayant la requête (`web/borne/vite.config.ts`). Il le lit dans `server/.env` et ne le prête qu'à une page de sa propre origine, ouverte sur le poste même.

Le contrat, `POST /ingest/bracelet` — la trame est celle que publie `statusJson()` dans le firmware, plus `at` :

```json
{
  "resident": "R-0448",
  "bracelet": "BR-0448",
  "trames": [
    { "at": "2026-09-23T11:14:05.012Z", "id": "R-0448", "bpm": 72.4, "rmssd": 41.2,
      "spo2": 97, "act": 0.0123, "sleep": 0, "tst": 0, "waso": 0, "hrRest": 64,
      "fall": 0, "shake": 0, "q": "good" }
  ]
}
```

| Clé | Firmware | Sens | Ce que le serveur en fait |
|---|---|---|---|
| `at` | ajoutée par la borne | horodatage ISO 8601 | range la trame dans sa minute, en UTC |
| `id` | les deux | code résident écrit dans le firmware | doit valoir `resident`, sinon `409` |
| `bpm`, `rmssd` | les deux | FC moyenne, RMSSD en ms ; `0` = pas de valeur fiable | `fc_bpm`, `rmssd_ms` : moyenne des secondes `good` ou `fair` |
| `q` | les deux | `good` · `fair` · `poor` · `warmup` | `qualite` : vote majoritaire, le pire l'emporte à égalité |
| `spo2` | I²C | %, non calibrée ; `0` = pas de valeur | `spo2_pct` : moyenne des secondes fiables |
| `act` | I²C | activité de la dernière époque close, en g | `activite_g` : moyenne de toutes les secondes |
| `sleep` | I²C | `1` si le firmware estime le résident endormi | `dort` : majorité des secondes |
| `tst`, `waso`, `hrRest`, `fall`, `shake` | I²C | époques de sommeil et d'éveil, base de repos, compteurs de chutes et de secousses | validées, pas encore conservées |
| `beats`, `amp` | KY-039 | battements dans la fenêtre, amplitude du signal | validées, pas encore conservées |

Un zéro n'est jamais moyenné, et une valeur hors des bornes physiologiques est écartée : elle coûte une seconde, pas le lot. La SpO₂, elle, se garde sur toute l'échelle, de 1 à 100 % : une saturation très basse est justement celle qu'il ne faut pas perdre. Respiration, température, activité électrodermale et pas restent `NULL`, parce que le bracelet ne les mesure pas. Une clé inconnue fait en revanche échouer le lot entier en `400`, volontairement : une clé que le firmware viendrait d'ajouter se déclare dans `trameSchema` (`server/src/validation.ts`), elle ne se perd pas en silence. Le serveur répond `202` avec le nombre de trames et de minutes reçues et, s'il en a écarté, les valeurs hors bornes, champ par champ, dans `ecartees` : elles ne comptent pas, mais l'émetteur sait qu'elles existent. Il refuse en `404` un résident ou un bracelet inconnu, et en `409` un bracelet qui n'est pas attribué à ce résident.

Les mesures arrivées se lisent au backoffice, onglet *Base* → `mesures`, ou au terminal :

```bash
npm run db:sql "SELECT mesure_at, fc_bpm, rmssd_ms, spo2_pct, qualite FROM mesures WHERE bracelet_id = (SELECT id FROM bracelets WHERE serie = 'BR-0448') ORDER BY mesure_at DESC LIMIT 10"
```

### En Wi-Fi, sans borne

Un bracelet qui a le Wi-Fi peut envoyer lui-même, sans borne ni Bluetooth. Avec `BRACELET_TOKEN` dans `server/.env`, le serveur de bord ouvre un second port, `PORT_RESEAU` (5177 par défaut), joignable depuis le réseau local. Ce port ne sert que `POST /ingest/bracelet`, avec ce jeton, `GET /health` et, avec le sien, [la lecture de l'équipe nutrition](#léquipe-nutrition) ; la console, le backoffice et la connexion n'écoutent que sur le poste. Au démarrage, le journal du serveur donne l'adresse à écrire dans le bracelet.

Le bracelet y envoie le même lot que la borne, ou une lecture seule, que le serveur horodate à l'arrivée — c'est ce que fait un croquis Arduino sans horloge. `resident`, `bracelet` et `bpm` sont obligatoires ; un `rmssd` absent vaut zéro, une qualité absente vaut `fair` :

```json
{ "resident": "R-0448", "bracelet": "BR-0448", "bpm": 72, "spo2": 97 }
```

Les lectures d'une même minute font une seule ligne de `mesures`, recalculée à chaque envoi. Le journal du serveur écrit une ligne par requête venue du réseau — code HTTP, nombre de trames, motif d'un refus, jamais une valeur mesurée : c'est ce qu'on lit pendant qu'on règle un bracelet, dont le moniteur série ne montre souvent que le code. Sous Windows, le pare-feu demande au premier lancement s'il laisse Node écouter : sans cette autorisation pour le réseau du bracelet, le port reste injoignable.

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

Ce que le prototype mesure vraiment, selon le firmware :

| Constante | KY-039 (repli) | MAX30102 + MPU6050 |
|---|---|---|
| Fréquence cardiaque, RMSSD | mesuré | mesuré |
| Oxygénation (SpO₂) | simulé | mesuré, **non calibré** |
| Activité, secousses, chutes | simulé | mesuré |
| Durée de sommeil | simulé | **estimé** (voir ci-dessus) |
| Respiration, température, activité électrodermale, pas | simulé | simulé — le matériel ne les mesure pas |

La fiche, elle, ne fait pas la différence, et c'est voulu : dans le jeu de démonstration tout est synthétique, et les huit constantes y ont le même rang et la même règle d'alerte. Les séparer ferait croire qu'une moitié du dossier est vide. Le seul bloc marqué est le bilan sanguin : un bilan simulé porte « valeurs simulées » à son pied.

## Limites connues

- **L'estimation du sommeil surestime.** Rester allongé éveillé, immobile et détendu est classé comme du sommeil : compter une erreur de l'ordre de la demi-heure sur une nuit. Les stades (léger / profond / paradoxal) ne sont pas calculés — sans EEG, ce serait de l'invention.
- **La SpO₂ n'est pas calibrée.** Le rapport des rapports est appliqué avec les coefficients génériques de la littérature, sans oxymètre de référence. La valeur montre une tendance, elle ne pose pas un diagnostic.
- **Le PPG au poignet est difficile.** Le MAX30102 mesure par réflexion : le signal y est 5 à 10 fois plus faible qu'au doigt, et le moindre mouvement fait perdre le contact. C'est la contrainte matérielle la plus lourde du prototype.
- **Le modèle de la borne exige Ollama sur la machine.** Sans lui, Sola répond par une phrase de repli (« si c'est urgent, appelle l'infirmerie ») et la barre d'état affiche « IA locale injoignable ». Sur le poste de développement (RTX 4050 Laptop, 6 Go), `qwen3:8b` ne tient pas entièrement en mémoire graphique : le premier chargement prend une dizaine de secondes, puis une réponse commence en moins d'une seconde et se termine en 4 à 7 secondes. `qwen3.5:4b` tient entièrement sur la carte et répond en 2 secondes, mais il invente nettement plus : il n'est pas retenu.
- **Le résumé clinique dépend d'Ollama et du serveur de bord.** À la sortie de « Échange », un second appel au modèle produit un résumé (mental et physique évoqués à l'oral) ; le proxy `/bord` l'envoie à `POST /ingest/conversation`. Si la sévérité n'est pas `info`, un signal s'ouvre dans la file du médecin. Sans Ollama le résumé n'est pas produit ; sans serveur (ou sans `BORNE_TOKEN` dans `server/.env`) la barre d'état le dit. Le verbatim ne quitte jamais la cabine.
- **Sola ne déclenche aucune action, et la plupart de ses règles sont des consignes.** Elle ne peut ni prévenir la maintenance, ni régler la lumière, ni contacter quelqu'un. Trois garde-fous sont écrits dans le code (`web/borne/src/ia.ts`) : une urgence (douleur thoracique, gêne respiratoire, malaise, idée suicidaire) reçoit une réponse écrite à l'avance et force la sévérité `critique` du résumé ; une phrase qui prétend une action est remplacée ; une phrase qui nomme une maladie est retirée. Le reste — ne rien inventer, rester dans le sujet — n'est que consigne, et un modèle de 8 milliards de paramètres s'en écarte encore : conseil incongru, faute de français, supposition.
- **La détection d'urgence repose sur des mots-clés.** Elle reconnaît les formulations courantes (« douleur dans la poitrine », « du mal à respirer », « plus envie de vivre »…) ; une formulation qu'elle ne connaît pas passe au modèle, qui n'a plus alors que sa consigne. Elle préfère le faux positif : une phrase de trop coûte moins qu'une urgence manquée.
- **Le bracelet ne remplit que trois tuiles de la fiche.** Chaque trame reçue recalcule la ligne de son jour dans `mesures_jour`, que lisent la fiche et le registre, mais la trame ne porte ni la respiration, ni la température cutanée, ni l'activité électrodermale, ni les pas : restent la FC de repos, la SpO₂ et la variabilité, qu'un croquis Arduino n'envoie souvent pas. Les autres constantes gardent la valeur du jeu de démonstration ; un jour que le bracelet est seul à écrire, leur tuile reprend la dernière valeur connue, datée, alerte comprise.
- **Le jour d'une mesure est le jour UTC.** `mesures` est horodatée en UTC : une minute reçue peu après minuit, heure locale, compte encore pour la veille.
- **Le port réseau parle HTTP en clair, avec un seul jeton pour tous les bracelets.** Qui écoute le Wi-Fi lit le jeton, et ce jeton dit qu'un envoi vient d'un bracelet de Sola, pas duquel : le serveur vérifie seulement que le bracelet nommé est bien celui du résident nommé. Le jeton de l'équipe nutrition y passe en clair lui aussi : il n'ouvre que des moyennes, mais qui l'a lu les lit. À bord, ce port passerait en TLS, avec un secret par bracelet.
- **Les moyennes de l'équipe nutrition ne distinguent pas le sexe.** La base ne le connaît pas, et chaque marqueur y a les mêmes bornes pour tous, alors qu'au laboratoire celles de l'hémoglobine et de la ferritine en dépendent : une part sous la borne compte tout l'équipage contre les mêmes seuils.
- **La borne ne transmet que servie par Vite.** C'est son serveur de développement qui ajoute le jeton de `/ingest`. Publiée en fichiers statiques, elle n'aurait plus de relais, et ce rôle reviendrait au serveur de bord ou à un service de la cabine. Sa file d'attente vit en mémoire : une heure au plus, perdue si l'on recharge la page.
- **Une partie de la trame est reçue sans être conservée.** `tst`, `waso`, `hrRest`, `fall`, `shake`, `beats` et `amp` sont validées puis écartées : aucune table ne les attend encore. En particulier, une chute comptée par le bracelet n'ouvre pas de signal. Seul `POST /ingest/evenement` en ouvre un, et la borne ne l'appelle pas.
- **La borne n'est pas branchée sur la base pour le résumé IA.** L'écran 01 ne connaît du résident que ce que son prompt lui dit. Un problème physique n'entre dans le résumé que s'il a été dit à l'oral.
- **La reconnaissance vocale de la borne dépend du navigateur.** `SpeechRecognition` n'existe aujourd'hui que dans les navigateurs à moteur Chromium, et elle y passe par un service distant de Google — un vrai vaisseau ne s'en contenterait pas. Ailleurs, ou micro refusé, la borne le dit dans sa barre d'état et se conduit à la barre d'espace. Ce que Sola entend ne va qu'au modèle local : le verbatim n'est ni enregistré ni envoyé ; seul le résumé clinique peut partir au serveur de bord.
- **Dans Chrome, Sola parle avec la voix de Google.** Les voix de Windows, seules à parler sans réseau, sonnent mécaniques : la borne leur préfère « Google français », et dans Edge une voix « Natural » de Microsoft. Ces voix sont distantes : chaque réplique, réponses du modèle comprises, part chez Google — ou Microsoft — pour être prononcée. La pastille « Rien n'a quitté la cabine » ne le compte pas : elle ne suit que ce qui part vers le bord. Hors ligne, ou si la voix distante ne répond pas en deux secondes et demie, la réplique repart avec une voix de Windows, qui garde la parole une minute.
- **Sola ne reconnaît sa propre voix que par le texte.** Le micro reste ouvert pendant qu'elle parle, pour qu'on puisse la couper, et ce qu'il entend est écarté quand ce sont ses mots à elle. Un mot qu'elle vient de dire ne vaut donc pas réponse, ni pendant sa phrase ni dans les deux secondes qui suivent : à une question, mieux vaut répondre « oui » ou « d'accord » que reprendre ses mots, et en conversation libre une phrase qui reprend surtout les siens peut être ignorée. Le filtre dépend aussi de ce que l'annulation d'écho de Chrome laisse passer ; au casque, il n'a rien à faire.
- **Aucune purge des mesures n'est implémentée.** Le schéma prévoit une rétention de 90 jours sur `mesures` ; rien ne l'applique aujourd'hui. La base cabine, elle, efface bien le verbatim à 30 jours, par un trigger.
- **Les bilans sanguins du jeu de démonstration sont simulés.** Les 29 marqueurs, leurs bornes de référence et leurs unités sont ceux d'un bilan réel, mais les valeurs sont tirées par le générateur : chaque bilan porte `source = 'simule'` et la fiche l'affiche.
- **Un geste clinique ne se défait pas, et un dossier ne se corrige plus à l'écran.** Le backoffice n'écrit que l'état d'un compte. Un signal pris ne passe pas à un autre soignant, un signal clos ne se rouvre pas, une note de particularité erronée ne se retire pas, et le poste ou la cabine d'un résident ne se modifient plus depuis une interface.
- **Serveur éteint, seule la fiche de R-0448 s'affiche.** Le repli de la console ne contient que les deux réponses figées par `npm run db:repli`, l'écran 02 et cette fiche. Celle d'un autre résident dit qu'elle est indisponible, plutôt que de montrer R-0448 sous un autre nom.
- **Sous Docker, la borne ne reconnaît plus le poste à son adresse.** Dans un conteneur, toute requête arrive de la passerelle de Docker : le relais ne vérifie plus que la méthode et l'origine (`BORNE_CONTENEUR=1`), et c'est la publication de son port sur `127.0.0.1`, dans `compose.yaml`, qui garde le poste. Publiée sur une autre adresse, la borne prêterait son jeton de `/ingest` à tout le réseau.
- **Les données sont synthétiques.** Elles sont calibrées pour être vraisemblables et cohérentes entre elles, pas pour être vraies. Aucun chiffre de ce dépôt ne dit quoi que ce soit d'une population réelle.

## Le serveur de bord

`server/` fait deux choses : recevoir ce que les bornes envoient, et servir ce que la console lit.

| Route | Qui appelle | Rôle |
|---|---|---|
| `POST /ingest/mesure` | la borne | lot de constantes, jusqu'à 1 440 minutes d'un coup après une coupure |
| `POST /ingest/bracelet` | la borne, par son relais ; le bracelet lui-même, sur le port réseau | trames brutes du bracelet, une par seconde ; le serveur en fait une ligne par minute — [le contrat](#transmettre-au-serveur-de-bord) |
| `POST /ingest/nuit` | la borne | durée de sommeil estimée de la nuit |
| `POST /ingest/conversation` | la borne | **résumé** clinique — voir ci-dessous |
| `POST /ingest/evenement` | la borne | chute, secousse, bouton d'urgence |
| `GET /api/crew` | la console | écran 02 : indicateurs, courbes, file de triage |
| `GET /api/residents/:code` | la console | écran 03 : la fiche complète |
| `GET /api/residents/:code/direct` | la console | écran 03 : la dernière minute du bracelet, l'heure écoulée et le jour en cours, relus toutes les dix secondes |
| `GET /api/equipage` | la console | écran 04 : les 1 240 résidents, triés et filtrés par le serveur |
| `GET /api/signaux` | la console | écran 04 : les signaux, de l'ouverture à la clôture |
| `GET /api/signaux/stats` | la console | écran 04 : signaux à traiter, faux positifs à la clôture, motifs de clôture à revoir |
| `PATCH /api/signaux/:id` | la console | écrans 02 à 04 : un médecin prend un signal, ou le clôt avec un des motifs de son origine |
| `POST /api/residents/:code/particularites` | la console | écran 03 : une note de particularité écrite par le médecin |
| `POST /auth/connexion` | la console, le backoffice | ouvre une session : adresse + mot de passe contre l'empreinte argon2id |
| `GET /auth/moi` | la console, le backoffice | qui est connecté ; un `401` est une réponse normale — « personne » |
| `POST /auth/deconnexion` | la console, le backoffice | ferme la session et efface le cookie |
| `GET /admin/…` | le backoffice | correspondance écran ↔ requête, fraîcheur des flux, lignes brutes des tables, comptes |
| `PATCH /admin/comptes/:role/:id` | le backoffice | activer ou désactiver un compte — sa seule écriture |
| `GET /partenaires/nutrition/bilans` | l'équipe nutrition, sur le port réseau | moyennes des bilans sanguins sur un cycle de quatorze jours — [le contrat](#léquipe-nutrition) |

L'ingestion demande un jeton porteur, comparé à temps constant : une borne est une machine. Tout `/api` exige une session ouverte, tout `/admin` exige en plus le rôle administrateur. Une note de particularité écrite depuis la console porte désormais l'identifiant du médecin connecté, et la fiche affiche sa signature ; un signal pris ou clos porte de même le nom de qui l'a fait — c'est ce qui manquait, et c'est ce qui rend le dossier défendable. La connexion est freinée après trois échecs, avec un délai qui double, et une adresse inconnue coûte le même temps de calcul qu'une adresse connue : sans cela, la durée de la réponse dirait lesquelles existent. Toutes les requêtes sont préparées avec des paramètres nommés — **aucune concaténation SQL nulle part**, y compris pour le tri : le nom de colonne envoyé par l'écran 04 passe par une table de correspondance, et une clé inconnue retombe sur le tri par défaut au lieu d'atteindre le SQL.

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

## L'équipe nutrition

Une autre équipe du workshop adapte les cultures du *Projet Odyssée* aux carences de l'équipage. Elle lit les bilans sanguins de Sola **en moyennes, jamais en dossiers** : une requête quand elle veut, aussi souvent qu'elle veut, et l'historique se tient chez elle.

```bash
curl.exe -H "Authorization: Bearer <NUTRITION_TOKEN>" "http://<adresse du poste>:5177/partenaires/nutrition/bilans"
```

`curl` hors de Windows. La route n'existe qu'avec `NUTRITION_TOKEN` dans `server/.env`, et au démarrage le journal du serveur donne son adresse. Une page web peut l'appeler aussi : les en-têtes CORS sont ouverts, le jeton reste exigé. `?au=AAAA-MM-JJ` rejoue une période passée.

**Une réponse, un cycle de prélèvement.** Chaque résident a un bilan tous les quatorze jours, à une date qui lui est propre. La réponse couvre les quatorze jours qui finissent au jour courant de la console, et ne garde que le dernier bilan de chacun : tout l'équipage y compte, une fois. Appelée chaque jour, la fenêtre glisse ; tous les quatorze jours, les périodes se suivent sans se chevaucher.

**La moyenne ne part jamais seule.** Une ferritine moyenne de 170 µg/L, en pleine plage de référence, cache 6,1 % de l'équipage sous la borne basse. Chaque marqueur donne donc aussi la part des résidents hors bornes, chaque résultat comparé aux bornes écrites avec lui. Sur moins de 11 résidents, l'effectif reste mais les valeurs partent à `null` : c'est la règle du CASD pour les données de santé du PMSI, aucune case ne concerne moins de 11 patients.

```json
{
  "periode": { "du": "2026-09-10", "au": "2026-09-23", "jours": 14, "jour_vol_du": 4115, "jour_vol_au": 4128 },
  "equipage": 1240,
  "preleves": 1240,
  "source": "simule",
  "effectif_min": 11,
  "marqueurs": [
    { "cle": "hemoglobine", "libelle": "Hémoglobine", "groupe": "carence", "unite": "g/dL",
      "ref_bas": 13, "ref_haut": 17, "n": 1240, "moyenne": 15.01, "ecart_type": 1.38,
      "pct_bas": 7.4, "pct_haut": 6.6 },
    { "cle": "ferritine", "libelle": "Ferritine", "groupe": "carence", "unite": "µg/L",
      "ref_bas": 30, "ref_haut": 300, "n": 1240, "moyenne": 170.07, "ecart_type": 87.68,
      "pct_bas": 6.1, "pct_haut": 7.1 }
  ]
}
```

| Champ | Sens |
|---|---|
| `periode` | premier et dernier jour, inclus, en dates et en jours de vol |
| `preleves`, `equipage` | résidents comptés, résidents à bord |
| `source` | `analyse`, `simule` — le jeu de démonstration — ou `mixte` |
| `n` | résidents dont le marqueur est dosé sur la période |
| `moyenne`, `ecart_type` | dans l'unité du marqueur |
| `pct_bas`, `pct_haut` | part des résidents sous la borne basse, au-dessus de la borne haute, en % |

**Douze marqueurs sur vingt-neuf** : ceux dont le taux sanguin suit ce que l'on mange. Pour le groupe `carence`, c'est `pct_bas` qui compte les manques ; pour `equilibre`, `pct_haut`, sauf pour le HDL.

| `cle` | Marqueur | Groupe | Ce qu'il dit de la ration |
|---|---|---|---|
| `hemoglobine` | Hémoglobine | carence | l'anémie, que cause souvent un manque de fer, de B12 ou de folates |
| `ferritine` | Ferritine | carence | les réserves de fer ; elle monte aussi avec une inflammation, qui peut masquer un manque |
| `fer_serique` | Fer sérique | carence | le fer qui circule, plus variable d'un jour à l'autre |
| `vitamine_d` | Vitamine D | carence | sans soleil, elle ne vient plus que de l'assiette ou de lampes UV |
| `vitamine_b12` | Vitamine B12 | carence | aucune plante n'en fait : produits animaux, ou cultures bactériennes |
| `folates` | Folates | carence | légumes verts à feuilles, légumineuses |
| `glycemie` | Glycémie à jeun | equilibre | la régulation du sucre, le matin |
| `hba1c` | HbA1c | equilibre | la glycémie moyenne des deux à trois derniers mois |
| `cholesterol_total` | Cholestérol total | equilibre | suit en partie les graisses de la ration |
| `ldl` | LDL | equilibre | monte avec les graisses saturées |
| `hdl` | HDL | equilibre | protège : c'est le bas qui compte, et il n'a pas de borne haute |
| `triglycerides` | Triglycérides | equilibre | sucres rapides, alcool, excès de calories |

Les dix-sept autres restent à bord :

- **sodium, potassium, calcium** — le rein et les hormones tiennent leur taux sanguin quel que soit l'apport, qui se lit dans les urines ou les os. La vitamine D, transmise, règle l'absorption du calcium ;
- **TSH, T4 libre** — l'iode y joue, une maladie de la thyroïde bien davantage ; l'iode d'une population se dose dans les urines ;
- **hématocrite** — il redit l'hémoglobine, en suivant l'hydratation ;
- **leucocytes, plaquettes, ALAT, ASAT, créatinine, débit de filtration glomérulaire, CRP, vitesse de sédimentation, recherche d'agent infectieux, cortisol, DHEA-S** — infection, foie, reins, stress : aucun ne dit un nutriment.

Le choix des marqueurs vit dans `server/src/routes/partenaires.ts`, au même endroit que la requête.

## Le backoffice

`web/backoffice` est l'outil d'exploitation, séparé de la console médicale
parce qu'il ne répond pas à la même question. La console demande « comment va
cette personne ? » ; le backoffice demande « est-ce que ce que l'écran affiche
est bien ce que la base contient ? ».

| Onglet | Ce qu'il montre |
|---|---|
| **Écrans et sources** | chaque bloc de la console, la vue qui le remplit, et ce qu'elle renvoie maintenant |
| **Base** | la fraîcheur des flux d'abord, les volumes ensuite ; chaque table se parcourt en lignes brutes, sans passer par `sqlite3` |
| **Comptes** | qui a accès, qui ne s'est jamais connecté ; un compte se désactive sans être supprimé |

L'onglet **Écrans et sources** est le plus utile en soutenance : il met côte à
côte le bloc affiché, la vue SQL qui le remplit et la valeur qu'elle renvoie à
l'instant. La correspondance entre l'interface et la base devient vérifiable
d'un coup d'œil, au lieu d'être promise dans un document.

Le backoffice ne soigne pas : il n'écrit que l'état d'un compte. Prendre un
signal, le clore, signer une note se font dans la console, sous le nom d'un
soignant. Une clôture **exige un motif** parce que ce motif est la seule chose
qui permettra plus tard de mesurer les faux positifs du moteur de règles. Sans
lui, on sait qu'un signal a été fermé, jamais s'il aurait dû être ouvert.

## Licence

Projet pédagogique, fourni tel quel. **Aucun usage médical.**
