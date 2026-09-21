-- =============================================================================
--  Sola — agregation quotidienne
--
--  `mesures` recoit une ligne par minute et par resident. La console ne lit
--  jamais cette table : elle lit `mesures_jour`, remplie une fois par jour par
--  la procedure ci-dessous (cron a 00:20, heure de bord).
--
--    CALL sola_rollup_jour(CURRENT_DATE - INTERVAL 1 DAY, 4127);
-- =============================================================================

USE sola;

DROP PROCEDURE IF EXISTS sola_rollup_jour;
DROP PROCEDURE IF EXISTS sola_purge_mesures;

DELIMITER //

CREATE PROCEDURE sola_rollup_jour(IN p_jour DATE, IN p_jour_vol INT UNSIGNED)
BEGIN
  INSERT INTO mesures_jour (
    resident_id, jour, jour_vol,
    fc_repos_bpm, fc_moy_bpm, rmssd_ms, spo2_pct, resp_min, temp_c, eda_us,
    pas, minutes_valides, source
  )
  -- FC de repos : moyenne du decile le plus bas de la journee. La moyenne
  -- simple serait tiree vers le haut par les heures de travail ; le minimum
  -- brut serait tire vers le bas par le moindre artefact de mesure.
  WITH deciles AS (
    SELECT
      resident_id,
      fc_bpm,
      NTILE(10) OVER (PARTITION BY resident_id ORDER BY fc_bpm) AS decile
    FROM mesures
    WHERE DATE(mesure_at) = p_jour
      AND fc_bpm IS NOT NULL
      AND qualite IN ('good', 'fair')
  ),
  repos AS (
    SELECT resident_id, ROUND(AVG(fc_bpm), 1) AS fc_repos_bpm
    FROM deciles
    WHERE decile = 1
    GROUP BY resident_id
  ),
  jour AS (
    SELECT
      resident_id,
      ROUND(AVG(fc_bpm),     1) AS fc_moy_bpm,
      ROUND(AVG(rmssd_ms),   1) AS rmssd_ms,
      ROUND(AVG(spo2_pct),   1) AS spo2_pct,
      ROUND(AVG(resp_min),   1) AS resp_min,
      ROUND(AVG(temp_c),     2) AS temp_c,
      ROUND(AVG(eda_us),     2) AS eda_us,
      MAX(pas)                  AS pas,
      COUNT(*)                  AS minutes_valides,
      CASE
        WHEN MIN(source) = MAX(source) THEN MIN(source)
        ELSE 'mixte'
      END                       AS source
    FROM mesures
    WHERE DATE(mesure_at) = p_jour
      AND qualite IN ('good', 'fair')
    GROUP BY resident_id
  )
  SELECT
    j.resident_id, p_jour, p_jour_vol,
    r.fc_repos_bpm, j.fc_moy_bpm, j.rmssd_ms, j.spo2_pct, j.resp_min,
    j.temp_c, j.eda_us, j.pas, j.minutes_valides, j.source
  FROM jour j
  LEFT JOIN repos r ON r.resident_id = j.resident_id
  ON DUPLICATE KEY UPDATE
    fc_repos_bpm    = VALUES(fc_repos_bpm),
    fc_moy_bpm      = VALUES(fc_moy_bpm),
    rmssd_ms        = VALUES(rmssd_ms),
    spo2_pct        = VALUES(spo2_pct),
    resp_min        = VALUES(resp_min),
    temp_c          = VALUES(temp_c),
    eda_us          = VALUES(eda_us),
    pas             = VALUES(pas),
    minutes_valides = VALUES(minutes_valides),
    source          = VALUES(source);
END //

-- Purge de la serie brute. Le detail a la minute ne sert qu'a recalculer un
-- agregat ou a rejouer un incident : 90 jours suffisent, et moins de donnees
-- conservees, c'est moins de donnees a proteger.
CREATE PROCEDURE sola_purge_mesures(IN p_jours INT)
BEGIN
  DELETE FROM mesures
  WHERE mesure_at < NOW() - INTERVAL p_jours DAY
  LIMIT 50000;
END //

DELIMITER ;
