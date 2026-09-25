# Travailler sur Sola avec un agent

Ce fichier est lu automatiquement par Claude Code et par la plupart des agents de
code. Il dit **ce qu'on n'a pas le droit de faire**, **comment on écrit ici**, et
**où se trouve quoi** — pour qu'un agent n'ait pas à fouiller le dépôt à chaque
question.

Si vous modifiez la structure du projet, mettez la table du bas à jour dans le
même commit. Une carte fausse est pire que pas de carte.

---

## Le projet en cinq lignes

**Sola**, workshop EPSI *Horizon 2080*, catégorie **Santé humaine**. Un compagnon
de santé pour les 1 240 résidents du vaisseau générationnel *Projet Odyssée*, en route
depuis 4 128 jours. **Quatre écrans répartis sur trois applications web
distinctes**, un serveur de bord, une base SQLite de 17 tables, un bracelet
ESP32.

Le projet est **noté**. Les livrables doivent être carrés, clairs et concis.

---

## Les gardes-fous

Ces neuf points ne se négocient pas. Si une demande les contredit, le dire et
proposer autre chose plutôt que de les contourner.

### 1. Les secrets ne sortent jamais du disque

`server/.env` contient `BORNE_TOKEN`, `BRACELET_TOKEN` pour les bracelets en
Wi-Fi et `NUTRITION_TOKEN` pour l'équipe nutrition. On ne les recopie
**nulle part** : ni dans un fichier, ni dans un
message, ni dans un commentaire, ni dans une URL, ni dans un commit. Même règle
pour un mot de passe de compte, y compris celui d'un compte de démonstration
créé à la main. `.env` et `*.db` sont dans `.gitignore` — ne les en sortez pas.

**Le dépôt est public.** Tout ce qui est commité est lisible par n'importe qui.

Et un agent qui pilote un navigateur **ne tape pas un jeton ni un mot de passe
dans un champ de formulaire**. Pour tester une route authentifiée, on passe par
`curl`.

### 2. La base de démonstration s'efface en une commande

`npm run db:reset` détruit tout le contenu de `sola.db` et le régénère.
**Demander avant de la lancer** : quelqu'un a peut-être une saisie de test en
cours, et la veille d'une soutenance ce n'est pas le moment. Sous Docker, c'est
`docker compose down --volumes` qui efface la base du conteneur : même règle.

`npm run db:sql` ouvre la base en **lecture seule**, volontairement. Pour écrire,
il y a la console, qui valide ce qu'elle écrit et le signe, et `npm run compte`
pour les comptes. Pas d'`UPDATE` ni de `DELETE` tapé à la main.

### 3. Rien ne part sur GitHub sans demande explicite

Pas de `commit`, pas de `push`, pas de PR, pas de merge sans que quelqu'un l'ait
demandé dans la conversation. Jamais de commit direct sur `main` : on branche.

### 4. Aucune donnée de santé réelle

Tout le contenu de la base est **synthétique**, produit par
`scripts/db-demo.mjs`. Il est calibré pour être vraisemblable et cohérent, pas
pour être vrai. Aucune donnée concernant une personne réelle n'entre dans ce
dépôt, y compris celle d'un membre de l'équipe.

### 5. Aucune concaténation SQL, nulle part

Requêtes préparées à paramètres nommés, sans exception. **Y compris pour un nom
de colonne de tri** : le nom envoyé par le client passe par une liste blanche
(`TRIS_EQUIPAGE` / `TRIS_SIGNAUX` dans `server/src/routes/console.ts`), et une
clé inconnue retombe sur le tri par défaut au lieu d'atteindre le SQL. Les
filtres sont neutralisés *dans* la requête (`:q = '' OR …`) plutôt qu'en la
recomposant.

### 6. Aucun chiffre inventé

Un chiffre dans un README, une documentation ou un commentaire se vérifie avant
d'être écrit :

```bash
npm run db:sql "SELECT COUNT(*) FROM signaux"
```

Cela vaut aussi pour les chiffres à l'écran : les maquettes et le jeu de
démonstration sont calibrés pour coïncider, ne les désaccordez pas.

### 7. Une écriture dans un dossier porte un nom

La console et le backoffice passent par des comptes : `medecins`, `admins`,
`sessions`, mot de passe haché en **argon2id**, session de douze heures dans un
cookie `httpOnly`. `/api` exige une session, `/admin` exige en plus le rôle
administrateur, `/ingest` garde son jeton porteur parce qu'une borne est une
machine, et `/partenaires` le sien parce que l'équipe nutrition appelle depuis
un programme — il ne sert que des moyennes, jamais une ligne de dossier. La
borne de cabine reste accessible à tous.

