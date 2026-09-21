import { Router } from "express";
import { pool, requete, residentId } from "../db.js";
import {
  conversationSchema,
  evenementSchema,
  lotMesuresSchema,
  nuitSchema,
  refuseVerbatim,
} from "../validation.js";

/**
 * Ce que les bornes de cabine ecrivent dans la base du serveur de bord.
 *
 * Toutes les routes sont protegees par `authBorne` (voir index.ts) et toutes
 * les ecritures passent par des requetes preparees.
 */
export const ingest = Router();

/** Convertit un horodatage ISO en `DATETIME` MySQL (UTC). */
function versDatetime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
}

// --------------------------------------------------------------- constantes -
ingest.post("/mesure", async (req, res, next) => {
  try {
    const lot = lotMesuresSchema.safeParse(req.body);
    if (!lot.success) {
      res.status(400).json({ erreur: "Charge utile invalide.", detail: lot.error.issues });
      return;
    }

    const id = await residentId(lot.data.resident);
    if (id === null) {
      res.status(404).json({ erreur: `Resident inconnu : ${lot.data.resident}` });
      return;
    }

    let braceletId: number | null = null;
    if (lot.data.bracelet) {
      const b = await requete<{ id: number }>(
        "SELECT id FROM bracelets WHERE serie = :serie",
        { serie: lot.data.bracelet },
      );
      braceletId = b[0]?.id ?? null;
      if (braceletId !== null && lot.data.batterie !== undefined) {
        await requete(
          `UPDATE bracelets
              SET batterie_pct = :batterie, synchro_at = UTC_TIMESTAMP()
            WHERE id = :id`,
          { batterie: lot.data.batterie, id: braceletId },
        );
      }
    }

    // Une seule requete pour tout le lot : la borne peut en envoyer 1 440
    // d'un coup apres une journee de coupure BLE.
    //
    // ON DUPLICATE KEY : la borne reemet ce qu'elle n'a pas pu confirmer, donc
    // la meme minute arrive parfois deux fois. On ecrase plutot que d'echouer.
    const lignes = lot.data.mesures.map((m) => [
      id,
      braceletId,
      versDatetime(m.at),
      m.bpm,
      m.rmssd,
      m.spo2,
      m.resp,
      m.temp,
      m.eda,
      m.activite,
      m.pas,
      m.dort,
      m.source,
      m.qualite,
    ]);

    await pool.query(
      `INSERT INTO mesures
         (resident_id, bracelet_id, mesure_at, fc_bpm, rmssd_ms, spo2_pct,
          resp_min, temp_c, eda_us, activite_g, pas, dort, source, qualite)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         fc_bpm     = VALUES(fc_bpm),
         rmssd_ms   = VALUES(rmssd_ms),
         spo2_pct   = VALUES(spo2_pct),
         resp_min   = VALUES(resp_min),
         temp_c     = VALUES(temp_c),
         eda_us     = VALUES(eda_us),
         activite_g = VALUES(activite_g),
         pas        = VALUES(pas),
         dort       = VALUES(dort),
         qualite    = VALUES(qualite)`,
      [lignes],
    );

    res.status(202).json({ recues: lignes.length });
  } catch (e) {
    next(e);
  }
});

