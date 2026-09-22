import { Router } from "express";
import { ecrire, residentId, requete, transaction } from "../db.js";
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
 * les ecritures passent par des instructions preparees a parametres nommes.
 */
export const ingest = Router();

/** Convertit un horodatage ISO en 'YYYY-MM-DD HH:MM:SS' UTC, format du schema. */
function versDatetime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
}

const SQL_MESURE = `
  INSERT INTO mesures
    (resident_id, bracelet_id, mesure_at, fc_bpm, rmssd_ms, spo2_pct,
     resp_min, temp_c, eda_us, activite_g, pas, dort, source, qualite)
  VALUES
    (:resident, :bracelet, :at, :fc, :rmssd, :spo2,
     :resp, :temp, :eda, :activite, :pas, :dort, :source, :qualite)
  ON CONFLICT (resident_id, mesure_at) DO UPDATE SET
    fc_bpm     = excluded.fc_bpm,
    rmssd_ms   = excluded.rmssd_ms,
    spo2_pct   = excluded.spo2_pct,
    resp_min   = excluded.resp_min,
    temp_c     = excluded.temp_c,
    eda_us     = excluded.eda_us,
    activite_g = excluded.activite_g,
    pas        = excluded.pas,
    dort       = excluded.dort,
    qualite    = excluded.qualite`;

// --------------------------------------------------------------- constantes -
ingest.post("/mesure", (req, res, next) => {
  try {
    const lot = lotMesuresSchema.safeParse(req.body);
    if (!lot.success) {
      res.status(400).json({ erreur: "Charge utile invalide.", detail: lot.error.issues });
      return;
    }

    const id = residentId(lot.data.resident);
    if (id === null) {
      res.status(404).json({ erreur: `Resident inconnu : ${lot.data.resident}` });
      return;
    }

    let braceletId: number | null = null;
    if (lot.data.bracelet) {
      const b = requete<{ id: number }>(
        "SELECT id FROM bracelets WHERE serie = :serie",
        { serie: lot.data.bracelet },
      )[0];
      braceletId = b?.id ?? null;
      if (braceletId !== null && lot.data.batterie !== undefined) {
        ecrire(
          `UPDATE bracelets
              SET batterie_pct = :batterie, synchro_at = datetime('now')
            WHERE id = :id`,
          { batterie: lot.data.batterie, id: braceletId },
        );
      }
    }

    // Une transaction pour tout le lot : la borne peut en envoyer 1 440 d'un
    // coup apres une journee de coupure BLE, et 1 440 transactions separees
    // seraient 1 440 ecritures disque.
    //
    // ON CONFLICT : la borne reemet ce qu'elle n'a pas pu confirmer, donc la
    // meme minute arrive parfois deux fois. On ecrase plutot que d'echouer.
    transaction(() => {
      for (const m of lot.data.mesures) {
        ecrire(SQL_MESURE, {
          resident: id,
          bracelet: braceletId,
          at: versDatetime(m.at),
          fc: m.bpm,
          rmssd: m.rmssd,
          spo2: m.spo2,
          resp: m.resp,
          temp: m.temp,
          eda: m.eda,
          activite: m.activite,
          pas: m.pas,
          dort: m.dort,
          source: m.source,
          qualite: m.qualite,
        });
      }
    });

    res.status(202).json({ recues: lot.data.mesures.length });
  } catch (e) {
    next(e);
  }
});

// -------------------------------------------------------------------- nuits -
ingest.post("/nuit", (req, res, next) => {
  try {
    const nuit = nuitSchema.safeParse(req.body);
    if (!nuit.success) {
      res.status(400).json({ erreur: "Charge utile invalide.", detail: nuit.error.issues });
      return;
    }

    const id = residentId(nuit.data.resident);
    if (id === null) {
      res.status(404).json({ erreur: `Resident inconnu : ${nuit.data.resident}` });
      return;
    }

    ecrire(
      `INSERT INTO nuits
         (resident_id, nuit_du, jour_vol, coucher_at, lever_at,
          sommeil_min, latence_min, eveils_min, source)
       VALUES (:id, :nuit_du, :jour_vol, :coucher, :lever,
               :sommeil, :latence, :eveils, :source)
       ON CONFLICT (resident_id, nuit_du) DO UPDATE SET
         coucher_at  = excluded.coucher_at,
         lever_at    = excluded.lever_at,
         sommeil_min = excluded.sommeil_min,
         latence_min = excluded.latence_min,
         eveils_min  = excluded.eveils_min,
         source      = excluded.source`,
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
ingest.post("/conversation", (req, res, next) => {
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
          "jamais. Voir db/serveur/01-schema.sql, table `conversations`.",
      });
      return;
    }

    const conv = conversationSchema.safeParse(req.body);
    if (!conv.success) {
      res.status(400).json({ erreur: "Charge utile invalide.", detail: conv.error.issues });
      return;
    }

    const id = residentId(conv.data.resident);
    if (id === null) {
      res.status(404).json({ erreur: `Resident inconnu : ${conv.data.resident}` });
      return;
    }

    const conversationId = transaction(() => {
      const { lastInsertRowid } = ecrire(
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

      for (const tag of conv.data.tags) {
        ecrire(
          `INSERT INTO conversation_tags (conversation_id, tag)
           VALUES (:conversation, :tag)
           ON CONFLICT DO NOTHING`,
          { conversation: lastInsertRowid, tag },
        );
      }

      // Une conversation remontee automatiquement ouvre un signal dans la file
      // du medecin. C'est ici que le fil "cabine -> triage" se referme.
      if (conv.data.remontee_auto && conv.data.severite !== "info") {
        ecrire(
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

      return lastInsertRowid;
    });

    res.status(201).json({ id: conversationId });
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- evenements -
ingest.post("/evenement", (req, res, next) => {
  try {
    const evt = evenementSchema.safeParse(req.body);
    if (!evt.success) {
      res.status(400).json({ erreur: "Charge utile invalide.", detail: evt.error.issues });
      return;
    }

    const id = residentId(evt.data.resident);
    if (id === null) {
      res.status(404).json({ erreur: `Resident inconnu : ${evt.data.resident}` });
      return;
    }

    transaction(() => {
      ecrire(
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
        ecrire(
          `INSERT INTO signaux
             (resident_id, severite, motif, origine, ouvert_at, statut)
           VALUES (:id, 'critique',
                   'Chute detectee par l''accelerometre · en attente de reponse',
                   'chute', :ouvert, 'ouvert')`,
          { id, ouvert: versDatetime(evt.data.survenu_at) },
        );
      }
    });

    res.status(202).json({ enregistre: true });
  } catch (e) {
    next(e);
  }
});