Une note de particularité écrite depuis la console porte `auteur_id`. Ne
rouvrez pas une route d'écriture sans session, et ne servez jamais `mdp_hash` :
c'est pour cela que `medecins`, `admins` et `sessions` sont hors de la liste
blanche de `/admin/tables/:nom`, qui fait un `SELECT *`.

Créer un compte ou changer un mot de passe se fait au terminal
(`npm run compte`), pas par l'interface — le premier compte est celui qu'aucun
compte existant ne peut créer.

### 8. L'interface ne pose pas de diagnostic

On écrit « dépistage dépressif », pas « dépression ». Les seuils affichés sont
les seuils cliniques validés — **PHQ-9 ≥ 10**, **GAD-7 ≥ 10**, **ISI ≥ 15** — et
ne se changent pas sans une raison écrite. Le PHQ-9 se lit sur 0–27 ; le 9 est le
nombre d'items, le 10 est un seuil de score, les deux nombres n'ont rien à voir.

### 9. Les limites connues restent écrites

Le README a une section « limites » et elle est à jour. Si vous en levez une,
retirez la ligne. Si vous en créez une, ajoutez-la. Une limite assumée et
documentée est défendable en soutenance ; une limite cachée ne l'est pas.

**Les limites ouvertes aujourd'hui :** aucune purge des mesures n'est
implémentée, l'écran 01 rejoue des scénarios scriptés au lieu de lire la base —
il n'y écrit que les trames du bracelet —, le bracelet ne remplit que cinq
tuiles de la fiche — un jour qu'il est seul à écrire, les autres reprennent leur
dernière valeur, datée, alerte comprise —, son compteur de pas repart avec lui,
pas à minuit, les pas du jour ne se jugent que le lendemain — tant que le
bracelet remplit la journée, c'est la veille qui décide de l'alerte —, le jour
d'une mesure est le jour UTC,
l'historique d'une constante ne garde que la moyenne de chaque minute — seule la
carte « en direct » montre chaque lecture, dix minutes, et un redémarrage du
serveur les lui fait oublier —, le port réseau parle HTTP en clair, avec un seul jeton pour tous les bracelets
et celui de l'équipe nutrition, les moyennes transmises à cette équipe ne
distinguent pas le sexe, que la base ne connaît pas,
la borne ne transmet que servie par Vite, dont le relais porte le jeton, une
partie de la trame est reçue sans être conservée — une chute comptée par le
firmware BLE n'ouvre pas de signal —, une chute du croquis Wi-Fi se date à sa
réception et, le serveur redémarré pendant qu'elle est signalée, en rouvre un,
la conversation libre de la borne exige Ollama
sur la machine, le résumé clinique à la sortie d'« Échange » exige Ollama et le
serveur de bord (sinon la barre d'état le dit), le modèle de Sola ne déclenche
aucune action — seul le code de la borne transmet une alerte, sur mots-clés — et,
hors urgences gérées dans le code (réponses écrites, sévérité forcée), ses
règles ne sont que des consignes données au modèle, la détection d'urgence ne
repose que sur des mots-clés — une urgence qu'ils manquent n'ouvre aucune
alerte, et Sola ne renvoie vers l'infirmerie que si une alerte a échoué —, la
file de triage se lit du plus récent au plus ancien — l'horloge du jeu de
démonstration est celle du poste au moment de `npm run db:demo` —, les
bilans sanguins du jeu de démonstration sont
simulés (`source = 'simule'`, et la fiche le dit), la reconnaissance vocale de
la borne n'existe que dans les navigateurs à moteur Chromium — ailleurs elle
bascule au clavier et le dit dans sa barre d'état —, dans Chrome, Sola parle
avec la voix distante de Google — ce qu'elle dit part chez Google ; hors ligne,
une voix de Windows reprend —, Sola ne reconnaît sa propre voix que par le
texte : un mot qu'elle vient de dire ne vaut pas réponse dans
les 3,5 secondes qui suivent, un geste clinique ne se défait pas — ni signal à
rouvrir ou à réassigner, ni note à retirer —, aucun dossier ne se corrige à
l'écran, serveur éteint, seule la fiche de R-0448 s'affiche — le repli ne
contient qu'elle —, et, sous Docker, le relais de la borne ne reconnaît plus le
poste à son adresse : seule la publication de son port sur 127.0.0.1 l'empêche
de prêter son jeton au réseau.

---

## Les conventions d'écriture

**Français partout** — identifiants, commentaires, libellés d'interface, types
compris : ceux de `web/console/src/types.ts` sont en français depuis la refonte
des écrans 02 à 04 (`Constante`, `Pastille`, `cle`, `libelle`, `rendu`).

**Les commentaires disent *pourquoi*, pas *quoi*.** Le code dit déjà quoi. Un
commentaire qui paraphrase la ligne suivante est du bruit ; un commentaire qui
explique un arbitrage se garde.

**Tout écran de la console s'affiche rempli, serveur éteint.** C'est le rôle de
`useSource` : le repli est la valeur de départ, l'API la remplace quand elle
répond, et l'en-tête dit lequel des deux est affiché. Une console médicale qui
montre une page blanche parce qu'un service est tombé est pire qu'inutile. Deux
exceptions, et elles le disent : l'écran 04, qui lit forcément la base, et la
fiche d'un autre résident que R-0448, que le repli ne contient pas.

**Le repli est une réponse figée, pas un second jeu de chaînes.** Ce qui
s'affiche sur les écrans 02 et 03 ne s'écrit qu'à un endroit, `adapt.ts`.
Serveur éteint, le même adaptateur lit `data/crew.json` et `data/resident.json`,
deux réponses du serveur figées par `npm run db:repli`. Changer la forme de
`/api/crew` ou de `/api/residents/:code`, le générateur ou les vues oblige à
relancer ce script ; `npm run db:repli -- --verifier` dit quand il le faut.

**Les couleurs passent par les tokens** de `styles/tokens.css`, jamais en dur, et
les deux thèmes — clair et sombre — sont traités.

**Node 24 est requis** (`node:sqlite`). Le projet installe le moins de choses
possible : pas de client SQL, pas de dépendance native. Un vaisseau n'installe
pas d'outils, et l'équipe travaille sous Windows.

---

## Pièges connus de cet environnement

| Piège | Ce qui se passe | Quoi faire |
|---|---|---|
| **PowerShell 5.1** | `&&` est une erreur de syntaxe | Une commande par bloc dans le README ; `;` ou `if ($?)` sinon |
| **Heredocs Bash** | lâchent au-delà d'environ 100 lignes (`unexpected EOF`) | Écrire le fichier avec l'outil d'écriture, pas avec `cat <<` |
| **Cache de Vite** | après réécriture complète d'un fichier, le serveur de dev peut le servir **vide** (`Content-Length: 0`), d'où une page blanche | `touch` le fichier ; ce n'est pas votre code |
| **Captures d'écran** | le panneau navigateur échoue parfois (`Screenshot timed out`) | Mesurer en JavaScript (`getBoundingClientRect`) plutôt que regarder |
| **Micro dans le panneau navigateur** | il est bloqué : la borne affiche « micro refusé » | Piloter l'écran 01 au clavier (espace, `1`/`2`) — mais le clavier contourne l'écoute : pour tester interruption et écho, capturer le moteur en remplaçant `webkitSpeechRecognition.prototype.start`, puis appeler son `onresult` avec des résultats fabriqués. La vraie voix se teste dans Chrome |
| **Bluetooth dans le panneau navigateur** | aucun bracelet n'y est joignable, et le premier clic est pris par le voile du micro | Remplacer `navigator.bluetooth` par un faux qui notifie des trames, cliquer « Appairer » en JavaScript. Tester l'envoi contre une copie de la base (`VACUUM INTO`) et un serveur sur un autre port : une trame écrite dans `sola.db` ne s'efface plus, faute de purge |
| **Routes de la console** | `/residents/:id`, pas `/resident/:id` | Voir `web/console/src/App.tsx` |
| **Port déjà pris** | un serveur resté d'une autre session tient le port : Vite refuse de démarrer (`strictPort`, dans chaque `vite.config.ts`) au lieu de glisser sur 5178, où plus rien ne correspond | `npm run dev` arrête un serveur Sola qui tient l'un de ses ports, et nomme le programme qui tient les autres. Un serveur d'essai prend un port hors de 5173–5177, et s'arrête avec son entrée de `.claude/launch.json` quand l'essai est fini |
| **Docker et `npm run dev`** | ils publient les mêmes ports : le second lancé échoue, et `npm run dev` ne libère pas un port que tient Docker, il nomme le programme | `docker compose down` avant `npm run dev`, et l'inverse |
| **Base du conteneur** | le serveur sous Docker n'ouvre pas `sola.db` mais le volume `sola_donnees` : `npm run db:sql` ne voit pas ce qu'on y a écrit | `docker compose exec server node scripts/db-sql.mjs "…"` ; `down --volumes` l'efface, voir le garde-fou 2 |
| **Linux Rollup dans le lockfile** | `package-lock.json`, écrit sous Windows, n'a pas le binaire Linux de Rollup (npm/cli#4828) : `vite build` échoue dans l'image | Le `Dockerfile` l'installe à la version du lockfile, sans toucher au lockfile. Ne pas le « réparer » en le régénérant |

**Vérifier avant d'annoncer.** `npm run typecheck` pour le code ; pour une
modification visible, la mesurer dans le navigateur plutôt que supposer qu'elle
marche.

---

## Où chercher

### Démarrer

| Commande | Ce qu'elle fait | Port |
|---|---|---|
| `npm run dev` | les quatre services dans un terminal, journaux préfixés, Ctrl+C arrête tout ; libère d'abord un port qu'un ancien serveur Sola tient encore, finit par la liste des adresses — `scripts/dev.mjs` ; `npm run dev -- console server` pour un sous-ensemble | 5173–5177 |
| `npm run dev:borne` | écran 01 — la borne de cabine | 5173 |
| `npm run dev:console` | écrans 02 à 04 — la console médicale | 5174 |
| `npm run dev:server` | le serveur de bord (API) ; avec `BRACELET_TOKEN` ou `NUTRITION_TOKEN`, aussi le port réseau — bracelets en Wi-Fi, équipe nutrition | 5175, 5177 |
| `npm run dev:backoffice` | le backoffice | 5176 |
| `npm run db:reset` | recharge schéma + vues + jeu de démonstration | — |
| `npm run db:demo` | régénère seulement les données | — |
| `npm run db:repli` | fige le repli de la console depuis la base ; `-- --verifier` compare seulement | — |
| `npm run db:sql "…"` | interroge la base, en lecture seule | — |
| `npm run compte -- liste \| medecin \| admin \| mdp <email>` | les comptes, au terminal | — |
| `npm run typecheck` | tous les espaces de travail | — |
| `docker compose --env-file server/.env up --build` | les quatre services sous Docker, aux mêmes adresses ; leur base vit dans le volume `sola_donnees`, pas dans `sola.db` | 5173–5177 |

Espaces de travail npm : `web/*` et `server`. Fichier de base : `sola.db` à la
racine, réglé par `DB_FILE`.

### Les écrans

| Écran | Application | Point d'entrée |
|---|---|---|
| 01 · Borne de cabine | `web/borne` | `src/App.tsx` — détail plus bas |
| 02 · Santé de l'équipage | `web/console` | `src/pages/CrewPage.tsx` |
| 03 · Fiche résident | `web/console` | `src/pages/ResidentPage.tsx` |
| 04 · Registre | `web/console` | `src/pages/RegistrePage.tsx` |
| — · Backoffice | `web/backoffice` | `src/App.tsx`, pages dans `src/pages/` |

### La borne, fichier par fichier

| Ce que vous cherchez | Fichier |
|---|---|
| L'enchaînement des scènes, le clavier de secours | `src/App.tsx` |
| Les répliques, les cartes et les questions | `src/scenarios.ts` |
| Écoute, synthèse, mot d'éveil, filtre d'écho | `src/voix.ts` |
| La conversation libre : prompt de Sola, appel au modèle local (Ollama), réponses d'urgence, filtres de sortie, résumé clinique | `src/ia.ts` |
| Envoi du résumé au serveur de bord (via proxy `/bord`) | `src/remontee.ts` |
| Le client Web Bluetooth du bracelet | `src/bracelet.ts` |
| La file d'envoi des trames et son libellé dans la barre d'état | `src/transmission.ts` |
| Le relais `/ollama` vers Ollama, `/bord` pour le résumé, `/ingest/bracelet` pour les trames | `vite.config.ts` |
| **Le visage de Sola** — trois images, une par état | `src/components/SolaAvatar.tsx` |
| Le chat vectoriel d'origine, gardé en réserve | `src/components/SolaCat.tsx` |
| Les images en pixels (repos, écoute, parole) | `src/assets/` |
| Tout le style, y compris le recadrage des images | `src/styles/borne.css` |

### La console, fichier par fichier

| Ce que vous cherchez | Fichier |
|---|---|
| Les routes de l'application | `src/App.tsx` |
| **Les chaînes affichées sur les écrans 02 et 03** (sous-titres, références, unités, seuils) | `src/adapt.ts` — le seul endroit où elles s'écrivent, serveur allumé ou éteint |
| Les nombres, dates et durées à la française | `src/format.ts` |
| Le repli, serveur éteint : deux réponses figées | `src/repli.ts`, `src/data/crew.json`, `src/data/resident.json` — écrits par `npm run db:repli` |
| L'appel à l'API, le POST d'une note, le PATCH d'un signal | `src/api.ts` |
| Le mécanisme de repli et `rafraichir` | `src/useSource.ts` |
| La file « À traiter maintenant » de l'écran 02 | `src/components/FileTriage.tsx` |
| L'écran 02 qui se recharge seul quand un signal s'ouvre, se prend ou se clôt — empreinte relue toutes les cinq secondes, onglet visible | `src/veille.ts`, `GET /api/crew/empreinte` dans `server/src/routes/console.ts` |
| Le signal ouvert de la fiche : prendre, clore avec un motif | `src/components/SignalOuvert.tsx` |
| La carte « en direct » de la fiche — dernière lecture, courbe de dix minutes, sept cases toujours affichées, « donnée indisponible » ou « calibrage… » faute de valeur, une case chute qui cesse d'alerter une fois son signal clos — et sa ligne bracelet, relues toutes les dix secondes | `src/components/EnDirect.tsx` (`ETATS`, `lire`, `Chute`), `src/direct.ts` (`etatDirect`), `src/styles/direct.css` |
| Les tuiles SpO₂, variabilité, température et pas qui suivent la carte « en direct » tant que le bracelet envoie, et les pas d'une journée en cours jugés sur la veille | `src/adapt.ts` (`enDirect`, `enCours`, `suivreLeDirect`) |
| Les tuiles de constantes, la courbe et les barres | `src/components/TuileConstante.tsx`, `src/components/Courbe.tsx`, `src/components/Barres.tsx` |
| Les conversations remontées et les résumés de contexte | `src/components/Conversations.tsx` |
| Les colonnes, tris et filtres de l'écran 04 | `src/pages/RegistrePage.tsx` (descripteurs `Colonne<T>`) |
| Le chargement paginé de l'écran 04 | `src/registre.ts` |
| Le formulaire d'ajout d'une note | `src/components/AjoutNote.tsx` |
| Le retour d'un geste, en une ligne au bas de l'écran | `src/components/Avis.tsx` (`useAvis`) |
| Les onglets et sélecteurs segmentés, les pictogrammes | `src/components/Segments.tsx`, `src/components/Icone.tsx` |
| La mention « jeu de démonstration » | `src/components/MentionDemo.tsx` |
| La session, le formulaire de connexion, le mode démonstration | `src/session.tsx` |
| La carte de bilan sanguin | `src/components/BilanSanguin.tsx` |
| Les types partagés | `src/types.ts` |
| Les couleurs, rayons, ombres | `src/styles/tokens.css` |
| Tout le reste du style | `src/styles/app.css` |

### Le serveur

| Ce que vous cherchez | Fichier |
|---|---|
| Montage des routes, CORS, liste des routes sur `/`, le port réseau — bracelets en Wi-Fi, équipe nutrition | `src/index.ts` |
| Lecture de la console — écrans 02, 03, 04 | `src/routes/console.ts` |
| Les gestes de la console : note signée, prise et clôture d'un signal | `src/routes/console.ts` (`ajouterParticularite`, `PATCH /signaux/:id`) |
| Backoffice — écrans ↔ requêtes, fraîcheur des flux, tables brutes, comptes | `src/routes/admin.ts` |
| Ingestion depuis les bornes et les bracelets | `src/routes/ingest.ts` |
| **Le contrat d'une trame du bracelet**, et comment une minute de trames devient une ligne de `mesures`, puis la ligne du jour de `mesures_jour` | `src/validation.ts` (`trameSchema`), `src/routes/ingest.ts` (`resumerMinute`, `SQL_JOUR`) |
| La lecture seule d'un bracelet en Wi-Fi — température, pas, chute —, et ce qu'une réponse dit des valeurs écartées et d'une chute | `src/validation.ts` (`lectureSchema`), `src/routes/ingest.ts` (`recevoirWifi`, `recevoirLecture`, `accuse`) |
| Une chute qui ouvre un signal critique, envoyée par la borne ou annoncée par le croquis Wi-Fi — seul le passage de `fall` à `true` compte | `src/routes/ingest.ts` (`enregistrerEvenement`, `chutesSignalees`) |
| Une journée « en cours » — des minutes du bracelet aujourd'hui — et la veille qui juge ses pas | `src/routes/direct.ts` (`jour`), `src/routes/console.ts` (`jour_en_cours`, `pas_veille`) |
| Les lectures des dix dernières minutes, avec les champs que portait chaque trame, la dernière minute, le jour et le signal de la dernière chute — la carte « en direct » de l'écran 03 | `src/routes/direct.ts` ; les lectures, gardées en mémoire, dans `src/routes/ingest.ts` (`retenir`, `envoyesDe`) |
| **Les moyennes des bilans sanguins pour l'équipe nutrition** : quels marqueurs et pourquoi, le cycle de 14 jours, la règle des petits effectifs | `src/routes/partenaires.ts` |
| Connexion, déconnexion, freinage après échecs | `src/routes/auth.ts` |
| Hachage argon2id des mots de passe | `src/mdp.ts` |
| Ouverture, lecture et purge des sessions, cookie | `src/sessions.ts` |
| Jetons porteurs des bornes, des bracelets et de l'équipe nutrition, exigences de rôle | `src/auth.ts` |
| Ouverture SQLite, `requete`, `ecrire`, `transaction` | `src/db.ts` |
| Variables d'environnement | `src/config.ts`, modèle dans `.env.example` |
| Schémas de validation | `src/validation.ts` |

### La base

| Ce que vous cherchez | Fichier |
|---|---|
| Les 17 tables, contraintes et index | `db/serveur/01-schema.sql` |
| Les vues (`v_depistage_jour`, `v_depistage_serie`…) | `db/serveur/02-vues.sql` |
| Les résidents et notes de départ | `db/serveur/03-seed.sql` |
| La base locale de la borne (verbatim) | `db/borne/01-schema.sql` |
| Le modèle MySQL d'origine, gardé en référence | `db/reference-mysql.sql` |
| Comment tout ça s'articule | `db/README.md` |
| **Le générateur du jeu de démonstration (37 200 évaluations, 281 signaux)** | `scripts/db-demo.mjs` |
| Chargement des fichiers SQL | `scripts/db-load.mjs` |
| Créer un compte, changer un mot de passe | `scripts/db-compte.mjs`, `scripts/hachage.mjs` |
| Agrégats quotidiens — le serveur tient celui du jour à chaque trame, ce script recalcule un jour entier | `scripts/db-rollup.mjs`, jumeau de `SQL_JOUR` dans `server/src/routes/ingest.ts` |
| Figer le repli de la console | `scripts/db-repli.mjs` |
| Interroger la base au terminal | `scripts/db-sql.mjs` |

### Docker

| Ce que vous cherchez | Fichier |
|---|---|
| Les quatre services, leurs ports, ce que chacun reçoit de `server/.env` | `compose.yaml` |
| Les images, une cible par service, et le binaire Linux de Rollup | `Dockerfile` |
| La base du conteneur, créée au premier démarrage, jamais réécrite | `docker/serveur.mjs` |
| La console et le backoffice en fichiers statiques, routes comprises | `docker/nginx.conf` |
| Ce qui n'entre dans aucune image — `.env`, bases, `node_modules` | `.dockerignore` |
| L'adresse d'écoute du serveur (`ECOUTE`), posée par `compose.yaml` seulement | `server/src/config.ts` |
| Le relais de la borne en conteneur (`BORNE_CONTENEUR`, `OLLAMA_URL`) | `web/borne/vite.config.ts` |

### Le matériel et la documentation

| Ce que vous cherchez | Fichier |
|---|---|
| Firmware du bracelet ESP32 | `firmware/bracelet/src/main.cpp` |
| Variante I²C | `firmware/bracelet-i2c/src/main.cpp` |
| Vue d'ensemble, démarrage, limites | `README.md` |
| Du template SQL au schéma actuel | `docs/modele-donnees.html` |
| Les tables `medecins` / `admins` à venir | `docs/comptes-a-ajouter.html` |
| Configuration des serveurs de développement | `.claude/launch.json` |
