# Les deux bases de Sola

Le projet a **deux bases de données, et c'est le cœur de l'argument**. Si un jour elles fusionnent, la promesse faite au résident s'effondre — ce fichier explique pourquoi, pour que personne ne les réunisse par commodité.

| | `db/borne` (SQLite) | `db/mysql` (MySQL 8) |
|---|---|---|
| **Où** | sur la borne, dans la cabine | sur le serveur de bord |
| **Qui lit** | Sola, pour se souvenir de la semaine | le médecin |
| **Contient** | le verbatim des conversations | des résumés, des scores, des constantes |
| **Répliquée** | jamais | sauvegardée à bord |
| **Purge** | verbatim effacé à 30 jours | mesures brutes à 90 jours |

La table `tours` de la base cabine est le seul endroit du vaisseau où les paroles du résident existent sous forme de texte. Elle n'a aucun équivalent côté serveur, et la table `conversations` de MySQL n'a **pas** de colonne de texte intégral. Le service d'ingestion refuse toute charge utile qui en contiendrait une, avec un code `422` et un message qui explique pourquoi : `server/src/validation.ts`, fonction `refuseVerbatim`.

## Charger la base du serveur

```bash
cp server/.env.example server/.env
```

Renseignez `DB_USER` / `DB_PASSWORD`, puis :

```bash
npm run db:load
```

Le script joue les quatre fichiers dans l'ordre. Équivalent en ligne de commande, si vous avez le client MySQL :

```bash
mysql -u root -p < db/mysql/01-schema.sql
```

| Fichier | Rôle |
|---|---|
| `01-schema.sql` | les 12 tables |
| `02-vues.sql` | les agrégats de l'écran 02, une vue par bloc |
| `03-rollup.sql` | `sola_rollup_jour()` — agrège les mesures à la minute en une ligne par jour |
| `04-seed.sql` | jeu de démonstration, **identique aux chiffres affichés aujourd'hui** |

Base de la cabine :

```bash
sqlite3 borne.db < db/borne/01-schema.sql
```

## Les douze tables

**Identité** — `residents`, `bracelets`, `particularites` (allergies, contre-indications, antécédents : une seule liste, parce que c'est une seule liste à l'écran), `suivis` (traitements, rendez-vous, personne de confiance).

**Constantes** — `mesures` reçoit une ligne par minute et par résident ; à 1 240 résidents cela fait 1,8 million de lignes par jour. La console ne la lit jamais : elle lit `mesures_jour`, l'agrégat quotidien produit par `sola_rollup_jour()`. C'est ce qui permet aux huit tuiles et à leurs graphiques 14 jours de sortir en une seule requête.

**Sommeil** — `nuits`, une ligne par nuit. `source = 'estime'` rappelle que la durée vient de la méthode immobilité + baisse de FC, jamais d'une mesure.

**État mental** — `etat_mental` porte des **scores** (PHQ-9, GAD-7, ISI, indice de bien-être), pas des paroles. C'est pour cela qu'ils peuvent vivre ici sans trahir personne. La colonne `source` distingue un score issu d'un questionnaire rempli par le résident d'un score déduit de la conversation par le modèle : les deux n'ont pas la même valeur clinique et on ne les moyenne pas ensemble.

**Conversations** — `conversations` + `conversation_tags`. Résumé, durée, sévérité, nombre d'actions proposées et acceptées, et `resident_notifie_at` : on horodate la notification envoyée au résident, parce qu'une promesse non tracée n'est pas une promesse.

**Triage** — `signaux` (la file du médecin) et `evenements` (chutes et secousses, horodatées à la seconde).

## Deux règles de modélisation qu'on s'est données

**Une valeur mesurée est un nombre, et son unité est dans le nom de la colonne.** `fc_bpm DECIMAL(4,1)`, pas `rythmeCardiaque VARCHAR(255)`. Un `'normal'` en base ne permet ni de tracer une courbe, ni de calculer une moyenne, ni de comparer à la base personnelle du résident — et il oblige à décider de ce qui est normal au moment de l'écriture, c'est-à-dire trop tôt.

**Toute donnée affichée au médecin porte sa source.** Les colonnes `source` (`mesure` / `simule` / `estime`) existent parce que le prototype affiche huit constantes dont deux seulement sont mesurées. La base doit savoir laquelle est laquelle, sinon l'interface ne peut pas le dire honnêtement.
