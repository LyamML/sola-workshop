import { createHash } from "node:crypto";
import { Router } from "express";
import type { RequestHandler, Response } from "express";
import { compte } from "../auth.js";
import { config } from "../config.js";
import { ecrire, heureDeBord, recalculerStatut, requete, transaction } from "../db.js";
import type { Compte } from "../sessions.js";

/**
 * Ce que la console medicale lit, et les trois gestes qu'elle ecrit : prendre
 * un signal, le clore, ajouter une note a un dossier.
 *
 * Les formes renvoyees restent brutes : le formatage (« 6 240 pas »,
 * « J+4 128 ») est l'affaire de l'interface, pas du serveur.
 *
 * `lireCrew` et `lireResident` sont exportees sans Express autour : le script
 * `scripts/db-repli.mjs` les appelle pour ecrire le repli de la console, qui
 * est donc la meme reponse, figee.
 */
export const consoleApi = Router();

type Origine = "physio" | "conversation" | "chute" | "usage" | "manuel";

export interface Ancre {
  jour: string;
  jour_vol: number;
}

/**
 * Le jour que la console tient pour « aujourd'hui » : celui de
 * `v_jour_courant`, pas l'horloge du poste.
 *
 * La base de demonstration est generee un jour donne et doit se lire pareil
 * le lendemain : une fenetre de quatorze jours comptee depuis `date('now')`
 * se videait de moitie en une semaine, et un age compte depuis l'horloge
 * vieillissait des residents dont aucune donnee n'avait bouge. Sans aucune
 * mesure en base, on retombe sur le jour du poste et sur `JOUR_VOL`.
 */
export function ancre(): Ancre {
  return (
    requete<Ancre>("SELECT jour, jour_vol FROM v_jour_courant")[0] ?? {
      jour: requete<{ j: string }>("SELECT date('now') AS j")[0]!.j,
      jour_vol: config.jourVol,
    }
  );
}

/**
 * L'age en annees revolues, au jour courant. SQLite n'a pas de fonction
 * d'age : on soustrait les annees, moins un si l'anniversaire n'est pas
 * encore passe. Pas (jours / 365,25) : le jour anniversaire, ce quotient
 * tombe juste sous l'entier, et un resident ne il y a 34 ans jour pour jour
 * en affichait 33.
 */
const AGE = `(CAST(strftime('%Y', :ancre) AS INTEGER)
              - CAST(strftime('%Y', r.date_naissance) AS INTEGER)
              - (strftime('%m-%d', :ancre) < strftime('%m-%d', r.date_naissance)))`;

/**
 * Le jour de vol d'un horodatage. `signaux` n'en porte pas : on le compte
 * depuis le jour courant, dont on connait la date et le jour de vol. Appele
 * avec des noms de colonne ecrits ici, jamais avec une valeur recue.
 */
const jourVolDe = (colonne: string) =>
  `:ancre_vol - CAST(ROUND(julianday(:ancre) - julianday(date(${colonne}))) AS INTEGER)`;

/** Ordre de gravite. SQLite n'a pas FIELD() : un CASE fait la meme chose. */
const ORDRE_SEVERITE = `
  CASE s.severite WHEN 'critique' THEN 1 WHEN 'surveillance' THEN 2 ELSE 3 END`;

/**
 * Les signaux se lisent du plus recent au plus ancien, sur les trois ecrans.
 * L'identifiant departage deux signaux de la meme seconde : sans lui, leur
 * ordre changerait d'une relecture a l'autre.
 */
const PLUS_RECENT = "s.ouvert_at DESC, s.id DESC";

/**
 * A qui revient un signal.
 *
 * Deux sources pour une seule colonne a l'ecran : la cle etrangere quand
 * c'est une personne, le texte libre quand ce n'en est pas une (« Equipe
 * d'intervention »). L'interface recoit un nom ou rien, et `assigne_id` pour
 * savoir si ce nom est celui du compte connecte.
 */
