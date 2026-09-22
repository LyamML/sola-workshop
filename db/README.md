# Les deux bases de Sola

Le projet a **deux bases de données, et c'est le cœur de l'argument**. Si un jour elles fusionnent, la promesse faite au résident s'effondre — ce fichier explique pourquoi, pour que personne ne les réunisse par commodité.

| | `db/borne` | `db/serveur` |
|---|---|---|
| **Où** | sur la borne, dans la cabine | sur le serveur de bord |
| **Qui lit** | Sola, pour se souvenir de la semaine | le médecin |
| **Contient** | le verbatim des conversations | des résumés, des scores, des constantes |
| **Répliquée** | jamais | sauvegardée à bord |
| **Purge** | verbatim effacé à 30 jours (trigger) | **aucune** — prévue à 90 jours pour `mesures`, pas encore implémentée |

Les deux bases sont aujourd'hui des fichiers SQLite, et c'est justement pourquoi il faut l'écrire : **rien dans la technique ne les empêche de fusionner**. Ce qui les sépare est une décision, tenue par le schéma et par le service d'ingestion, pas par une incompatibilité de moteur.

La table `tours` de la base cabine est le seul endroit du vaisseau où les paroles du résident existent sous forme de texte. Elle n'a aucun équivalent côté serveur, et la table `conversations` du serveur n'a **pas** de colonne de texte intégral. Le service d'ingestion refuse toute charge utile qui en contiendrait une, avec un code `422` et un message qui explique pourquoi : `server/src/validation.ts`, fonction `refuseVerbatim`.

## Charger la base du serveur

```bash
cp server/.env.example server/.env
```

```bash
npm run db:reset
```

Le fichier produit est `sola.db`, à la racine du dépôt. Il est recréé de zéro à
chaque chargement : la base est un artefact, jamais une source — tout ce qu'elle
contient vient de `db/serveur/` et de `scripts/db-demo.mjs`, tous deux versionnés.

| Fichier | Rôle |
|---|---|
| `serveur/01-schema.sql` | les 12 tables, en `STRICT` |
| `serveur/02-vues.sql` | les agrégats des écrans, une vue par bloc |
| `serveur/03-seed.sql` | les 13 résidents scriptés des maquettes |
| `scripts/db-demo.mjs` | les 1 227 autres, et environ 79 000 lignes de données |
| `scripts/db-rollup.mjs` | agrège les mesures à la minute en une ligne par jour |

`db:load` s'arrête aux fichiers SQL ; `db:demo` ajoute la population ; `db:reset`
enchaîne les deux. Le générateur refuse de s'exécuter sur une base déjà peuplée
plutôt que de doubler les lignes en silence.

Base de la cabine :

```bash
sqlite3 borne.db < db/borne/01-schema.sql
```

`db/reference-mysql.sql` conserve le schéma MySQL d'origine. Il ne sert plus à
rien d'autre qu'à montrer la conversion : c'est le même modèle, dans l'autre
dialecte.

## Regarder dans la base

Quatre chemins, du plus rapide au plus complet.

**En ligne de commande**, sans rien installer — Node 24 embarque SQLite :

```bash
npm run db:sql
```

affiche les 12 tables, les 6 vues et le nombre de lignes de chacune. Avec une requête :

```bash
npm run db:sql "SELECT * FROM v_depistage_jour"
```

La base s'ouvre en **lecture seule** : une faute de frappe dans un `UPDATE` tapé
à la main ne peut pas abîmer le jeu de démonstration la veille d'une soutenance.

**Depuis le backoffice** — <http://localhost:5176>, onglet *Tables* pour les
lignes brutes, onglet *Écrans et sources* pour voir quelle requête alimente
quel bloc. C'est le seul chemin qui écrit, et il valide ce qu'il écrit.

**Depuis l'API**, ce que la console lit vraiment :

```bash
curl http://localhost:5175/api/crew
```

**Avec une interface graphique** — *DB Browser for SQLite* ouvre `sola.db`
directement. Attention si vous copiez le fichier ailleurs : SQLite est en mode
WAL, les écritures récentes vivent dans `sola.db-wal`. Copier `sola.db` seul
donne un état périmé ; il faut les trois fichiers, ou fermer le serveur avant.

### Le rollup, et pourquoi il ne tient pas dans une vue

`mesures` reçoit une ligne par minute et par résident. `mesures_jour` en garde
une par jour — mais la ligne du jour n'est pas une moyenne de la journée. La FC
de repos, par exemple, est la moyenne du **décile le plus bas** des minutes
valides : la moyenne d'une journée entière mesure surtout l'activité de la
personne, pas son cœur au repos.

```sql
NTILE(10) OVER (PARTITION BY resident_id ORDER BY fc_bpm)
```

Ce calcul est fait une fois par nuit par `db:rollup`, et le résultat est écrit.
Le refaire à chaque affichage coûterait 1,8 million de lignes par requête, pour
un résultat qui ne change plus.

## Les douze tables

**Identité** — `residents`, `bracelets`, `particularites` (allergies, contre-indications, antécédents : une seule liste, parce que c'est une seule liste à l'écran), `suivis` (traitements, rendez-vous, personne de confiance).

**Constantes** — `mesures` reçoit une ligne par minute et par résident ; à 1 240 résidents cela fait 1,8 million de lignes par jour. La console ne la lit jamais : elle lit `mesures_jour`, l'agrégat quotidien produit par `npm run db:rollup`. C'est ce qui permet aux huit tuiles et à leurs graphiques 14 jours de sortir en une seule requête.

**Sommeil** — `nuits`, une ligne par nuit. `source = 'estime'` rappelle que la durée vient de la méthode immobilité + baisse de FC, jamais d'une mesure.

**État mental** — `etat_mental` porte des **scores** (PHQ-9, GAD-7, ISI, indice de bien-être), pas des paroles. C'est pour cela qu'ils peuvent vivre ici sans trahir personne. La colonne `source` distingue un score issu d'un questionnaire rempli par le résident d'un score déduit de la conversation par le modèle : les deux n'ont pas la même valeur clinique et on ne les moyenne pas ensemble.

**Conversations** — `conversations` + `conversation_tags`. Résumé, durée, sévérité, nombre d'actions proposées et acceptées, et `resident_notifie_at` : on horodate la notification envoyée au résident, parce qu'une promesse non tracée n'est pas une promesse.

**Triage** — `signaux` (la file du médecin) et `evenements` (chutes et secousses, horodatées à la seconde).

## Deux règles de modélisation qu'on s'est données

**Une valeur mesurée est un nombre, et son unité est dans le nom de la colonne.** `fc_bpm REAL`, pas `rythmeCardiaque TEXT`. Un `'normal'` en base ne permet ni de tracer une courbe, ni de calculer une moyenne, ni de comparer à la base personnelle du résident — et il oblige à décider de ce qui est normal au moment de l'écriture, c'est-à-dire trop tôt.

**Toute donnée affichée au médecin porte sa source.** Les colonnes `source` (`mesure` / `simule` / `estime`) existent parce que le prototype affiche huit constantes dont deux seulement sont mesurées. La base doit savoir laquelle est laquelle, sinon l'interface ne peut pas le dire honnêtement.
