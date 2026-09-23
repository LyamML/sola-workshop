import { Router } from "express";
import { requete, residentId } from "../db.js";

/**
 * Ce que le bracelet d'un resident vient d'envoyer : la carte « en direct »
 * de la fiche, qui la relit toutes les dix secondes.
 *
 * Une route a part plutot qu'un champ de plus dans /api/residents/:code : la
 * fiche sert aussi le repli fige de la console (scripts/db-repli.mjs), et une
 * valeur qui change a la seconde n'a rien a faire dans un fichier commite.
 *
 * Les horodatages de `mesures` et `synchro_at` sont ecrits en UTC par le
 * serveur. Ils partent ici en ISO, avec leur « Z », pour que le navigateur les
 * lise dans son fuseau ; l'horloge du serveur part avec eux, et l'age d'une
 * trame se compte sur elle plutot que sur celle du poste.
 */
export const directApi = Router();

const MINUTE = `strftime('%Y-%m-%dT%H:%M:%SZ', mesure_at) AS at,
                fc_bpm, spo2_pct, rmssd_ms, activite_g, qualite`;

directApi.get("/residents/:code/direct", (req, res, next) => {
  try {
    const id = residentId(req.params.code);
    if (id === null) {
      res.status(404).json({ erreur: `Resident inconnu : ${req.params.code}` });
      return;
    }

    const bracelet =
      requete(
        `SELECT serie, batterie_pct, strftime('%Y-%m-%dT%H:%M:%SZ', synchro_at) AS synchro_at
           FROM bracelets WHERE resident_id = :id LIMIT 1`,
        { id },
      )[0] ?? null;

    // Vingt-quatre heures, pas davantage : au-dela, ce n'est plus du direct,
    // et les tuiles de la fiche disent deja de quand date chaque valeur.
    const derniere =
      requete(
        `SELECT ${MINUTE} FROM mesures
          WHERE resident_id = :id AND mesure_at >= datetime('now', '-1 day')
          ORDER BY mesure_at DESC LIMIT 1`,
        { id },
      )[0] ?? null;

    const minutes = requete(
      `SELECT ${MINUTE} FROM mesures
        WHERE resident_id = :id AND mesure_at >= datetime('now', '-60 minutes')
        ORDER BY mesure_at`,
      { id },
    );

    // Le jour de `mesures_jour` — la date UTC, les minutes good et fair —,
    // pour que la carte et les tuiles comptent la meme journee.
    const jour = requete(
      `SELECT (SELECT jour_vol FROM mesures_jour
                WHERE resident_id = :id AND jour = date('now')) AS jour_vol,
              COUNT(*) AS minutes,
              MIN(fc_bpm) AS fc_min, ROUND(AVG(fc_bpm), 1) AS fc_moy, MAX(fc_bpm) AS fc_max,
              MIN(spo2_pct) AS spo2_min, ROUND(AVG(spo2_pct), 1) AS spo2_moy
         FROM mesures
        WHERE resident_id = :id AND mesure_at >= date('now')
          AND qualite IN ('good', 'fair')`,
      { id },
    )[0]!;

    res.json({ maintenant: new Date().toISOString(), bracelet, derniere, minutes, jour });
  } catch (e) {
    next(e);
  }
});
