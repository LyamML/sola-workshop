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
de santé pour les 1 240 résidents du vaisseau générationnel *Méridien*, en route
depuis 4 128 jours. **Quatre écrans répartis sur trois applications web
distinctes**, un serveur de bord, une base SQLite de 17 tables, un bracelet
ESP32.

Le projet est **noté**. Les livrables doivent être carrés, clairs et concis.

---

## Les gardes-fous

Ces neuf points ne se négocient pas. Si une demande les contredit, le dire et
proposer autre chose plutôt que de les contourner.

### 1. Les secrets ne sortent jamais du disque

`server/.env` contient `BORNE_TOKEN`. On ne le recopie **nulle part** : ni dans
un fichier, ni dans un message, ni dans un commentaire, ni dans une URL, ni dans
un commit. Même règle pour un mot de passe de compte, y compris celui d'un
compte de démonstration créé à la main. `.env` et `*.db` sont dans `.gitignore` —
ne les en sortez pas.

**Le dépôt est public.** Tout ce qui est commité est lisible par n'importe qui.

Et un agent qui pilote un navigateur **ne tape pas un jeton ni un mot de passe
dans un champ de formulaire**. Pour tester une route authentifiée, on passe par
`curl`.

### 2. La base de démonstration s'efface en une commande

`npm run db:reset` détruit tout le contenu de `sola.db` et le régénère.
**Demander avant de la lancer** : quelqu'un a peut-être une saisie de test en
cours, et la veille d'une soutenance ce n'est pas le moment.

`npm run db:sql` ouvre la base en **lecture seule**, volontairement. Pour écrire,
il y a le backoffice, qui valide ce qu'il écrit. Pas d'`UPDATE` ni de `DELETE`
tapé à la main.

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
machine. La borne de cabine reste accessible à tous.

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

