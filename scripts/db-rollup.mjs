// Agrege les mesures a la minute en une ligne par jour et par resident.
//
//   npm run db:rollup            -- hier
//   npm run db:rollup 2026-09-20 -- un jour precis
//
// A lancer une fois par jour (cron a 00:20, heure de bord). `mesures` est
// ecrite en continu par les bornes ; `mesures_jour` est ce que la console lit.

import { DatabaseSync } from "node:sqlite";

const FICHIER = process.env.DB_FILE ?? "sola.db";
const JOUR_VOL_AUJOURDHUI = Number(process.env.JOUR_VOL ?? 4128);

const db = new DatabaseSync(FICHIER);
db.exec("PRAGMA foreign_keys = ON");

const jour =
  process.argv[2] ?? db.prepare("SELECT date('now','-1 day') AS j").get().j;

// Decalage en jours entre aujourd'hui et le jour agrege, pour retrouver le
// jour de vol correspondant.
const { ecart } = db
  .prepare("SELECT CAST(julianday('now') - julianday(:jour) AS INTEGER) AS ecart")
  .get({ jour });
const jourVol = JOUR_VOL_AUJOURDHUI - ecart;

// FC de repos : moyenne du decile le plus bas de la journee. La moyenne simple
// serait tiree vers le haut par les heures de travail ; le minimum brut serait
// tire vers le bas par le moindre artefact de mesure.
const sql = `
INSERT INTO mesures_jour
  (resident_id, jour, jour_vol, fc_repos_bpm, fc_moy_bpm, rmssd_ms, spo2_pct,
   resp_min, temp_c, eda_us, pas, minutes_valides, source)
WITH utilisables AS (
  SELECT * FROM mesures
   WHERE date(mesure_at) = :jour
     AND qualite IN ('good', 'fair')
),
deciles AS (
  SELECT resident_id, fc_bpm,
         NTILE(10) OVER (PARTITION BY resident_id ORDER BY fc_bpm) AS decile
    FROM utilisables
   WHERE fc_bpm IS NOT NULL
),
repos AS (
  SELECT resident_id, ROUND(AVG(fc_bpm), 1) AS fc_repos_bpm
    FROM deciles WHERE decile = 1 GROUP BY resident_id
),
jour AS (
  SELECT resident_id,
         ROUND(AVG(fc_bpm),   1) AS fc_moy_bpm,
         ROUND(AVG(rmssd_ms), 1) AS rmssd_ms,
         ROUND(AVG(spo2_pct), 1) AS spo2_pct,
         ROUND(AVG(resp_min), 1) AS resp_min,
         ROUND(AVG(temp_c),   2) AS temp_c,
         ROUND(AVG(eda_us),   2) AS eda_us,
         MAX(pas)                AS pas,
         COUNT(*)                AS minutes_valides,
         CASE WHEN MIN(source) = MAX(source) THEN MIN(source) ELSE 'mixte' END
           AS source
    FROM utilisables GROUP BY resident_id
)
SELECT j.resident_id, :jour, :jour_vol, r.fc_repos_bpm, j.fc_moy_bpm,
       j.rmssd_ms, j.spo2_pct, j.resp_min, j.temp_c, j.eda_us, j.pas,
       j.minutes_valides, j.source
  FROM jour j
  LEFT JOIN repos r ON r.resident_id = j.resident_id
ON CONFLICT (resident_id, jour) DO UPDATE SET
  fc_repos_bpm    = excluded.fc_repos_bpm,
  fc_moy_bpm      = excluded.fc_moy_bpm,
  rmssd_ms        = excluded.rmssd_ms,
  spo2_pct        = excluded.spo2_pct,
  resp_min        = excluded.resp_min,
  temp_c          = excluded.temp_c,
  eda_us          = excluded.eda_us,
  pas             = excluded.pas,
  minutes_valides = excluded.minutes_valides,
  source          = excluded.source,
  calcule_at      = datetime('now')`;

const { changes } = db.prepare(sql).run({ jour, jour_vol: jourVol });
console.log(`${jour} (J+${jourVol}) : ${changes} resident(s) agrege(s).`);

db.close();
