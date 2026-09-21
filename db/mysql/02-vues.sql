-- =============================================================================
--  Sola — vues de l'ecran 02 (sante de l'equipage)
--
--  Chaque vue correspond a un bloc de l'interface. Le serveur ne fait que les
--  interroger : la logique d'agregat reste en SQL, la ou les donnees sont.
-- =============================================================================

USE sola;

-- Indice de bien-etre moyen par jour — la grande courbe de l'ecran 02.
CREATE OR REPLACE VIEW v_bienetre_jour AS
SELECT
  evalue_le                          AS jour,
  jour_vol,
  ROUND(AVG(score_moral), 1)         AS indice,
  COUNT(*)                           AS residents_evalues
FROM etat_mental
WHERE score_moral IS NOT NULL
GROUP BY evalue_le, jour_vol;

-- Les quatre indicateurs de tete : part de l'equipage au-dessus du seuil de
-- depistage, sur la derniere evaluation de chacun.
CREATE OR REPLACE VIEW v_depistage_jour AS
WITH derniere AS (
  SELECT
    resident_id,
    evalue_le,
    score_moral, phq9, gad7, isi,
    ROW_NUMBER() OVER (PARTITION BY resident_id ORDER BY evalue_le DESC) AS rang
  FROM etat_mental
)
SELECT
  COUNT(*)                                                    AS residents,
  ROUND(AVG(score_moral), 1)                                  AS indice_bienetre,
  ROUND(100 * AVG(phq9 >= 10), 1)                             AS pct_phq9,
  ROUND(100 * AVG(gad7 >= 10), 1)                             AS pct_gad7,
  ROUND(100 * AVG(isi  >= 15), 1)                             AS pct_isi,
  SUM(phq9 >= 10)                                             AS n_phq9,
  SUM(gad7 >= 10)                                             AS n_gad7,
  SUM(isi  >= 15)                                             AS n_isi
FROM derniere
WHERE rang = 1;

-- Signaux ouverts par module d'habitation — le graphique en barres.
CREATE OR REPLACE VIEW v_signaux_module AS
SELECT
  LEFT(r.cabine, 1)                               AS module,
  COUNT(*)                                        AS signaux,
  ROUND(100 * COUNT(*) / NULLIF(
    (SELECT COUNT(*) FROM residents r2
     WHERE LEFT(r2.cabine, 1) = LEFT(r.cabine, 1)), 0), 1)  AS pct_residents
FROM signaux s
JOIN residents r ON r.id = s.resident_id
WHERE s.statut <> 'clos'
GROUP BY LEFT(r.cabine, 1);

-- Motifs de conversation les plus frequents sur 30 jours — barres de droite.
CREATE OR REPLACE VIEW v_motifs_30j AS
SELECT
  t.tag                AS motif,
  COUNT(*)             AS conversations
FROM conversation_tags t
JOIN conversations c ON c.id = t.conversation_id
WHERE c.debut_at >= NOW() - INTERVAL 30 DAY
GROUP BY t.tag;

-- Alertes physiologiques : part de l'equipage concernee hier.
-- Chaque ligne est une barre de l'ecran 02, dans le meme ordre.
CREATE OR REPLACE VIEW v_alertes_physio AS
WITH base AS (
  SELECT COUNT(*) AS n FROM residents
),
hier AS (
  SELECT m.resident_id, m.rmssd_ms, m.spo2_pct, m.fc_repos_bpm, m.pas, n.sommeil_min
  FROM mesures_jour m
  LEFT JOIN nuits n
    ON n.resident_id = m.resident_id AND n.nuit_du = m.jour
  WHERE m.jour = CURRENT_DATE - INTERVAL 1 DAY
)
SELECT 'HRV sous la base personnelle' AS libelle,
       ROUND(100 * SUM(rmssd_ms < 30)     / (SELECT n FROM base), 1) AS pct FROM hier
UNION ALL
SELECT 'Sommeil < 6 h',
       ROUND(100 * SUM(sommeil_min < 360) / (SELECT n FROM base), 1) FROM hier
UNION ALL
SELECT 'Activite < 4 000 pas',
       ROUND(100 * SUM(pas < 4000)        / (SELECT n FROM base), 1) FROM hier
UNION ALL
SELECT 'FC de repos elevee',
       ROUND(100 * SUM(fc_repos_bpm > 75) / (SELECT n FROM base), 1) FROM hier
UNION ALL
SELECT 'SpO2 < 95 %',
       ROUND(100 * SUM(spo2_pct < 95)     / (SELECT n FROM base), 1) FROM hier
UNION ALL
SELECT 'Chute detectee',
       ROUND(100 * (SELECT COUNT(DISTINCT resident_id) FROM evenements
                    WHERE type = 'chute'
                      AND survenu_at >= CURRENT_DATE - INTERVAL 1 DAY)
             / (SELECT n FROM base), 1) FROM hier;
