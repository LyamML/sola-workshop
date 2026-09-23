import { type NextFunction, type Request, type Response, Router } from "express";
import { config } from "../config.js";
import { ecrire, residentId, requete, transaction } from "../db.js";
import {
  BORNES,
  conversationSchema,
  evenementSchema,
  lectureSchema,
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
 * `recevoirWifi` est montee seule sur le port reseau, derriere le jeton du
 * bracelet : elle y recoit ces memes lots, ou une lecture seule.
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

/**
 * La ligne de `mesures_jour` d'un resident, recalculee sur toutes les minutes
 * de ce jour. C'est elle que la fiche lit : sans ce calcul, les minutes du
 * bracelet n'y arrivaient qu'au db:rollup suivant.
 *
 * Le calcul de scripts/db-rollup.mjs pour un seul resident — les deux se
 * changent ensemble —, a une difference pres : une constante que ces minutes
 * ne portent pas garde sa valeur en place au lieu de passer a NULL. Un
 * bracelet qui n'envoie que la FC et la SpO2 n'efface pas la respiration du
 * jour.
 *
 * Le jour de vol se compte depuis la derniere ligne de la table, qui en porte
 * un avec sa date : le calendrier de bord avance d'un jour par jour. Pas
 * v_jour_courant, qui regrouperait toute la table a chaque lecture ; JOUR_VOL
 * seulement dans une base encore vide, comme pour la console.
 */
const SQL_JOUR = `
  INSERT INTO mesures_jour
    (resident_id, jour, jour_vol, fc_repos_bpm, fc_moy_bpm, rmssd_ms, spo2_pct,
     resp_min, temp_c, eda_us, pas, minutes_valides, source)
  WITH utilisables AS (
    SELECT * FROM mesures
     WHERE resident_id = :resident
       AND mesure_at >= :jour AND mesure_at < date(:jour, '+1 day')
       AND qualite IN ('good', 'fair')
  ),
  deciles AS (
    SELECT fc_bpm, NTILE(10) OVER (ORDER BY fc_bpm) AS decile
      FROM utilisables
     WHERE fc_bpm IS NOT NULL
  ),
  reference AS (
    SELECT jour, jour_vol FROM mesures_jour ORDER BY jour DESC LIMIT 1
  )
  SELECT resident_id, :jour,
         COALESCE(
           (SELECT jour_vol + CAST(ROUND(julianday(:jour) - julianday(jour)) AS INTEGER)
              FROM reference),
           :jour_vol + CAST(ROUND(julianday(:jour) - julianday(date('now'))) AS INTEGER)),
         (SELECT ROUND(AVG(fc_bpm), 1) FROM deciles WHERE decile = 1),
         ROUND(AVG(fc_bpm),   1),
         ROUND(AVG(rmssd_ms), 1),
         ROUND(AVG(spo2_pct), 1),
         ROUND(AVG(resp_min), 1),
         ROUND(AVG(temp_c),   2),
         ROUND(AVG(eda_us),   2),
         MAX(pas),
         COUNT(*),
         CASE WHEN MIN(source) = MAX(source) THEN MIN(source) ELSE 'mixte' END
    FROM utilisables
   GROUP BY resident_id
  ON CONFLICT (resident_id, jour) DO UPDATE SET
    fc_repos_bpm    = COALESCE(excluded.fc_repos_bpm, fc_repos_bpm),
    fc_moy_bpm      = COALESCE(excluded.fc_moy_bpm, fc_moy_bpm),
    rmssd_ms        = COALESCE(excluded.rmssd_ms, rmssd_ms),
    spo2_pct        = COALESCE(excluded.spo2_pct, spo2_pct),
    resp_min        = COALESCE(excluded.resp_min, resp_min),
    temp_c          = COALESCE(excluded.temp_c, temp_c),
    eda_us          = COALESCE(excluded.eda_us, eda_us),
    pas             = COALESCE(excluded.pas, pas),
    minutes_valides = MAX(excluded.minutes_valides, minutes_valides),
    source          = CASE WHEN source = excluded.source THEN source ELSE 'mixte' END,
    calcule_at      = datetime('now')`;

/**
 * Ecrit des minutes deja validees, puis la ligne de chaque jour qu'elles
 * touchent ; a appeler dans une transaction.
 */
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
  // Un lot de 1 440 minutes ne touche qu'un ou deux jours : on les recalcule
  // une fois chacun, pas une fois par minute.
  const jours = new Set(mesures.map((m) => versDatetime(m.at).slice(0, 10)));
  for (const jour of jours) ecrire(SQL_JOUR, { resident, jour, jour_vol: config.jourVol });
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
    }

    // Une transaction pour tout le lot : la borne peut en envoyer 1 440 d'un
    // coup apres une journee de coupure BLE, et 1 440 transactions separees
    // seraient 1 440 ecritures disque.
    //
    // ON CONFLICT : la borne reemet ce qu'elle n'a pas pu confirmer, donc la
    // meme minute arrive parfois deux fois. On ecrase plutot que d'echouer.
    transaction(() => {
      ecrireMinutes(id, braceletId, lot.data.mesures);
      // Tout lot recu est une synchronisation, qu'il donne la batterie ou non :
      // la fiche date le bracelet a sa derniere trame recue.
      if (braceletId !== null) {
        ecrire(
          `UPDATE bracelets
              SET batterie_pct = COALESCE(:batterie, batterie_pct), synchro_at = datetime('now')
            WHERE id = :id`,
          { batterie: lot.data.batterie, id: braceletId },
        );
      }
    });

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