const ASSIGNE = "COALESCE(ma.titre || ' ' || ma.nom, s.assigne_a)";
const JOINTURE_ASSIGNE = "LEFT JOIN medecins ma ON ma.id = s.assigne_id";

// --------------------------------------------------- motifs de cloture ------
/**
 * Les motifs de cloture proposes, selon l'origine du signal.
 *
 * Le motif sert a mesurer le moteur de regles : un « Faux positif » compte ce
 * qu'une regle a declenche a tort, par origine. Il doit donc nommer une
 * erreur que CETTE origine peut commettre — un « artefact de mesure » ne veut
 * rien dire pour un signal ne d'une conversation, ou rien n'est mesure. Un
 * signal ouvert a la main n'a pas de faux positif : aucune regle ne l'a
 * declenche.
 */
const ISSUES = [
  "Orienté vers la psychologie de bord",
  "Traitement ajusté, suivi programmé",
  "Entretien réalisé, retour à la normale",
];

export const MOTIFS_CLOTURE: Record<Origine, string[]> = {
  physio: ["Faux positif : artefact de mesure confirmé", ...ISSUES],
  conversation: ["Faux positif : propos mal interprétés", ...ISSUES],
  usage: ["Faux positif : hausse d'usage expliquée par le contexte", ...ISSUES],
  chute: [
    "Faux positif : bracelet tombé ou choc sans chute",
    "Intervention réalisée, sans blessure",
    "Blessure prise en charge à l'infirmerie",
  ],
  manuel: ISSUES,
};

const estFauxPositif = (motif: string | null) => Boolean(motif?.startsWith("Faux positif"));

/**
 * Un signal clos avec un motif que son origine ne propose pas : le jeu de
 * demonstration en compte, clos avant que les motifs dependent de l'origine.
 * Ils faussent le taux de faux positifs, et l'ecran 04 les montre.
 */
const motifARevoir = (origine: Origine, motif: string | null) =>
  !motif || !(MOTIFS_CLOTURE[origine] ?? []).includes(motif);

// ------------------------------------------------------------- comptes ------
/**
 * Les gestes de soin — prendre un signal, le clore, signer une note — sont
 * ceux d'un soignant. Un administrateur entre dans la console pour constater
 * ce que la base contient ; il y lit tout et n'y ecrit rien, ce qui garde a
 * chaque ecriture le nom d'un soignant.
 */
function soignant(res: Response): Compte | null {
  const c = compte(res);
  if (c?.role === "medecin") return c;
  res.status(403).json({
    erreur: "Réservé aux comptes soignants : un administrateur lit la console, il n'y écrit pas.",
  });
  return null;
}

/** Les signaux a traiter : tous ceux qui ne sont pas clos. */
function compterATraiter() {
  return requete<{ ouverts: number; critiques: number; non_assignes: number }>(
    `SELECT COUNT(*) AS ouverts,
            COALESCE(SUM(severite = 'critique'), 0) AS critiques,
            COALESCE(SUM(assigne_a IS NULL AND assigne_id IS NULL), 0) AS non_assignes
       FROM signaux WHERE statut <> 'clos'`,
  )[0]!;
}

/**
 * Les signaux a traiter reduits a une empreinte : elle change quand un signal
 * s'ouvre, se prend ou se clot, quel que soit le programme qui l'ecrit. L'ecran
 * 02 la relit toutes les cinq secondes et ne recharge /crew que quand elle a
 * bouge : relire /crew a ce rythme recalculerait toutes ses vues pour rien.
 */
function empreinteFile(): string {
  const lignes = requete(
    `SELECT id, statut, assigne_id, assigne_a
       FROM signaux WHERE statut <> 'clos'
      ORDER BY id`,
  );
  return createHash("sha1").update(JSON.stringify(lignes)).digest("hex").slice(0, 16);
}

