import { Router } from "express";
import type { RequestHandler } from "express";
import { config } from "../config.js";
import { ecrire, requete } from "../db.js";

/**
 * Ce que la console medicale lit.
 *
 * Les formes renvoyees suivent `web/console/src/types.ts` d'assez pres pour
 * qu'un adaptateur de quelques lignes suffise cote interface. Elles restent
 * volontairement brutes : le formatage (« 6 240 pas », « J+4 128 ») reste
 * l'affaire de l'interface, pas du serveur.
 */
export const consoleApi = Router();

/** SQLite n'a pas de fonction d'age : on la compose. */
const AGE = "CAST((julianday('now') - julianday(r.date_naissance)) / 365.25 AS INTEGER)";

/** Ordre de gravite. SQLite n'a pas FIELD() : un CASE fait la meme chose. */
const ORDRE_SEVERITE = `
  CASE s.severite WHEN 'critique' THEN 1 WHEN 'surveillance' THEN 2 ELSE 3 END`;

// ------------------------------------------------------- ecran 02 : equipage
consoleApi.get("/crew", (_req, res, next) => {
  try {
    const depistage = requete("SELECT * FROM v_depistage_jour")[0] ?? null;

    // Toute la serie, pas seulement trente jours : les trois onglets de
    // l'ecran (semaine, mois, annee) se decoupent dedans cote interface,
    // plutot que de faire trois allers-retours.
    const serie = requete(
      `SELECT jour, jour_vol, indice, pct_phq9, pct_gad7, pct_isi, residents
         FROM v_depistage_serie
        ORDER BY jour`,
    );

    // Derniere remontee d'un bracelet : l'interface en fait « synchro il y a
    // 4 min ». Le calcul du « il y a » est du formatage, donc son affaire.
    const synchro = requete<{ dernier: string | null }>(
      "SELECT MAX(synchro_at) AS dernier FROM bracelets",
    )[0]?.dernier ?? null;

    // Par pourcentage et non par nombre : un module de 119 personnes avec 11
    // signaux va plus mal qu'un module de 280 qui en compte 18.
    const modules = requete(
      "SELECT * FROM v_signaux_module ORDER BY pct_residents DESC",
    );

    const motifs = requete(
      "SELECT * FROM v_motifs_30j ORDER BY conversations DESC LIMIT 6",
    );

    const physio = requete("SELECT libelle, pct FROM v_alertes_physio ORDER BY ordre");

    // La file de triage : ouverte ou en cours, la plus grave d'abord.
    const triage = requete(
      `SELECT s.id,
              s.severite,
              r.code     AS resident,
              r.cabine,
              ${AGE}     AS age,
              s.motif,
              strftime('%H:%M', s.ouvert_at) AS ouvert_a,
              s.assigne_a,
              s.statut
         FROM signaux s
         JOIN residents r ON r.id = s.resident_id
        WHERE s.statut <> 'clos'
        ORDER BY ${ORDRE_SEVERITE}, s.ouvert_at
        LIMIT 20`,
    );

    // Deux compteurs que l'en-tete de la file affiche, calcules ici parce
    // qu'ils portent sur TOUS les signaux ouverts, pas sur les vingt servis.
    const compteurs = requete<{ ouverts: number; critiques: number; non_assignes: number }>(
      `SELECT COUNT(*) AS ouverts,
              COALESCE(SUM(severite = 'critique'), 0) AS critiques,
              COALESCE(SUM(assigne_a IS NULL), 0)     AS non_assignes
         FROM signaux WHERE statut <> 'clos'`,
    )[0];

    res.json({
      vaisseau: {
        nom: "Meridien",
        residents: (depistage as { residents?: number } | null)?.residents ?? 0,
        jour_vol: config.jourVol,
        synchro_at: synchro,
      },
      depistage,
      serie,
      modules,
      motifs,
      physio,
      triage,
      compteurs,
    });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------ ecran 03 : fiche resident
consoleApi.get("/residents/:code", (req, res, next) => {
  try {
    const code = req.params.code;

    const resident = requete<{ id: number }>(
      `SELECT r.id, r.code, r.prenom, r.nom, r.poste, r.cabine,
              r.groupe_sanguin, r.statut, r.embarque_jour_vol,
              ${AGE} AS age,
              c.code AS confiance_code, c.prenom AS confiance_prenom,
              c.nom  AS confiance_nom,  r.confiance_lien
         FROM residents r
         LEFT JOIN residents c ON c.id = r.confiance_id
        WHERE r.code = :code`,
      { code },
    )[0];

    if (!resident) {
      res.status(404).json({ erreur: `Resident inconnu : ${code}` });
      return;
    }

    const id = resident.id;

    const bracelet =
      requete(
        `SELECT serie, firmware, batterie_pct, synchro_at
           FROM bracelets WHERE resident_id = :id LIMIT 1`,
        { id },
      )[0] ?? null;

    // Quatorze jours de constantes : une ligne par jour, toutes les tuiles.
    const constantes = requete(
      `SELECT jour, jour_vol, fc_repos_bpm, rmssd_ms, spo2_pct, resp_min,
              temp_c, eda_us, pas, source
         FROM mesures_jour
        WHERE resident_id = :id
          AND jour >= date('now', '-13 days')
        ORDER BY jour`,
      { id },
    );

    const nuits = requete(
      `SELECT nuit_du, jour_vol, sommeil_min, latence_min, eveils_min, source
         FROM nuits
        WHERE resident_id = :id
          AND nuit_du >= date('now', '-13 days')
        ORDER BY nuit_du`,
      { id },
    );

    const evenements = requete(
      `SELECT date(survenu_at) AS jour, type, COUNT(*) AS n
         FROM evenements
        WHERE resident_id = :id
          AND survenu_at >= datetime('now', '-13 days')
        GROUP BY date(survenu_at), type`,
      { id },
    );

    // Resumes de conversation. Il n'y a rien d'autre a servir : le verbatim
    // n'est pas dans cette base.
    const conversations = requete<{ tags: string }>(
      `SELECT c.id, c.debut_at, c.jour_vol, c.duree_min, c.severite, c.resume,
              c.actions_proposees, c.actions_acceptees, c.remontee_auto,
              c.resident_notifie_at,
              (SELECT json_group_array(t.tag)
                 FROM conversation_tags t
                WHERE t.conversation_id = c.id) AS tags
         FROM conversations c
        WHERE c.resident_id = :id
        ORDER BY c.debut_at DESC
        LIMIT 20`,
      { id },
    ).map((c) => ({ ...c, tags: JSON.parse(c.tags ?? "[]") as string[] }));

    const total = requete<{ n: number }>(
      "SELECT COUNT(*) AS n FROM conversations WHERE resident_id = :id",
      { id },
    )[0];

    const particularites = requete(
      `SELECT type, niveau, titre, detail
         FROM particularites
        WHERE resident_id = :id
        ORDER BY CASE niveau
                   WHEN 'critique' THEN 1 WHEN 'surveillance' THEN 2 ELSE 3
                 END, id`,
      { id },
    );

    const suivis = requete(
      `SELECT type, titre, detail, debut_jour_vol, echeance_jour_vol
         FROM suivis
        WHERE resident_id = :id AND actif = 1
        ORDER BY CASE type
                   WHEN 'traitement' THEN 1 WHEN 'action'  THEN 2
                   WHEN 'rendez_vous' THEN 3 ELSE 4
                 END, id`,
      { id },
    );

    const etatMental = requete(
      `SELECT evalue_le, jour_vol, score_moral, phq9, gad7, isi, source
         FROM etat_mental
        WHERE resident_id = :id
        ORDER BY evalue_le DESC
        LIMIT 12`,
      { id },
    );

    res.json({
      resident,
      bracelet,
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

// ----------------------------------------------- ecran 04 : registre equipage
/**
 * Colonnes triables, et rien d'autre.
 *
 * Le nom de tri arrive de l'URL : il ne peut donc JAMAIS être concaténé dans
 * le SQL. Cette table fait la traduction, et une clé inconnue retombe sur le
 * tri par défaut plutôt que de lever une erreur — un lien copié-collé avec un
 * paramètre abîmé doit afficher la page, pas un 400.
 */
const TRIS_EQUIPAGE: Record<string, string> = {
  code: "r.code",
  nom: "r.nom",
  prenom: "r.prenom",
  poste: "r.poste",
  cabine: "r.cabine",
  module: "module",
  age: "age",
  statut: "ordre_statut",
  signaux: "signaux",
  spo2: "spo2_pct",
  fc_repos: "fc_repos_bpm",
  fc_moy: "fc_moy_bpm",
  rmssd: "rmssd_ms",
  resp: "resp_min",
  temp: "temp_c",
  pas: "pas",
  sommeil: "sommeil_min",
  moral: "score_moral",
  phq9: "phq9",
  gad7: "gad7",
  isi: "isi",
  batterie: "batterie_pct",
  synchro: "synchro_at",
};

/**
 * Construit un `ORDER BY` sûr.
 *
 * Les valeurs manquantes passent toujours en dernier, dans les deux sens. Un
 * tri « SpO₂ croissante » qui remonte d'abord trente bracelets muets ne classe
 * pas des résidents fragiles, il classe des pannes de capteur — et la personne
 * réellement à 91 % se retrouve enterrée page 2.
 */
function ordre(
  tris: Record<string, string>,
  tri: unknown,
  sens: unknown,
  defaut: string,
): string {
  const colonne = tris[String(tri ?? "")] ?? defaut;
  const direction = String(sens ?? "").toLowerCase() === "desc" ? "DESC" : "ASC";
  return `${colonne} IS NULL, ${colonne} ${direction}`;
}

/** Bornes de pagination : une page sans limite est un déni de service gratuit. */
function pagination(query: Record<string, unknown>) {
  const taille = Math.min(Math.max(Number(query.taille) || 50, 1), 200);
  const page = Math.max(Number(query.page) || 1, 1);
  return { taille, page, decalage: (page - 1) * taille };
}

consoleApi.get("/equipage", (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const module = String(req.query.module ?? "").trim().toUpperCase();
    const statut = String(req.query.statut ?? "").trim();
    const { taille, page, decalage } = pagination(req.query as Record<string, unknown>);

    // Les filtres sont neutralisés DANS le SQL : `:q = ''` désactive le critère
    // sans qu'on ait à recomposer la requête selon ce qui est fourni.
    const filtre = `
      WHERE (:q = ''
             OR r.code   LIKE '%' || :q || '%'
             OR r.prenom LIKE '%' || :q || '%'
             OR r.nom    LIKE '%' || :q || '%'
             OR r.poste  LIKE '%' || :q || '%'
             OR r.cabine LIKE '%' || :q || '%')
        AND (:module = '' OR SUBSTR(r.cabine, 1, 1) = :module)
        AND (:statut = '' OR r.statut = :statut)`;

    const params = { q, module, statut };

    const total =
      requete<{ n: number }>(`SELECT COUNT(*) AS n FROM residents r ${filtre}`, params)[0]?.n ?? 0;

    // « Dernière ligne connue » par résident, et non « ligne du jour » : un
    // bracelet muet depuis deux jours doit montrer sa dernière mesure datée,
    // pas une case vide qui ressemble à une valeur normale.
    const lignes = requete(
      `WITH constantes AS (
         SELECT resident_id, jour, fc_repos_bpm, fc_moy_bpm, rmssd_ms, spo2_pct,
                resp_min, temp_c, pas,
                ROW_NUMBER() OVER (PARTITION BY resident_id ORDER BY jour DESC) AS rang
           FROM mesures_jour
       ),
       nuit AS (
         SELECT resident_id, nuit_du, sommeil_min,
                ROW_NUMBER() OVER (PARTITION BY resident_id ORDER BY nuit_du DESC) AS rang
           FROM nuits
       ),
       mental AS (
         SELECT resident_id, evalue_le, score_moral, phq9, gad7, isi,
                ROW_NUMBER() OVER (PARTITION BY resident_id ORDER BY evalue_le DESC) AS rang
           FROM etat_mental
       ),
       ouverts AS (
         SELECT resident_id,
                COUNT(*) AS n,
                MIN(CASE severite WHEN 'critique' THEN 1
                                  WHEN 'surveillance' THEN 2 ELSE 3 END) AS pire
           FROM signaux
          WHERE statut <> 'clos'
          GROUP BY resident_id
       ),
       montre AS (
         SELECT resident_id, MAX(synchro_at) AS synchro_at, MAX(batterie_pct) AS batterie_pct
           FROM bracelets
          WHERE resident_id IS NOT NULL
          GROUP BY resident_id
       )
       SELECT r.code, r.prenom, r.nom, r.poste, r.cabine, r.statut,
              SUBSTR(r.cabine, 1, 1) AS module,
              ${AGE} AS age,
              CASE r.statut WHEN 'critique' THEN 1
                            WHEN 'surveillance' THEN 2 ELSE 3 END AS ordre_statut,
              COALESCE(o.n, 0) AS signaux,
              o.pire AS pire_severite,
              c.jour AS constantes_du,
              c.fc_repos_bpm, c.fc_moy_bpm, c.rmssd_ms, c.spo2_pct,
              c.resp_min, c.temp_c, c.pas,
              n.nuit_du, n.sommeil_min,
              m.evalue_le, m.score_moral, m.phq9, m.gad7, m.isi,
              b.synchro_at, b.batterie_pct
         FROM residents r
         LEFT JOIN constantes c ON c.resident_id = r.id AND c.rang = 1
         LEFT JOIN nuit       n ON n.resident_id = r.id AND n.rang = 1
         LEFT JOIN mental     m ON m.resident_id = r.id AND m.rang = 1
         LEFT JOIN ouverts    o ON o.resident_id = r.id
         LEFT JOIN montre     b ON b.resident_id = r.id
         ${filtre}
        ORDER BY ${ordre(TRIS_EQUIPAGE, req.query.tri, req.query.sens, "ordre_statut")}, r.code
        LIMIT :taille OFFSET :decalage`,
      { ...params, taille, decalage },
    );

    res.json({
      total,
      page,
      taille,
      tri: String(req.query.tri ?? "statut"),
      sens: String(req.query.sens ?? "asc"),
      lignes,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------- alertes récentes
const TRIS_SIGNAUX: Record<string, string> = {
  severite: "ordre_severite",
  resident: "r.code",
  nom: "r.nom",
  cabine: "r.cabine",
  module: "module",
  age: "age",
  motif: "s.motif",
  origine: "s.origine",
  ouvert: "s.ouvert_at",
  assigne: "s.assigne_a",
  statut: "ordre_statut",
  clos: "s.clos_at",
};

consoleApi.get("/signaux", (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const severite = String(req.query.severite ?? "").trim();
    // Sans précision, ce qui reste à traiter. `statut=tout` ouvre l'historique.
    const statut = String(req.query.statut ?? "").trim();
    const ouvertsSeuls = statut === "" ? 1 : 0;
    const { taille, page, decalage } = pagination(req.query as Record<string, unknown>);

    const filtre = `
      WHERE (:q = ''
             OR r.code   LIKE '%' || :q || '%'
             OR r.nom    LIKE '%' || :q || '%'
             OR r.prenom LIKE '%' || :q || '%'
             OR s.motif  LIKE '%' || :q || '%')
        AND (:severite = '' OR s.severite = :severite)
        AND (:ouverts_seuls = 0 OR s.statut <> 'clos')
        AND (:statut IN ('', 'tout') OR s.statut = :statut)`;

    const params = { q, severite, statut, ouverts_seuls: ouvertsSeuls };

    const total =
      requete<{ n: number }>(
        `SELECT COUNT(*) AS n FROM signaux s JOIN residents r ON r.id = s.resident_id ${filtre}`,
        params,
      )[0]?.n ?? 0;

    const lignes = requete(
      `SELECT s.id, s.severite, s.motif, s.origine, s.ouvert_at, s.assigne_a,
              s.statut, s.clos_at, s.clos_motif,
              r.code AS resident, r.prenom, r.nom, r.cabine,
              SUBSTR(r.cabine, 1, 1) AS module,
              ${AGE} AS age,
              ${ORDRE_SEVERITE} AS ordre_severite,
              CASE s.statut WHEN 'ouvert' THEN 1 WHEN 'en_cours' THEN 2 ELSE 3 END AS ordre_statut
         FROM signaux s
         JOIN residents r ON r.id = s.resident_id
         ${filtre}
        ORDER BY ${ordre(TRIS_SIGNAUX, req.query.tri, req.query.sens, "ordre_severite")},
                 s.ouvert_at DESC
        LIMIT :taille OFFSET :decalage`,
      { ...params, taille, decalage },
    );

    res.json({
      total,
      page,
      taille,
      tri: String(req.query.tri ?? "severite"),
      sens: String(req.query.sens ?? "asc"),
      lignes,
    });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------- ecran 03 : ajout d'une note de soin ---
/**
 * Ajout d'une note de particularite par un medecin, depuis la fiche.
 *
 * L'ecriture est ouverte — provisoirement. Elle passait par le jeton du
 * backoffice, ce qui etait faux de deux facons : le jeton d'exploitation
 * n'atteste pas d'un medecin, et une console de soin ne demande pas a
 * l'utilisateur de recopier une cle de 64 caracteres pour ecrire une ligne.
 *
 * La porte sera la session medecin (table `medecins`), pas un jeton partage :
 * c'est elle qui dira QUI a ecrit la note, ce qu'aucun jeton unique ne peut
 * dire. En attendant la table, la route reste ouverte et la note n'a pas
 * d'auteur — a ne pas laisser passer en service.
 */
export const ajouterParticularite: RequestHandler = (req, res, next) => {
  try {
    const { type, niveau, titre, detail } = req.body ?? {};

    if (!["allergie", "contre_indication", "antecedent", "info"].includes(type)) {
      res.status(422).json({
        erreur: "type doit valoir allergie, contre_indication, antecedent ou info.",
      });
      return;
    }
    if (!["critique", "surveillance", "info"].includes(niveau)) {
      res.status(422).json({ erreur: "niveau doit valoir critique, surveillance ou info." });
      return;
    }
    if (!titre || !detail) {
      res.status(422).json({ erreur: "titre et detail sont obligatoires." });
      return;
    }

    const cible = requete<{ id: number }>(
      "SELECT id FROM residents WHERE code = :code",
      { code: req.params.code },
    )[0];
    if (!cible) {
      res.status(404).json({ erreur: `Resident inconnu : ${req.params.code}` });
      return;
    }

    const { lastInsertRowid } = ecrire(
      `INSERT INTO particularites (resident_id, type, niveau, titre, detail, constate_le)
       VALUES (:rid, :type, :niveau, :titre, :detail, date('now'))`,
      { rid: cible.id, type, niveau, titre, detail },
    );

    res.status(201).json({ id: lastInsertRowid });
  } catch (e) {
    next(e);
  }
};

consoleApi.post("/residents/:code/particularites", ajouterParticularite);
