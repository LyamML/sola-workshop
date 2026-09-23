-- =============================================================================
--  Sola — vues de l'ecran 02 (sante de l'equipage)
--
--  Chaque vue correspond a un bloc de l'interface. Le serveur ne fait que les
--  interroger : la logique d'agregat reste en SQL, la ou les donnees sont.
-- =============================================================================

DROP VIEW IF EXISTS v_alertes_physio;
DROP VIEW IF EXISTS v_motifs_30j;
DROP VIEW IF EXISTS v_conversations_30j;
DROP VIEW IF EXISTS v_jour_courant;
DROP VIEW IF EXISTS v_bienetre_jour;
DROP VIEW IF EXISTS v_depistage_jour;
DROP VIEW IF EXISTS v_depistage_serie;
DROP VIEW IF EXISTS v_signaux_module;

-- Le jour de vol que la console tient pour « aujourd'hui » : le dernier jour
-- ou au moins la moitie de l'equipage a sa ligne de constantes.
--
-- Pas date('now') : la base de demonstration est generee un jour donne et
-- doit se lire pareil le lendemain. Avec l'horloge du poste, l'ecart de
-- l'indice changeait d'un jour a l'autre sans qu'une donnee bouge, et la vue
-- physio tombait a 0 % des le surlendemain.
-- Pas MAX(jour) seul : un db:rollup lance pour un seul bracelet ouvrirait un
-- jour ou un resident sur 1 240 a des mesures, et toutes les parts
-- d'equipage s'effondreraient.
CREATE VIEW v_jour_courant AS
SELECT jour, MAX(jour_vol) AS jour_vol
  FROM mesures_jour
 GROUP BY jour
HAVING 2 * COUNT(*) >= (SELECT COUNT(*) FROM residents)
 ORDER BY jour DESC
 LIMIT 1;

-- Les quatre indicateurs de tete : part de l'equipage au-dessus du seuil de
-- depistage, sur la derniere evaluation de chacun.
CREATE VIEW v_depistage_jour AS
WITH derniere AS (
  SELECT
    resident_id, evalue_le, score_moral, phq9, gad7, isi,
    ROW_NUMBER() OVER (PARTITION BY resident_id ORDER BY evalue_le DESC) AS rang
  FROM etat_mental
)
SELECT
  COUNT(*)                                        AS residents,
  ROUND(AVG(score_moral), 1)                      AS indice_bienetre,
  ROUND(100.0 * AVG(phq9 >= 10), 1)               AS pct_phq9,
  ROUND(100.0 * AVG(gad7 >= 10), 1)               AS pct_gad7,
  ROUND(100.0 * AVG(isi  >= 15), 1)               AS pct_isi,
  SUM(phq9 >= 10)                                 AS n_phq9,
  SUM(gad7 >= 10)                                 AS n_gad7,
  SUM(isi  >= 15)                                 AS n_isi
FROM derniere
WHERE rang = 1;

-- Meme chose, mais date par date : la courbe de tendance de l'ecran 02, pour
-- chacun des quatre indicateurs et sur les trois periodes. On ne reprend pas la
-- derniere evaluation de chacun ici — on prend les evaluations DE CE JOUR,
-- sinon chaque point du passe serait recalcule avec les scores d'aujourd'hui
-- et la courbe serait plate par construction.
CREATE VIEW v_depistage_serie AS
SELECT
  evalue_le                             AS jour,
  jour_vol,
  COUNT(*)                              AS residents,
  ROUND(AVG(score_moral), 1)            AS indice,
  ROUND(100.0 * AVG(phq9 >= 10), 1)     AS pct_phq9,
  ROUND(100.0 * AVG(gad7 >= 10), 1)     AS pct_gad7,
  ROUND(100.0 * AVG(isi  >= 15), 1)     AS pct_isi
FROM etat_mental
WHERE score_moral IS NOT NULL
GROUP BY evalue_le, jour_vol;

-- Signaux ouverts par module d'habitation — le graphique en barres.
CREATE VIEW v_signaux_module AS
SELECT
  SUBSTR(r.cabine, 1, 1)  AS module,
  COUNT(*)                AS signaux,
  ROUND(
    100.0 * COUNT(*) / (
      SELECT COUNT(*) FROM residents r2
       WHERE SUBSTR(r2.cabine, 1, 1) = SUBSTR(r.cabine, 1, 1)
    ), 1)                 AS pct_residents