type Ecartees = Partial<Record<"bpm" | "rmssd" | "spo2" | "act", number[]>>;

/**
 * Ce que les moyennes n'ont pas retenu parce que c'est hors de BORNES — zero
 * mis a part, qui veut dire « pas de valeur ». Ce ne sont pas des mesures, et
 * les CHECK de `mesures` les refuseraient ; mais une valeur aberrante reste
 * une information — le capteur ne mesure pas, ou mal — et l'emetteur doit le
 * savoir plutot que de la voir disparaitre en silence.
 */
function valeursEcartees(trames: Trame[]): Ecartees {
  // Les memes secondes que resumerMinute : l'optique sur good et fair,
  // l'accelerometre sur toutes.
  const fiables = trames.filter((t) => t.q === "good" || t.q === "fair");
  const hors = (valeurs: (number | undefined)[], borne: { min: number; max: number }) =>
    valeurs.filter((v): v is number => v !== undefined && v > 0 && (v < borne.min || v > borne.max));
  const ecartees: Ecartees = {
    bpm: hors(fiables.map((t) => t.bpm), BORNES.bpm),
    rmssd: hors(fiables.map((t) => t.rmssd), BORNES.rmssd),
    spo2: hors(fiables.map((t) => t.spo2), BORNES.spo2),
    act: hors(trames.map((t) => t.act), BORNES.activite),
  };
  for (const champ of Object.keys(ecartees) as (keyof Ecartees)[]) {
    if (ecartees[champ]?.length === 0) delete ecartees[champ];
  }
  return ecartees;
}

/** L'accuse de reception : les comptes, et les valeurs ecartees s'il y en a. */
function accuse(res: Response, trames: Trame[], minutes: number): void {
  const ecartees = valeursEcartees(trames);
  res.status(202).json({
    trames: trames.length,
    minutes,
    // Absent quand tout a ete retenu : la reponse ordinaire ne change pas.
    ...(Object.keys(ecartees).length > 0 ? { ecartees } : {}),
  });
}

/**
 * L'id du resident et celui de son bracelet, ou null une fois l'erreur
 * envoyee. Un bracelet prete, ou une borne appairee au bracelet du voisin, ne
 * doit pas ecrire dans le dossier de quelqu'un d'autre.
 */
function braceletDuResident(
  res: Response,
  resident: string,
  bracelet: string,
): { id: number; braceletId: number } | null {
  const id = residentId(resident);
  if (id === null) {
    res.status(404).json({ erreur: `Resident inconnu : ${resident}` });
    return null;
  }
  const b = requete<{ id: number; resident_id: number | null }>(
    "SELECT id, resident_id FROM bracelets WHERE serie = :serie",
    { serie: bracelet },
  )[0];
  if (!b) {
    res.status(404).json({ erreur: `Bracelet inconnu : ${bracelet}` });
    return null;
  }
  if (b.resident_id !== id) {
    res.status(409).json({ erreur: `${bracelet} n'est pas le bracelet de ${resident}.` });
    return null;
  }
  return { id, braceletId: b.id };
}

