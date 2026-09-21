import { Router } from "express";
import { requete } from "../db.js";

/**
 * Ce que la console medicale lit.
 *
 * Les formes renvoyees suivent `web/console/src/types.ts` d'assez pres pour
 * qu'un adaptateur de quelques lignes suffise cote interface. Elles restent
 * volontairement brutes : le formatage (« 6 240 pas », « J+4 128 ») reste
 * l'affaire de l'interface, pas du serveur.
 */
export const consoleApi = Router();

// ------------------------------------------------------- ecran 02 : equipage
consoleApi.get("/crew", async (_req, res, next) => {
  try {
    const [depistage] = await requete<{
      residents: number;
      indice_bienetre: number | null;
      pct_phq9: number | null;
      pct_gad7: number | null;
      pct_isi: number | null;
      n_phq9: number | null;
      n_gad7: number | null;
      n_isi: number | null;
    }>("SELECT * FROM v_depistage_jour");

    const bienetre = await requete<{ jour: string; jour_vol: number; indice: number }>(
      `SELECT jour, jour_vol, indice
         FROM v_bienetre_jour
        WHERE jour >= CURDATE() - INTERVAL :jours DAY
        ORDER BY jour`,
      { jours: 30 },
    );

    const modules = await requete<{ module: string; signaux: number; pct_residents: number }>(
      "SELECT * FROM v_signaux_module ORDER BY signaux DESC",
    );

    const motifs = await requete<{ motif: string; conversations: number }>(
      "SELECT * FROM v_motifs_30j ORDER BY conversations DESC LIMIT 6",
    );

    const physio = await requete<{ libelle: string; pct: number | null }>(
      "SELECT * FROM v_alertes_physio",
    );

    // La file de triage : ouverte ou en cours, la plus grave d'abord.
    const triage = await requete<Record<string, unknown>>(
      `SELECT s.id,
              s.severite,
              r.code            AS resident,
              r.cabine,
              TIMESTAMPDIFF(YEAR, r.date_naissance, CURDATE()) AS age,
              s.motif,
              DATE_FORMAT(s.ouvert_at, '%H:%i')                AS ouvert_a,
              s.assigne_a,
              s.statut
         FROM signaux s
         JOIN residents r ON r.id = s.resident_id
        WHERE s.statut <> 'clos'
        ORDER BY FIELD(s.severite, 'critique', 'surveillance', 'info'),
                 s.ouvert_at
        LIMIT 20`,
    );

    res.json({ depistage, bienetre, modules, motifs, physio, triage });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------ ecran 03 : fiche resident
consoleApi.get("/residents/:code", async (req, res, next) => {
  try {
    const code = req.params.code;

    const [resident] = await requete<Record<string, unknown>>(
      `SELECT r.id, r.code, r.prenom, r.nom, r.poste, r.cabine,
              r.groupe_sanguin, r.statut, r.embarque_jour_vol,
              TIMESTAMPDIFF(YEAR, r.date_naissance, CURDATE()) AS age,
              c.code AS confiance_code, c.prenom AS confiance_prenom,
              c.nom  AS confiance_nom,  r.confiance_lien
         FROM residents r
         LEFT JOIN residents c ON c.id = r.confiance_id
        WHERE r.code = :code`,
      { code },
    );

    if (!resident) {
      res.status(404).json({ erreur: `Resident inconnu : ${code}` });
      return;
    }

    const id = resident.id as number;

    const [bracelet] = await requete<Record<string, unknown>>(
      `SELECT serie, firmware, batterie_pct, synchro_at
         FROM bracelets WHERE resident_id = :id LIMIT 1`,
      { id },
    );

    // Quatorze jours de constantes : une ligne par jour, toutes les tuiles.
    const constantes = await requete<Record<string, unknown>>(
      `SELECT jour, jour_vol, fc_repos_bpm, rmssd_ms, spo2_pct, resp_min,
              temp_c, eda_us, pas, source
         FROM mesures_jour
        WHERE resident_id = :id
          AND jour >= CURDATE() - INTERVAL 13 DAY
        ORDER BY jour`,
      { id },
    );

    const nuits = await requete<Record<string, unknown>>(
      `SELECT nuit_du, jour_vol, sommeil_min, latence_min, eveils_min, source
         FROM nuits
        WHERE resident_id = :id
          AND nuit_du >= CURDATE() - INTERVAL 13 DAY
        ORDER BY nuit_du`,
      { id },
    );

    const evenements = await requete<Record<string, unknown>>(
      `SELECT DATE(survenu_at) AS jour, type, COUNT(*) AS n
         FROM evenements
        WHERE resident_id = :id
          AND survenu_at >= CURDATE() - INTERVAL 13 DAY
        GROUP BY DATE(survenu_at), type`,
      { id },
    );

    // Resumes de conversation. Il n'y a rien d'autre a servir : le verbatim
    // n'est pas dans cette base.
    const conversations = await requete<Record<string, unknown>>(
      `SELECT c.id, c.debut_at, c.jour_vol, c.duree_min, c.severite, c.resume,
              c.actions_proposees, c.actions_acceptees, c.remontee_auto,
              c.resident_notifie_at,
              COALESCE(
                (SELECT JSON_ARRAYAGG(t.tag)
                   FROM conversation_tags t
                  WHERE t.conversation_id = c.id),
                JSON_ARRAY()
              ) AS tags
         FROM conversations c
        WHERE c.resident_id = :id
        ORDER BY c.debut_at DESC
        LIMIT 20`,
      { id },
    );

    const [total] = await requete<{ n: number }>(
      "SELECT COUNT(*) AS n FROM conversations WHERE resident_id = :id",
      { id },
    );

    const particularites = await requete<Record<string, unknown>>(
      `SELECT type, niveau, titre, detail
         FROM particularites
        WHERE resident_id = :id
        ORDER BY FIELD(niveau, 'critique', 'surveillance', 'info'), id`,
      { id },
    );

    const suivis = await requete<Record<string, unknown>>(
      `SELECT type, titre, detail, debut_jour_vol, echeance_jour_vol
         FROM suivis
        WHERE resident_id = :id AND actif = TRUE
        ORDER BY FIELD(type, 'traitement', 'action', 'rendez_vous', 'contact'), id`,
      { id },
    );

    const etatMental = await requete<Record<string, unknown>>(
      `SELECT evalue_le, jour_vol, score_moral, phq9, gad7, isi, source
         FROM etat_mental
        WHERE resident_id = :id
        ORDER BY evalue_le DESC
        LIMIT 12`,
      { id },
    );

    res.json({
      resident,
      bracelet: bracelet ?? null,
      constantes,
      nuits,
      evenements,
      conversations,
      conversations_total: total?.n ?? 0,
      particularites,
      suivis,
      etat_mental: etatMental,
    });
  } catch (e) {
    next(e);
  }
});