**Les neuf limites ouvertes aujourd'hui :** aucune purge des mesures n'est
implémentée, l'écran 01 ne lit pas la base, sa conversation libre exige Ollama
sur la machine, le résumé clinique à la sortie d'« Échange » exige Ollama et le
serveur de bord (sinon la barre d'état le dit), Sola ne déclenche aucune
action et, hors urgences, actions prétendues et noms de maladie filtrés dans
le code, ses règles ne sont que des consignes données au modèle, la détection
d'urgence ne repose que sur des mots-clés,
les bilans sanguins du jeu de démonstration sont simulés (`source = 'simule'`,
et la fiche le dit), la reconnaissance vocale de la borne n'existe que dans
les navigateurs à moteur Chromium — ailleurs elle bascule au clavier et le dit
dans sa barre d'état —, et Sola ne reconnaît sa propre voix que par le texte :
un mot qu'elle vient de dire ne vaut pas réponse dans les deux secondes qui
suivent.

---

## Les conventions d'écriture

**Français partout** — identifiants, commentaires, libellés d'interface. Les
types de `web/console/src/types.ts` et les props des composants les plus anciens
sont restés en anglais : c'est de l'héritage, on ne les renomme pas en passant,
mais le code neuf est en français (`Colonne`, `cle`, `titre`, `rendu`, `fige`).

**Les commentaires disent *pourquoi*, pas *quoi*.** Le code dit déjà quoi. Un
commentaire qui paraphrase la ligne suivante est du bruit ; un commentaire qui
explique un arbitrage se garde.

**Tout écran de la console s'affiche rempli, serveur éteint.** C'est le rôle de
`useSource` : le jeu de démonstration est la valeur de départ, l'API la remplace
quand elle répond, et l'en-tête dit lequel des deux est affiché. Une console
médicale qui montre une page blanche parce qu'un service est tombé est pire
qu'inutile. Seul l'écran 04 fait exception — il lit forcément la base, et il le
dit.

**Deux fichiers pour une même chaîne.** Ce qui s'affiche sur les écrans 02 et 03
existe en double : dans `adapt.ts` (construit depuis l'API, c'est ce qu'on voit
quand le serveur tourne) et dans `data/` (le repli statique). Modifier l'un sans
l'autre crée une incohérence qui n'apparaît que le jour où le serveur ne démarre
pas.

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
| **Routes de la console** | `/residents/:id`, pas `/resident/:id` | Voir `web/console/src/App.tsx` |

**Vérifier avant d'annoncer.** `npm run typecheck` pour le code ; pour une
modification visible, la mesurer dans le navigateur plutôt que supposer qu'elle
marche.

---

## Où chercher

### Démarrer

| Commande | Ce qu'elle fait | Port |
|---|---|---|
| `npm run dev:borne` | écran 01 — la borne de cabine | 5173 |
| `npm run dev:console` | écrans 02 à 04 — la console médicale | 5174 |
| `npm run dev:server` | le serveur de bord (API) | 5175 |
| `npm run dev:backoffice` | le backoffice | 5176 |
| `npm run db:reset` | recharge schéma + vues + jeu de démonstration | — |
| `npm run db:demo` | régénère seulement les données | — |
| `npm run db:sql "…"` | interroge la base, en lecture seule | — |
| `npm run compte -- liste \| medecin \| admin \| mdp <email>` | les comptes, au terminal | — |
| `npm run typecheck` | tous les espaces de travail | — |

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
| Le relais `/ollama` vers `127.0.0.1:11434` et `/bord` vers le serveur | `vite.config.ts` |
| **Le visage de Sola** — trois images, une par état | `src/components/SolaAvatar.tsx` |
| Le chat vectoriel d'origine, gardé en réserve | `src/components/SolaCat.tsx` |
| Les images en pixels (repos, écoute, parole) | `src/assets/` |
| Tout le style, y compris le recadrage des images | `src/styles/borne.css` |

### La console, fichier par fichier

| Ce que vous cherchez | Fichier |
|---|---|
| Les routes de l'application | `src/App.tsx` |
| **Les chaînes affichées sur les écrans 02 et 03** (sous-titres, références, unités) | `src/adapt.ts` — construit depuis l'API, **c'est ce qui s'affiche** |
| Les mêmes chaînes, version repli | `src/data/crew.ts`, `src/data/resident.ts` |
| L'appel à l'API et le POST d'une note | `src/api.ts` |
| Le mécanisme de repli et `rafraichir` | `src/useSource.ts` |
| Les colonnes, tris et filtres de l'écran 04 | `src/pages/RegistrePage.tsx` (descripteurs `Colonne<T>`) |
| Le chargement paginé de l'écran 04 | `src/registre.ts` |
| Le formulaire d'ajout d'une note | `src/components/AjoutNote.tsx` |
| Les tuiles de constantes et leur courbe de fond | `src/components/VitalTile.tsx`, `src/components/Sparkline.tsx` |
| La session, le formulaire de connexion, le mode démonstration | `src/session.tsx` |
| La carte de bilan sanguin | `src/components/BilanSanguin.tsx` |
| Les types partagés | `src/types.ts` |
| Les couleurs, rayons, ombres | `src/styles/tokens.css` |
| Tout le reste du style | `src/styles/app.css` |

### Le serveur

| Ce que vous cherchez | Fichier |
|---|---|
| Montage des routes, CORS, liste des routes sur `/` | `src/index.ts` |
| Lecture de la console — écrans 02, 03, 04 | `src/routes/console.ts` |
| Écriture d'une note (partagée avec le backoffice) | `src/routes/console.ts`, `ajouterParticularite` |
| Backoffice — tables, correction, signaux | `src/routes/admin.ts` |
| Ingestion depuis les bornes et les bracelets | `src/routes/ingest.ts` |
| Connexion, déconnexion, freinage après échecs | `src/routes/auth.ts` |
| Hachage argon2id des mots de passe | `src/mdp.ts` |
| Ouverture, lecture et purge des sessions, cookie | `src/sessions.ts` |
| Jeton porteur des bornes, exigences de rôle | `src/auth.ts` |
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
| Agrégats quotidiens | `scripts/db-rollup.mjs` |
| Interroger la base au terminal | `scripts/db-sql.mjs` |

### Le matériel et la documentation

| Ce que vous cherchez | Fichier |
|---|---|
| Firmware du bracelet ESP32 | `firmware/bracelet/src/main.cpp` |
| Variante I²C | `firmware/bracelet-i2c/src/main.cpp` |
| Vue d'ensemble, démarrage, limites | `README.md` |
| Du template SQL au schéma actuel | `docs/modele-donnees.html` |
| Les tables `medecins` / `admins` à venir | `docs/comptes-a-ajouter.html` |
| Configuration des serveurs de développement | `.claude/launch.json` |