FROM signaux s
JOIN residents r ON r.id = s.resident_id
WHERE s.statut <> 'clos'
GROUP BY SUBSTR(r.cabine, 1, 1);

-- Motifs de conversation les plus frequents sur les 30 jours qui finissent
-- au jour courant, celui-ci compris — barres de droite. Une conversation peut
-- porter deux motifs : la somme des barres depasse le nombre d'echanges.
--
-- Les bornes en sous-requetes, pas en jointure sur v_jour_courant : jointe,
-- SQLite la recalculait pour chaque motif de chaque echange, trois secondes
-- pour six barres, et la console retombait sur son repli faute de reponse.
-- Une sous-requete sans correlation ne se calcule qu'une fois.
CREATE VIEW v_motifs_30j AS
SELECT
  t.tag     AS motif,
  COUNT(*)  AS conversations
FROM conversations c
JOIN conversation_tags t ON t.conversation_id = c.id
WHERE c.debut_at >= (SELECT date(jour, '-29 days') FROM v_jour_courant)
  AND c.debut_at <  (SELECT date(jour, '+1 day')   FROM v_jour_courant)
GROUP BY t.tag;

-- Le nombre d'echanges de la meme fenetre, que la somme des barres ne donne
-- pas. Une vue a part plutot qu'un calcul dans la route : la console et le
-- backoffice affichent ce chiffre, et doivent afficher le meme.
CREATE VIEW v_conversations_30j AS
SELECT COUNT(*) AS conversations
FROM conversations c
WHERE c.debut_at >= (SELECT date(jour, '-29 days') FROM v_jour_courant)
  AND c.debut_at <  (SELECT date(jour, '+1 day')   FROM v_jour_courant);

-- Alertes physiologiques : part de l'equipage hors seuil au jour courant —
-- la nuit qui s'est terminee ce matin-la, et les constantes du jour.
-- Chaque ligne est une barre de l'ecran 02, dans le meme ordre. Les seuils
-- sont fixes, les memes pour tout le monde : le libelle le dit, plutot que
-- de promettre un ecart a la base personnelle que la vue ne calcule pas.
CREATE VIEW v_alertes_physio AS
WITH base AS (
  SELECT COUNT(*) AS n FROM residents
),
jour AS (
  SELECT m.resident_id, m.rmssd_ms, m.spo2_pct, m.fc_repos_bpm, m.pas,
         n.sommeil_min
    FROM mesures_jour m
    JOIN v_jour_courant j ON j.jour = m.jour
    LEFT JOIN nuits n
      ON n.resident_id = m.resident_id AND n.nuit_du = m.jour
),
chutes AS (
  SELECT COUNT(DISTINCT e.resident_id) AS n
    FROM evenements e
    JOIN v_jour_courant j
      ON e.survenu_at >= j.jour AND e.survenu_at < date(j.jour, '+1 day')
   WHERE e.type = 'chute'
)
SELECT 1 AS ordre, 'RMSSD < 30 ms' AS libelle,
       ROUND(100.0 * COALESCE(SUM(rmssd_ms < 30), 0) / (SELECT n FROM base), 1) AS pct
  FROM jour
UNION ALL
SELECT 2, 'Sommeil < 6 h',
       ROUND(100.0 * COALESCE(SUM(sommeil_min < 360), 0) / (SELECT n FROM base), 1)
  FROM jour
UNION ALL
SELECT 3, 'Activité < 4 000 pas',
       ROUND(100.0 * COALESCE(SUM(pas < 4000), 0) / (SELECT n FROM base), 1)
  FROM jour
UNION ALL
SELECT 4, 'FC de repos élevée',
       ROUND(100.0 * COALESCE(SUM(fc_repos_bpm > 75), 0) / (SELECT n FROM base), 1)
  FROM jour
UNION ALL
SELECT 5, 'SpO₂ < 95 %',
       ROUND(100.0 * COALESCE(SUM(spo2_pct < 95), 0) / (SELECT n FROM base), 1)
  FROM jour
UNION ALL
SELECT 6, 'Chute détectée',
       ROUND(100.0 * (SELECT n FROM chutes) / (SELECT n FROM base), 1);
