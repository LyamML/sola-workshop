import { Router } from "express";
import { ecrire, residentId, requete, transaction } from "../db.js";
import {
  BORNES,
  conversationSchema,
  evenementSchema,
  lotMesuresSchema,
  lotTramesSchema,
  mesureSchema,
  nuitSchema,
  refuseVerbatim,
  type Mesure,
  type Trame,
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

/** Ecrit des minutes deja validees ; a appeler dans une transaction. */
function ecrireMinutes(resident: number, bracelet: number | null, mesures: Mesure[]): void {
  for (const m of mesures) {
    ecrire(SQL_MESURE, {
      resident,
      bracelet,
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
}

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
    transaction(() => ecrireMinutes(id, braceletId, lot.data.mesures));

    res.status(202).json({ recues: lot.data.mesures.length });
  } catch (e) {
    next(e);
  }
});

// ----------------------------------------------------------------- bracelet -
/** Du meilleur au pire. A egalite de voix, une minute prend le pire etat. */
const QUALITES = ["good", "fair", "warmup", "poor"] as const;

function qualiteMajoritaire(trames: Trame[]): Mesure["qualite"] {
  let gagnante: Mesure["qualite"] = "poor";
  let voix = -1;
  // Du pire au meilleur, et `>` strict : un meilleur etat doit avoir plus de
  // voix pour l'emporter, pas autant.
  for (const q of [...QUALITES].reverse()) {
    const n = trames.filter((t) => t.q === q).length;
    if (n > voix) {
      gagnante = q;
      voix = n;
    }
  }
  return gagnante;
}

/** Moyenne arrondie des valeurs exploitables, null s'il n'en reste aucune. */
function moyenne(
  valeurs: (number | undefined)[],
  borne: { min: number; max: number },
  decimales: number,
): number | null {
  // Zero n'est jamais une mesure : c'est ce que le firmware publie tant qu'il
  // n'a pas de valeur fiable. Le moyenner ferait baisser la minute.
  const utiles = valeurs.filter(
    (v): v is number => v !== undefined && v > 0 && v >= borne.min && v <= borne.max,
  );
  if (utiles.length === 0) return null;
  const f = 10 ** decimales;
  return Math.round((utiles.reduce((s, v) => s + v, 0) / utiles.length) * f) / f;
}

/**
 * Une minute de trames devient une ligne de `mesures`. Les constantes issues
 * du capteur optique ne sont moyennees que sur les secondes `good` ou `fair`,
 * celles que db-rollup retient ; l'accelerometre ne depend pas du contact du
 * doigt, son activite se prend sur toutes les secondes.
 */
function resumerMinute(at: string, trames: Trame[]): Mesure {
  const fiables = trames.filter((t) => t.q === "good" || t.q === "fair");
  const sommeil = trames.flatMap((t) => (t.sleep === undefined ? [] : [t.sleep]));
  return mesureSchema.parse({
    at,
    bpm: moyenne(fiables.map((t) => t.bpm), BORNES.bpm, 1),
    rmssd: moyenne(fiables.map((t) => t.rmssd), BORNES.rmssd, 1),
    spo2: moyenne(fiables.map((t) => t.spo2), BORNES.spo2, 1),
    activite: moyenne(trames.map((t) => t.act), BORNES.activite, 4),
    dort: sommeil.length === 0 ? null : sommeil.filter((s) => s === 1).length * 2 > sommeil.length,
    source: "mesure",
    qualite: qualiteMajoritaire(trames),
  });
}

/**
 * Les trames brutes du bracelet, relayees par la borne.
 *
 * La borne ne calcule rien : elle horodate et transmet. Ce qui fait d'une
 * seconde de capteur une mesure — zero veut dire « rien », les bornes
 * physiologiques, la qualite du signal — vit ici, une seule fois, et se
 * verifie au curl sans bracelet.
 */
ingest.post("/bracelet", (req, res, next) => {
  try {
    const lot = lotTramesSchema.safeParse(req.body);
    if (!lot.success) {
      res.status(400).json({ erreur: "Charge utile invalide.", detail: lot.error.issues });
      return;
    }
    const { resident, bracelet, trames } = lot.data;

    const id = residentId(resident);
    if (id === null) {
      res.status(404).json({ erreur: `Resident inconnu : ${resident}` });
      return;
    }

    const b = requete<{ id: number; resident_id: number | null }>(
      "SELECT id, resident_id FROM bracelets WHERE serie = :serie",
      { serie: bracelet },
    )[0];
    if (!b) {
      res.status(404).json({ erreur: `Bracelet inconnu : ${bracelet}` });
      return;
    }
    // Un bracelet prete, ou une borne appairee au bracelet du voisin, ne doit
    // pas ecrire dans le dossier de quelqu'un d'autre.
    if (b.resident_id !== id) {
      res.status(409).json({ erreur: `${bracelet} n'est pas le bracelet de ${resident}.` });
      return;
    }
    const autre = trames.find((t) => t.id !== undefined && t.id !== resident);
    if (autre) {
      res.status(409).json({
        erreur: `Le bracelet se declare ${autre.id}, le lot est adresse a ${resident}.`,
      });
      return;
    }

    // Regroupees sur tout le lot, pas dans l'ordre d'arrivee : une minute
    // coupee par une deconnexion se recoud si ses deux moities voyagent
    // dans le meme envoi.
    const parMinute = new Map<number, Trame[]>();
    for (const t of trames) {
      const debut = Math.floor(Date.parse(t.at) / 60_000) * 60_000;
      const groupe = parMinute.get(debut);
      if (groupe) groupe.push(t);
      else parMinute.set(debut, [t]);
    }
    const minutes = [...parMinute.entries()]
      .sort(([x], [y]) => x - y)
      .map(([debut, groupe]) => resumerMinute(new Date(debut).toISOString(), groupe));

    transaction(() => {
      ecrireMinutes(id, b.id, minutes);
      ecrire("UPDATE bracelets SET synchro_at = datetime('now') WHERE id = :id", { id: b.id });
    });

    res.status(202).json({ trames: trames.length, minutes: minutes.length });
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