// -------------------------------------------------------------------- nuits -
ingest.post("/nuit", async (req, res, next) => {
  try {
    const nuit = nuitSchema.safeParse(req.body);
    if (!nuit.success) {
      res.status(400).json({ erreur: "Charge utile invalide.", detail: nuit.error.issues });
      return;
    }

    const id = await residentId(nuit.data.resident);
    if (id === null) {
      res.status(404).json({ erreur: `Resident inconnu : ${nuit.data.resident}` });
      return;
    }

    await requete(
      `INSERT INTO nuits
         (resident_id, nuit_du, jour_vol, coucher_at, lever_at,
          sommeil_min, latence_min, eveils_min, source)
       VALUES (:id, :nuit_du, :jour_vol, :coucher, :lever,
               :sommeil, :latence, :eveils, :source)
       ON DUPLICATE KEY UPDATE
         coucher_at  = VALUES(coucher_at),
         lever_at    = VALUES(lever_at),
         sommeil_min = VALUES(sommeil_min),
         latence_min = VALUES(latence_min),
         eveils_min  = VALUES(eveils_min),
         source      = VALUES(source)`,
      {
        id,
        nuit_du: nuit.data.nuit_du,
        jour_vol: nuit.data.jour_vol,
        coucher: nuit.data.coucher_at ? versDatetime(nuit.data.coucher_at) : null,
        lever: nuit.data.lever_at ? versDatetime(nuit.data.lever_at) : null,
        sommeil: nuit.data.sommeil_min,
        latence: nuit.data.latence_min,
        eveils: nuit.data.eveils_min,
        source: nuit.data.source,
      },
    );

    res.status(202).json({ enregistre: true });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------ conversations -
ingest.post("/conversation", async (req, res, next) => {
  try {
    // Premiere barriere, avant meme la validation de forme : si la charge
    // utile contient un champ de verbatim, on refuse et on dit pourquoi.
    const interdit = refuseVerbatim(req.body);
    if (interdit) {
      res.status(422).json({
        erreur: "Transcription refusee.",
        champ: interdit,
        detail:
          "Le serveur de bord n'accepte que des resumes. Les paroles du " +
          "resident restent dans la base locale de sa borne et n'en sortent " +
          "jamais. Voir db/mysql/01-schema.sql, table `conversations`.",
      });
      return;
    }

    const conv = conversationSchema.safeParse(req.body);
    if (!conv.success) {
      res.status(400).json({ erreur: "Charge utile invalide.", detail: conv.error.issues });
      return;
    }

    const id = await residentId(conv.data.resident);
    if (id === null) {
      res.status(404).json({ erreur: `Resident inconnu : ${conv.data.resident}` });
      return;
    }

    const connexion = await pool.getConnection();
    try {
      await connexion.beginTransaction();

      const [resultat] = await connexion.execute(
        `INSERT INTO conversations
           (resident_id, debut_at, jour_vol, duree_min, severite, resume,
            actions_proposees, actions_acceptees, remontee_auto,
            resident_notifie_at)
         VALUES (:id, :debut, :jour_vol, :duree, :severite, :resume,
                 :proposees, :acceptees, :auto, :notifie)`,
        {
          id,
          debut: versDatetime(conv.data.debut_at),
          jour_vol: conv.data.jour_vol,
          duree: conv.data.duree_min,
          severite: conv.data.severite,
          resume: conv.data.resume,
          proposees: conv.data.actions_proposees,
          acceptees: conv.data.actions_acceptees,
          auto: conv.data.remontee_auto,
          notifie: conv.data.resident_notifie_at
            ? versDatetime(conv.data.resident_notifie_at)
            : null,
        },
      );

      const conversationId = (resultat as { insertId: number }).insertId;

      if (conv.data.tags.length > 0) {
        await connexion.query(
          "INSERT IGNORE INTO conversation_tags (conversation_id, tag) VALUES ?",
          [conv.data.tags.map((tag) => [conversationId, tag])],
        );
      }

      // Une conversation remontee automatiquement ouvre un signal dans la file
      // du medecin. C'est ici que le fil "cabine -> triage" se referme.
      if (conv.data.remontee_auto && conv.data.severite !== "info") {
        await connexion.execute(
          `INSERT INTO signaux
             (resident_id, severite, motif, origine, ouvert_at, statut)
           VALUES (:id, :severite, :motif, 'conversation', :ouvert, 'ouvert')`,
          {
            id,
            severite: conv.data.severite,
            motif: conv.data.resume.slice(0, 255),
            ouvert: versDatetime(conv.data.debut_at),
          },
        );
      }

      await connexion.commit();
      res.status(201).json({ id: conversationId });
    } catch (e) {
      await connexion.rollback();
      throw e;
    } finally {
      connexion.release();
    }
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- evenements -
ingest.post("/evenement", async (req, res, next) => {
  try {
    const evt = evenementSchema.safeParse(req.body);
    if (!evt.success) {
      res.status(400).json({ erreur: "Charge utile invalide.", detail: evt.error.issues });
      return;
    }

    const id = await residentId(evt.data.resident);
    if (id === null) {
      res.status(404).json({ erreur: `Resident inconnu : ${evt.data.resident}` });
      return;
    }

    await requete(
      `INSERT INTO evenements (resident_id, type, survenu_at, intensite_g)
       VALUES (:id, :type, :survenu, :intensite)`,
      {
        id,
        type: evt.data.type,
        survenu: versDatetime(evt.data.survenu_at),
        intensite: evt.data.intensite_g,
      },
    );

    // Une chute sans acquittement est une urgence : elle entre dans la file
    // sans attendre le prochain agregat.
    if (evt.data.type === "chute") {
      await requete(
        `INSERT INTO signaux
           (resident_id, severite, motif, origine, ouvert_at, statut)
         VALUES (:id, 'critique',
                 'Chute detectee par l''accelerometre · en attente de reponse',
                 'chute', :ouvert, 'ouvert')`,
        { id, ouvert: versDatetime(evt.data.survenu_at) },
      );
    }

    res.status(202).json({ enregistre: true });
  } catch (e) {
    next(e);
  }
});