// ------------------------------------------------------- ecran 02 : equipage
export function lireCrew() {
  const a = ancre();
  const depistage = requete("SELECT * FROM v_depistage_jour")[0] ?? null;

  // Toute la serie : les trois periodes de l'ecran (semaine, mois, annee) se
  // decoupent dedans cote interface, plutot que de faire trois allers-retours.
  const serie = requete(
    `SELECT jour, jour_vol, indice, pct_phq9, pct_gad7, pct_isi, residents
       FROM v_depistage_serie
      ORDER BY jour`,
  );

  const residents =
    requete<{ n: number }>("SELECT COUNT(*) AS n FROM residents")[0]?.n ?? 0;

  const synchro =
    requete<{ dernier: string | null }>("SELECT MAX(synchro_at) AS dernier FROM bracelets")[0]
      ?.dernier ?? null;

  // Par pourcentage et non par nombre : un module de 119 personnes avec 11
  // signaux va plus mal qu'un module de 280 qui en compte 18.
  const modules = requete("SELECT * FROM v_signaux_module ORDER BY pct_residents DESC");

  const motifs = requete("SELECT * FROM v_motifs_30j ORDER BY conversations DESC LIMIT 6");

  // Le nombre d'echanges, que la somme des barres ne donne pas : un echange
  // peut porter deux motifs.
  const conversations30j =
    requete<{ conversations: number }>("SELECT conversations FROM v_conversations_30j")[0]
      ?.conversations ?? 0;

  const physio = requete("SELECT libelle, pct FROM v_alertes_physio ORDER BY ordre");

  // La file : la plus recente d'abord, quelle que soit sa gravite, que chaque
  // ligne affiche. Huit lignes, le reste est a un clic dans le registre, et
  // les compteurs d'en-tete portent sur tous les signaux a traiter.
  const triage = requete(
    `SELECT s.id, s.severite, s.origine, s.motif, s.statut,
            r.code AS resident, r.prenom, r.nom, r.cabine,
            ${AGE} AS age,
            s.ouvert_at,
            ${jourVolDe("s.ouvert_at")} AS ouvert_jour_vol,
            ${ASSIGNE} AS assigne_a, s.assigne_id
       FROM signaux s
       JOIN residents r ON r.id = s.resident_id
       ${JOINTURE_ASSIGNE}
      WHERE s.statut <> 'clos'
      ORDER BY ${PLUS_RECENT}
      LIMIT 8`,
    { ancre: a.jour, ancre_vol: a.jour_vol },
  );

  return {
    vaisseau: { nom: "Projet Odyssée", residents, jour_vol: a.jour_vol, synchro_at: synchro },
    ancre: a,
    depistage,
    serie,
    modules,
    motifs,
    conversations_30j: conversations30j,
    physio,
    triage,
    // Sur TOUS les signaux a traiter, pas sur les huit servis.
    compteurs: compterATraiter(),
  };
}

// L'empreinte part avec la file qu'elle decrit : l'ecran compare la suivante a
// celle-ci, pas a sa premiere relecture, ou un signal ouvert entre les deux
// passerait pour l'etat de depart. Prise avant la file : si un signal
// s'intercale, l'empreinte est en retard sur la file et l'ecran recharge une
// fois de trop, au lieu de le manquer. Hors de `lireCrew`, qui ecrit le repli :
// une valeur qui change avec la base n'a rien a faire dans un fichier commite.
consoleApi.get("/crew", (_req, res, next) => {
  try {
    const empreinte = empreinteFile();
    res.json({ ...lireCrew(), empreinte });
  } catch (e) {
    next(e);
  }
});