/**
 * Les trames brutes du bracelet, relayees par la borne en BLE, ou envoyees
 * par le bracelet lui-meme en Wi-Fi sur le port reseau.
 *
 * Ni la borne ni le bracelet ne calculent rien : ils horodatent et
 * transmettent. Ce qui fait d'une seconde de capteur une mesure — zero veut
 * dire « rien », les bornes physiologiques, la qualite du signal — vit ici,
 * une seule fois, et se verifie au curl sans bracelet.
 */
function recevoirTrames(req: Request, res: Response, next: NextFunction): void {
  try {
    const lot = lotTramesSchema.safeParse(req.body);
    if (!lot.success) {
      res.status(400).json({ erreur: "Charge utile invalide.", detail: lot.error.issues });
      return;
    }
    const { resident, bracelet, trames } = lot.data;

    const cible = braceletDuResident(res, resident, bracelet);
    if (!cible) return;
    const { id, braceletId } = cible;

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
      ecrireMinutes(id, braceletId, minutes);
      ecrire("UPDATE bracelets SET synchro_at = datetime('now') WHERE id = :id", { id: braceletId });
    });

    accuse(res, trames, minutes.length);
  } catch (e) {
    next(e);
  }
}

ingest.post("/bracelet", recevoirTrames);

/**
 * La minute en cours de chaque bracelet qui envoie en lectures seules. Sa
 * ligne de `mesures` se recalcule a chaque lecture sur toutes celles de la
 * minute : sans cela, chaque envoi ecraserait le precedent et la minute ne
 * garderait que la derniere lecture. En memoire seulement : un redemarrage du
 * serveur coute au plus la minute en cours.
 */
const minutesEnCours = new Map<number, { debut: number; trames: Trame[] }>();

/**
 * Une lecture seule du bracelet en Wi-Fi, horodatee a l'arrivee : sans relais,
 * c'est le serveur qui tient l'horloge que la borne tient en BLE.
 */
function recevoirLecture(req: Request, res: Response, next: NextFunction): void {
  try {
    const lecture = lectureSchema.safeParse(req.body);
    if (!lecture.success) {
      res.status(400).json({ erreur: "Charge utile invalide.", detail: lecture.error.issues });
      return;
    }
    const { resident, bracelet, ...valeurs } = lecture.data;

    const cible = braceletDuResident(res, resident, bracelet);
    if (!cible) return;
    const { id, braceletId } = cible;

    const maintenant = Date.now();
    const debut = Math.floor(maintenant / 60_000) * 60_000;
    let minute = minutesEnCours.get(braceletId);
    if (!minute || minute.debut !== debut) {
      minute = { debut, trames: [] };
      minutesEnCours.set(braceletId, minute);
    }
    const trame: Trame = { ...valeurs, at: new Date(maintenant).toISOString() };
    minute.trames.push(trame);
    const resume = resumerMinute(new Date(debut).toISOString(), minute.trames);

    transaction(() => {
      ecrireMinutes(id, braceletId, [resume]);
      ecrire("UPDATE bracelets SET synchro_at = datetime('now') WHERE id = :id", { id: braceletId });
    });

    // Les ecarts de cette lecture-ci, pas de toute la minute : chaque reponse
    // parle de ce que l'emetteur vient d'envoyer.
    accuse(res, [trame], 1);
  } catch (e) {
    next(e);
  }
}

/**
 * Le bracelet qui envoie lui-meme en Wi-Fi, sur le port reseau : un lot de
 * trames horodatees, comme la borne, ou une lecture seule toutes les quelques
 * secondes, ce que fait un croquis Arduino sans horloge.
 */
export function recevoirWifi(req: Request, res: Response, next: NextFunction): void {
  const lot = typeof req.body === "object" && req.body !== null && "trames" in req.body;
  (lot ? recevoirTrames : recevoirLecture)(req, res, next);
}

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