consoleApi.get("/crew/empreinte", (_req, res, next) => {
  try {
    res.json({ empreinte: empreinteFile() });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------ ecran 03 : fiche resident
export function lireResident(code: string) {
  const a = ancre();

  const resident = requete<{ id: number }>(
    `SELECT r.id, r.code, r.prenom, r.nom, r.poste, r.cabine,
            r.groupe_sanguin, r.statut, r.embarque_jour_vol,
            ${AGE} AS age,
            c.code AS confiance_code, c.prenom AS confiance_prenom,
            c.nom  AS confiance_nom,  c.cabine AS confiance_cabine,
            r.confiance_lien,
            m.code AS traitant_code,  m.titre  AS traitant_titre,
            m.prenom AS traitant_prenom, m.nom AS traitant_nom
       FROM residents r
       LEFT JOIN residents c ON c.id = r.confiance_id
       LEFT JOIN medecins  m ON m.id = r.medecin_traitant_id
      WHERE r.code = :code`,
    { code, ancre: a.jour },
  )[0];

  if (!resident) return null;
  const id = resident.id;

  const bracelet =
    requete(
      `SELECT serie, firmware, batterie_pct, synchro_at
         FROM bracelets WHERE resident_id = :id LIMIT 1`,
      { id },
    )[0] ?? null;

  // Quatorze jours qui finissent au jour courant — ou plus tard, si ce
  // resident a deja une ligne au-dela : un db:rollup lance pour un seul
  // bracelet ne deplace pas le jour de l'equipage, mais sa fiche doit le
  // montrer. Un bracelet muet laisse des jours vides en fin de fenetre au
  // lieu de la faire reculer jusqu'a sa derniere mesure.
  const fenetre = requete<{ debut: string; fin: string; debut_jour_vol: number; fin_jour_vol: number }>(
    `SELECT date(f.fin, '-13 days') AS debut, f.fin,
            f.fin_jour_vol - 13 AS debut_jour_vol, f.fin_jour_vol
       FROM (SELECT j.fin,
                    :ancre_vol + CAST(ROUND(julianday(j.fin) - julianday(:ancre)) AS INTEGER)
                      AS fin_jour_vol
               FROM (SELECT MAX(:ancre, COALESCE(MAX(jour), :ancre)) AS fin
                       FROM mesures_jour WHERE resident_id = :id) j) f`,
    { id, ancre: a.jour, ancre_vol: a.jour_vol },
  )[0]!;
  const bornes = { id, debut: fenetre.debut, fin: fenetre.fin };

  const constantes = requete(
    `SELECT jour, jour_vol, fc_repos_bpm, rmssd_ms, spo2_pct, resp_min,
            temp_c, eda_us, pas, source
       FROM mesures_jour
      WHERE resident_id = :id AND jour BETWEEN :debut AND :fin
      ORDER BY jour`,
    bornes,
  );

  // `nuit_du` est la date du lever : la nuit du 22 au 23 compte pour le 23,
  // comme les constantes de ce jour-la.
  const nuits = requete(
    `SELECT nuit_du, jour_vol, sommeil_min, latence_min, eveils_min, source
       FROM nuits
      WHERE resident_id = :id AND nuit_du BETWEEN :debut AND :fin
      ORDER BY nuit_du`,
    bornes,
  );

  const evenements = requete(
    `SELECT date(survenu_at) AS jour, type, COUNT(*) AS n
       FROM evenements
      WHERE resident_id = :id
        AND survenu_at >= :debut AND survenu_at < date(:fin, '+1 day')
      GROUP BY date(survenu_at), type`,
    bornes,
  );

  // Les signaux encore ouverts : c'est souvent pour l'un d'eux que la fiche
  // est ouverte. Avec eux, les motifs que leur origine propose a la cloture.
  const signaux = requete<{ origine: Origine }>(
    `SELECT s.id, s.severite, s.origine, s.motif, s.ouvert_at, s.statut,
            ${jourVolDe("s.ouvert_at")} AS ouvert_jour_vol,
            ${ASSIGNE} AS assigne_a, s.assigne_id
       FROM signaux s
       ${JOINTURE_ASSIGNE}
      WHERE s.resident_id = :id AND s.statut <> 'clos'
      ORDER BY ${PLUS_RECENT}`,
    { id, ancre: a.jour, ancre_vol: a.jour_vol },
  ).map((s) => ({ ...s, motifs_cloture: MOTIFS_CLOTURE[s.origine] ?? [] }));

  // Les resumes qui ont franchi un seuil, en entier. Il n'y a rien d'autre a
  // servir : le verbatim n'est pas dans cette base.
  const conversations = requete<{ tags: string }>(
    `SELECT c.id, c.debut_at, c.jour_vol, c.duree_min, c.severite, c.resume,
            c.actions_proposees, c.actions_acceptees, c.resident_notifie_at,
            (SELECT json_group_array(t.tag)
               FROM conversation_tags t
              WHERE t.conversation_id = c.id) AS tags
       FROM conversations c
      WHERE c.resident_id = :id AND c.remontee_auto = 1
      ORDER BY c.debut_at DESC
      LIMIT 20`,
    { id },
  ).map((c) => ({ ...c, tags: JSON.parse(c.tags ?? "[]") as string[] }));

  // Ceux qui sont remontes pour contexte : l'en-tete seulement. Sous le
  // seuil, le resume n'a pas a s'afficher ; ce qui compte ici est qu'il
  // existe, et si le resident a ete prevenu de son depart.
  const contexte = requete<{ tags: string }>(
    `SELECT c.id, c.debut_at, c.jour_vol, c.duree_min, c.severite,
            c.resident_notifie_at,
            (SELECT json_group_array(t.tag)
               FROM conversation_tags t
              WHERE t.conversation_id = c.id) AS tags
       FROM conversations c
      WHERE c.resident_id = :id AND c.remontee_auto = 0
      ORDER BY c.debut_at DESC
      LIMIT 5`,
    { id },
  ).map((c) => ({ ...c, tags: JSON.parse(c.tags ?? "[]") as string[] }));

  const compteConversations = requete<{ total: number; remontees: number; contexte: number }>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(remontee_auto = 1), 0) AS remontees,
            COALESCE(SUM(remontee_auto = 0), 0) AS contexte
       FROM conversations WHERE resident_id = :id`,
    { id },
  )[0]!;

  // L'auteur voyage avec la note : c'est tout l'objet de la table
  // `medecins`. `auteur` reste nul pour les notes anterieures aux comptes,
  // et l'interface l'ecrit ainsi plutot que d'inventer un nom.
  const particularites = requete(
    `SELECT p.id, p.type, p.niveau, p.titre, p.detail, p.constate_le,
            CASE WHEN m.id IS NULL THEN NULL
                 ELSE m.titre || ' ' || m.nom END AS auteur
       FROM particularites p
       LEFT JOIN medecins m ON m.id = p.auteur_id
      WHERE p.resident_id = :id
      ORDER BY CASE p.niveau
                 WHEN 'critique' THEN 1 WHEN 'surveillance' THEN 2 ELSE 3
               END, p.id`,
    { id },
  );

  // --------------------------------------------------- bilans sanguins --
  // Les trois derniers, soit six semaines au rythme d'une consultation tous
  // les quinze jours : de quoi voir une ferritine remonter sous traitement.
  const bilans = requete<{ id: number }>(
    `SELECT b.id, b.preleve_le, b.jour_vol, b.prochain_le, b.statut,
            b.commentaire, b.source,
            CAST(ROUND(julianday(b.prochain_le) - julianday(:ancre)) AS INTEGER)
              AS prochain_dans_j,
            CASE WHEN m.id IS NULL THEN NULL
                 ELSE m.titre || ' ' || m.nom END AS medecin
       FROM bilans_sanguins b
       LEFT JOIN medecins m ON m.id = b.medecin_id
      WHERE b.resident_id = :id
      ORDER BY b.preleve_le DESC
      LIMIT 3`,
    { id, ancre: a.jour },
  );

  // Les analyses des memes bilans, en une requete : la sous-requete rejoue
  // la selection ci-dessus plutot que de fabriquer une liste d'identifiants
  // dans le SQL.
  const analyses = requete<{ bilan_id: number }>(
    `SELECT a.bilan_id, a.panel, a.marqueur, a.valeur_num, a.valeur_texte,
            a.unite, a.ref_bas, a.ref_haut, a.interpretation
       FROM analyses_sang a
       JOIN (SELECT id FROM bilans_sanguins
              WHERE resident_id = :id
              ORDER BY preleve_le DESC LIMIT 3) d ON d.id = a.bilan_id
      ORDER BY a.bilan_id DESC, a.panel, a.id`,
    { id },
  );

  const parBilan = new Map<number, typeof analyses>();
  for (const x of analyses) {
    const liste = parBilan.get(x.bilan_id);
    if (liste) liste.push(x);
    else parBilan.set(x.bilan_id, [x]);
  }

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

  return {
    ancre: a,
    fenetre,
    resident,
    bracelet,
    constantes,
    nuits,
    evenements,
    signaux,
    conversations,
    contexte,
    conversations_compte: compteConversations,
    particularites,
    suivis,
    bilans: bilans.map((b) => ({ ...b, analyses: parBilan.get(b.id) ?? [] })),
  };
}

consoleApi.get("/residents/:code", (req, res, next) => {
  try {
    const fiche = lireResident(req.params.code);
    if (!fiche) {
      res.status(404).json({ erreur: `Resident inconnu : ${req.params.code}` });
      return;
    }
    res.json(fiche);
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
              m.evalue_le, m.score_moral, m.phq9, m.gad7, m.isi
         FROM residents r
         LEFT JOIN constantes c ON c.resident_id = r.id AND c.rang = 1
         LEFT JOIN nuit       n ON n.resident_id = r.id AND n.rang = 1
         LEFT JOIN mental     m ON m.resident_id = r.id AND m.rang = 1
         LEFT JOIN ouverts    o ON o.resident_id = r.id
         ${filtre}
        ORDER BY ${ordre(TRIS_EQUIPAGE, req.query.tri, req.query.sens, "ordre_statut")}, r.code
        LIMIT :taille OFFSET :decalage`,
      { ...params, taille, decalage, ancre: ancre().jour },
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

// ------------------------------------------------ ecran 04 : registre signaux
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
  assigne: "assigne_a",
  statut: "ordre_statut",
  clos: "s.clos_at",
  cloture: "s.clos_motif",
};

consoleApi.get("/signaux", (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const severite = String(req.query.severite ?? "").trim();
    // Sans précision, ce qui reste à traiter. `statut=tout` ouvre l'historique,
    // `statut=clos` ne garde que lui.
    const statut = String(req.query.statut ?? "").trim();
    const ouvertsSeuls = statut === "" ? 1 : 0;
    const sansPersonne = req.query.sans_personne === "1" ? 1 : 0;
    const { taille, page, decalage } = pagination(req.query as Record<string, unknown>);
    const a = ancre();

    const filtre = `
      WHERE (:q = ''
             OR r.code   LIKE '%' || :q || '%'
             OR r.nom    LIKE '%' || :q || '%'
             OR r.prenom LIKE '%' || :q || '%'
             OR s.motif  LIKE '%' || :q || '%')
        AND (:severite = '' OR s.severite = :severite)
        AND (:ouverts_seuls = 0 OR s.statut <> 'clos')
        AND (:statut IN ('', 'tout') OR s.statut = :statut)
        AND (:sans_personne = 0 OR (s.assigne_id IS NULL AND s.assigne_a IS NULL))`;

    const params = {
      q,
      severite,
      statut,
      ouverts_seuls: ouvertsSeuls,
      sans_personne: sansPersonne,
    };

    const total =
      requete<{ n: number }>(
        `SELECT COUNT(*) AS n FROM signaux s JOIN residents r ON r.id = s.resident_id ${filtre}`,
        params,
      )[0]?.n ?? 0;

    const lignes = requete<{ origine: Origine; statut: string; clos_motif: string | null }>(
      `SELECT s.id, s.severite, s.motif, s.origine, s.ouvert_at,
              ${jourVolDe("s.ouvert_at")} AS ouvert_jour_vol,
              ${ASSIGNE} AS assigne_a, s.assigne_id,
              s.statut, s.clos_at, s.clos_motif,
              CASE WHEN s.clos_at IS NULL THEN NULL
                   ELSE ${jourVolDe("s.clos_at")} END AS clos_jour_vol,
              r.code AS resident, r.prenom, r.nom, r.cabine,
              SUBSTR(r.cabine, 1, 1) AS module,
              ${AGE} AS age,
              ${ORDRE_SEVERITE} AS ordre_severite,
              CASE s.statut WHEN 'ouvert' THEN 1 WHEN 'en_cours' THEN 2 ELSE 3 END AS ordre_statut
         FROM signaux s
         JOIN residents r ON r.id = s.resident_id
         ${JOINTURE_ASSIGNE}
         ${filtre}
        ORDER BY ${ordre(TRIS_SIGNAUX, req.query.tri, req.query.sens, "s.ouvert_at")},
                 ${PLUS_RECENT}
        LIMIT :taille OFFSET :decalage`,
      { ...params, taille, decalage, ancre: a.jour, ancre_vol: a.jour_vol },
    ).map((l) => ({
      ...l,
      motif_a_revoir: l.statut === "clos" && motifARevoir(l.origine, l.clos_motif),
    }));

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

/**
 * Ce que disent les signaux clos du moteur de regles : combien de faux
 * positifs par origine, et combien de clotures portent un motif que leur
 * origine ne propose pas.
 *
 * L'en-tete de l'ecran 04 s'en sert aussi : l'effectif et le jour courant y
 * voyagent, plutot que d'ouvrir une route pour deux nombres.
 */
consoleApi.get("/signaux/stats", (_req, res, next) => {
  try {
    const clos = requete<{ origine: Origine; clos_motif: string | null; n: number }>(
      `SELECT origine, clos_motif, COUNT(*) AS n
         FROM signaux WHERE statut = 'clos'
        GROUP BY origine, clos_motif`,
    );

    const parOrigine = new Map<Origine, { origine: Origine; clos: number; faux_positifs: number }>();
    let total = 0;
    let aRevoir = 0;
    for (const l of clos) {
      const o = parOrigine.get(l.origine) ?? { origine: l.origine, clos: 0, faux_positifs: 0 };
      o.clos += l.n;
      if (estFauxPositif(l.clos_motif)) o.faux_positifs += l.n;
      parOrigine.set(l.origine, o);
      total += l.n;
      if (motifARevoir(l.origine, l.clos_motif)) aRevoir += l.n;
    }

    res.json({
      ancre: ancre(),
      residents: requete<{ n: number }>("SELECT COUNT(*) AS n FROM residents")[0]?.n ?? 0,
      a_traiter: compterATraiter(),
      clos: {
        total,
        faux_positifs: [...parOrigine.values()].reduce((n, o) => n + o.faux_positifs, 0),
        a_revoir: aRevoir,
        par_origine: [...parOrigine.values()].sort((x, y) => y.clos - x.clos),
      },
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------- gestes : prendre et clore ---
interface Signal {
  id: number;
  resident_id: number;
  origine: Origine;
  statut: string;
  assigne_id: number | null;
  assigne_a: string | null;
  clos_at: string | null;
  clos_motif: string | null;
}

function lireSignal(id: number): Signal | undefined {
  return requete<Signal>(
    `SELECT s.id, s.resident_id, s.origine, s.statut, s.assigne_id,
            ${ASSIGNE} AS assigne_a, s.clos_at, s.clos_motif
       FROM signaux s
       ${JOINTURE_ASSIGNE}
      WHERE s.id = :id`,
    { id },
  )[0];
}

/**
 * Prendre un signal, ou le clore.
 *
 *   { "geste": "prendre" }                 l'assigne au compte connecte
 *   { "geste": "clore", "motif": "…" }     le clot, avec un motif de son origine
 *
 * Prendre ne vole personne : l'UPDATE ne touche qu'un signal sans soignant ou
 * deja au compte connecte, et deux medecins qui cliquent en meme temps
 * trouvent l'un 200, l'autre 409 avec le nom de celui qui l'a eu.
 */
consoleApi.patch("/signaux/:id", (req, res, next) => {
  try {
    const moi = soignant(res);
    if (!moi) return;

    const id = Number(req.params.id);
    const signal = Number.isInteger(id) && id > 0 ? lireSignal(id) : undefined;
    if (!signal) {
      res.status(404).json({ erreur: `Signal inconnu : ${req.params.id}` });
      return;
    }
    if (signal.statut === "clos") {
      res.status(409).json({ erreur: "Ce signal est déjà clos." });
      return;
    }

    const { geste, motif } = (req.body ?? {}) as { geste?: unknown; motif?: unknown };

    if (geste === "prendre") {
      const { changes } = ecrire(
        `UPDATE signaux
            SET assigne_id = :moi, assigne_a = NULL, statut = 'en_cours'
          WHERE id = :id AND statut <> 'clos'
            AND ((assigne_id IS NULL AND assigne_a IS NULL) OR assigne_id = :moi)`,
        { id, moi: moi.id },
      );
      const apres = lireSignal(id)!;
      if (!changes) {
        res.status(409).json({
          erreur:
            apres.statut === "clos"
              ? "Ce signal vient d'être clos."
              : `Déjà pris par ${apres.assigne_a ?? "quelqu'un d'autre"}.`,
          signal: apres,
        });
        return;
      }
      res.json({ signal: apres });
      return;
    }

    if (geste === "clore") {
      const motifs = MOTIFS_CLOTURE[signal.origine] ?? [];
      if (typeof motif !== "string" || !motifs.includes(motif)) {
        res.status(422).json({ erreur: "Motif de clôture inconnu pour ce signal.", motifs });
        return;
      }

      // La cloture et le statut du resident vont ensemble : un resident dont
      // le dernier signal est clos ne doit pas rester en surveillance, meme
      // une seconde.
      const statutResident = transaction(() => {
        const { changes } = ecrire(
          `UPDATE signaux
              SET statut = 'clos', clos_at = :maintenant,
                  clos_motif = :motif, assigne_id = :moi, assigne_a = NULL
            WHERE id = :id AND statut <> 'clos'`,
          { id, motif, moi: moi.id, maintenant: heureDeBord() },
        );
        if (!changes) return null;
        recalculerStatut(signal.resident_id);
        return (
          requete<{ statut: string }>("SELECT statut FROM residents WHERE id = :rid", {
            rid: signal.resident_id,
          })[0]?.statut ?? null
        );
      });

      if (statutResident === null) {
        res.status(409).json({ erreur: "Ce signal vient d'être clos.", signal: lireSignal(id) });
        return;
      }
      res.json({ signal: lireSignal(id), statut_resident: statutResident });
      return;
    }

    res.status(422).json({ erreur: "geste doit valoir prendre ou clore." });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------- ecran 03 : ajout d'une note de soin ---
/**
 * Ajout d'une note de particularite, depuis la fiche.
 *
 * La note est SIGNEE : `auteur_id` vient de la session, jamais du corps de la
 * requete — sinon n'importe quel appelant choisirait au nom de qui il ecrit.
 * Un administrateur n'en ecrit pas : toute note ajoutee porte un soignant, et
 * seules celles d'avant les comptes restent « non signees ».
 */
const ajouterParticularite: RequestHandler = (req, res, next) => {
  try {
    const auteur = soignant(res);
    if (!auteur) return;

    const { type, niveau } = req.body ?? {};
    const titre = String(req.body?.titre ?? "").trim();
    const detail = String(req.body?.detail ?? "").trim();

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
    // Une note se lit d'un coup d'oeil avant un soin : au-dela, c'est un
    // compte rendu, et il a sa place ailleurs.
    if (titre.length > 120 || detail.length > 1000) {
      res.status(422).json({ erreur: "Titre : 120 caractères au plus, détail : 1 000." });
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
      `INSERT INTO particularites
         (resident_id, type, niveau, titre, detail, constate_le, auteur_id)
       VALUES (:rid, :type, :niveau, :titre, :detail, date('now'), :auteur)`,
      { rid: cible.id, type, niveau, titre, detail, auteur: auteur.id },
    );

    res.status(201).json({ id: lastInsertRowid });
  } catch (e) {
    next(e);
  }
};

consoleApi.post("/residents/:code/particularites", ajouterParticularite);
