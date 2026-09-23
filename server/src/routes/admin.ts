import { Router } from "express";
import { config } from "../config.js";
import { db, ecrire, requete } from "../db.js";
import { ajouterParticularite } from "./console.js";

/**
 * Backoffice.
 *
 * Ce que la console medicale ne fait pas : regarder la base elle-meme. Le
 * backoffice sert a deux choses pendant le workshop —
 *
 *   1. verifier que chaque bloc de l'interface vient bien d'une requete
 *      (route `/admin/ecrans`, qui met les deux en vis-a-vis) ;
 *   2. corriger une donnee sans ouvrir un client SQL : reassigner un signal,
 *      changer le statut d'un resident, ajouter une allergie.
 *
 * Il est volontairement separe de `/api` : la console est un outil de soin,
 * le backoffice un outil d'exploitation. Ils n'ont ni le meme public ni les
 * memes droits, donc ni le meme jeton.
 */
export const adminApi = Router();

const AGE = "CAST((julianday('now') - julianday(r.date_naissance)) / 365.25 AS INTEGER)";

// Tables que le backoffice accepte d'afficher en brut. Liste blanche, et non
// liste noire : un nom de table venant du client n'est jamais interpole dans
// du SQL sans etre passe par ici.
//
// `medecins`, `admins` et `sessions` n'y sont PAS, et c'est deliberé : cette
// route fait un `SELECT *`, qui servirait les empreintes de mots de passe et
// les empreintes de cookies a l'ecran. Les comptes se consultent par
// /admin/comptes, qui choisit ses colonnes.
const TABLES = [
  "residents", "bracelets", "particularites", "suivis", "mesures",
  "mesures_jour", "nuits", "etat_mental", "conversations",
  "conversation_tags", "signaux", "evenements",
  "bilans_sanguins", "analyses_sang",
];

// --------------------------------------------------------------- apercu ---
adminApi.get("/apercu", (_req, res, next) => {
  try {
    const tables = TABLES.map((nom) => ({
      nom,
      lignes: requete<{ n: number }>(`SELECT COUNT(*) AS n FROM "${nom}"`)[0]?.n ?? 0,
    }));

    const depistage = requete("SELECT * FROM v_depistage_jour")[0] ?? null;

    const signaux = requete(
      `SELECT statut, severite, COUNT(*) AS n
         FROM signaux GROUP BY statut, severite`,
    );

    // Derniere donnee recue, par nature. C'est la question qu'on se pose en
    // premier quand un ecran parait fige : est-ce l'interface ou la base ?
    const fraicheur = requete(
      `SELECT 'mesures'       AS flux, MAX(mesure_at) AS dernier FROM mesures
       UNION ALL
       SELECT 'mesures_jour',        MAX(calcule_at)            FROM mesures_jour
       UNION ALL
       SELECT 'nuits',               MAX(created_at)            FROM nuits
       UNION ALL
       SELECT 'conversations',       MAX(debut_at)              FROM conversations
       UNION ALL
       SELECT 'signaux',             MAX(ouvert_at)             FROM signaux
       UNION ALL
       SELECT 'evenements',          MAX(survenu_at)            FROM evenements
       UNION ALL
       SELECT 'bilans_sanguins',     MAX(preleve_le)            FROM bilans_sanguins`,
    );

    res.json({
      base: config.dbFile,
      jour_vol: config.jourVol,
      tables,
      depistage,
      signaux,
      fraicheur,
    });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------- residents ---
adminApi.get("/residents", (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const module = String(req.query.module ?? "").trim();
    const statut = String(req.query.statut ?? "").trim();
    const limite = Math.min(Number(req.query.limite ?? 50) || 50, 200);
    const page = Math.max(Number(req.query.page ?? 0) || 0, 0);

    // Les filtres vides sont neutralises dans le SQL lui-meme plutot que par
    // concatenation de fragments : une requete, un plan, aucune chaine
    // assemblee a la main.
    const ou = `
      WHERE (:q = '' OR r.code LIKE '%' || :q || '%'
                    OR r.prenom LIKE '%' || :q || '%'
                    OR r.nom LIKE '%' || :q || '%'
                    OR r.cabine LIKE '%' || :q || '%')
        AND (:module = '' OR SUBSTR(r.cabine, 1, 1) = :module)
        AND (:statut = '' OR r.statut = :statut)`;

    const total =
      requete<{ n: number }>(`SELECT COUNT(*) AS n FROM residents r ${ou}`, {
        q,
        module,
        statut,
      })[0]?.n ?? 0;

    const lignes = requete(
      `SELECT r.id, r.code, r.prenom, r.nom, r.poste, r.cabine,
              SUBSTR(r.cabine, 1, 1) AS module, r.groupe_sanguin, r.statut,
              ${AGE} AS age,
              (SELECT COUNT(*) FROM signaux s
                WHERE s.resident_id = r.id AND s.statut <> 'clos') AS signaux,
              (SELECT score_moral FROM etat_mental e
                WHERE e.resident_id = r.id
                ORDER BY e.evalue_le DESC LIMIT 1) AS moral,
              (SELECT sommeil_min FROM nuits n
                WHERE n.resident_id = r.id
                ORDER BY n.nuit_du DESC LIMIT 1) AS sommeil_min
         FROM residents r
         ${ou}
        ORDER BY CASE r.statut
                   WHEN 'critique' THEN 1 WHEN 'surveillance' THEN 2 ELSE 3
                 END, r.code
        LIMIT :limite OFFSET :offset`,
      { q, module, statut, limite, offset: page * limite },
    );

    res.json({ total, page, limite, lignes });
  } catch (e) {
    next(e);
  }
});

adminApi.patch("/residents/:code", (req, res, next) => {
  try {
    const { statut, poste, cabine } = req.body ?? {};

    if (statut !== undefined && !["ok", "surveillance", "critique"].includes(statut)) {
      res.status(422).json({ erreur: "statut doit valoir ok, surveillance ou critique." });
      return;
    }
    if (cabine !== undefined && !/^[A-F]-\d{2,3}$/.test(String(cabine))) {
      res.status(422).json({
        erreur: "cabine doit ressembler a C-12 : le module est sa premiere lettre.",
      });
      return;
    }

    // COALESCE : un champ absent du corps n'ecrase pas la valeur en base.
    const { changes } = ecrire(
      `UPDATE residents
          SET statut = COALESCE(:statut, statut),
              poste  = COALESCE(:poste, poste),
              cabine = COALESCE(:cabine, cabine),
              updated_at = datetime('now')
        WHERE code = :code`,
      {
        code: req.params.code,
        statut: statut ?? null,
        poste: poste ?? null,
        cabine: cabine ?? null,
      },
    );

    if (changes === 0) {
      res.status(404).json({ erreur: `Resident inconnu : ${req.params.code}` });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- signaux ---
adminApi.get("/signaux", (req, res, next) => {
  try {
    const statut = String(req.query.statut ?? "ouverts");
    const limite = Math.min(Number(req.query.limite ?? 100) || 100, 500);

    const lignes = requete(
      `SELECT s.id, s.severite, s.motif, s.origine, s.ouvert_at,
              s.assigne_id,
              COALESCE(ma.titre || ' ' || ma.nom, s.assigne_a) AS assigne_a,
              s.statut, s.clos_at, s.clos_motif,
              r.code AS resident, r.prenom, r.nom, r.cabine, ${AGE} AS age
         FROM signaux s
         JOIN residents r ON r.id = s.resident_id
         LEFT JOIN medecins ma ON ma.id = s.assigne_id
        WHERE (:statut = 'tous'
               OR (:statut = 'ouverts' AND s.statut <> 'clos')
               OR s.statut = :statut)
        ORDER BY CASE s.severite
                   WHEN 'critique' THEN 1 WHEN 'surveillance' THEN 2 ELSE 3
                 END, s.ouvert_at DESC
        LIMIT :limite`,
      { statut, limite },
    );

    res.json({ lignes });
  } catch (e) {
    next(e);
  }
});

adminApi.patch("/signaux/:id", (req, res, next) => {
  try {
    const { assigne_a, assigne_id, statut, clos_motif } = req.body ?? {};

    if (statut !== undefined && !["ouvert", "en_cours", "clos"].includes(statut)) {
      res.status(422).json({ erreur: "statut doit valoir ouvert, en_cours ou clos." });
      return;
    }
    // Clore sans dire pourquoi, c'est perdre la seule information qui permet
    // plus tard de mesurer les faux positifs du moteur de regles.
    if (statut === "clos" && !clos_motif) {
      res.status(422).json({ erreur: "clos_motif est obligatoire pour clore un signal." });
      return;
    }

    // Assigner a une personne vide le texte libre, et reciproquement : les
    // deux colonnes decrivent la meme chose, elles ne doivent jamais se
    // contredire a l'ecran.
    const parId = assigne_id !== undefined;
    const parTexte = assigne_a !== undefined;

    const { changes } = ecrire(
      `UPDATE signaux
          SET assigne_id = CASE WHEN :par_id THEN :assigne_id
                                WHEN :par_texte THEN NULL
                                ELSE assigne_id END,
              assigne_a  = CASE WHEN :par_texte THEN :assigne
                                WHEN :par_id THEN NULL
                                ELSE assigne_a END,
              statut     = COALESCE(:statut, statut),
              clos_at    = CASE WHEN :statut = 'clos' THEN datetime('now') ELSE clos_at END,
              clos_motif = COALESCE(:clos_motif, clos_motif)
        WHERE id = :id`,
      {
        id: Number(req.params.id),
        // Distinguer « champ absent » de « vider l'assignation » : les deux
        // arrivent en JSON comme une valeur nulle ou manquante.
        par_id: parId ? 1 : 0,
        par_texte: parTexte ? 1 : 0,
        assigne_id: assigne_id ? Number(assigne_id) : null,
        assigne: assigne_a || null,
        statut: statut ?? null,
        clos_motif: clos_motif ?? null,
      },
    );

    if (changes === 0) {
      res.status(404).json({ erreur: "Signal inconnu." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- comptes ---
/**
 * Les comptes, sans leur empreinte.
 *
 * `mdp_hash` n'est jamais servi : aucune interface n'en a l'usage, et une
 * empreinte affichee est une empreinte copiee. La creation passe par
 * `npm run compte`, au terminal, donc physiquement a bord — c'est la reponse
 * la plus simple au probleme du premier compte, celui qu'aucun compte
 * existant ne peut creer.
 */
adminApi.get("/comptes", (_req, res, next) => {
  try {
    const lignes = requete(
      `SELECT 'medecin' AS role, id, code, titre, prenom, nom, poste, email,
              actif, cree_le, derniere_connexion,
              (SELECT COUNT(*) FROM particularites p WHERE p.auteur_id = medecins.id)
                AS notes_signees,
              (SELECT COUNT(*) FROM signaux s WHERE s.assigne_id = medecins.id
                 AND s.statut <> 'clos') AS signaux_ouverts
         FROM medecins
       UNION ALL
       SELECT 'admin', id, NULL, NULL, prenom, nom, 'Administration', email,
              actif, cree_le, derniere_connexion, 0, 0
         FROM admins
        ORDER BY role, nom`,
    );

    const sessions = requete<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sessions WHERE expire_at > datetime('now')",
    )[0];

    res.json({ lignes, sessions_ouvertes: sessions?.n ?? 0 });
  } catch (e) {
    next(e);
  }
});

/**
 * Activer ou desactiver un compte. On ne supprime pas : une note signee par
 * un soignant parti perdrait son auteur, et une note sans auteur est
 * exactement le probleme que ces tables sont venues regler.
 *
 * Desactiver ferme aussi les sessions en cours — `sessions.lire` exige
 * `actif = 1`, donc le navigateur retombe sur le formulaire au prochain appel.
 */
adminApi.patch("/comptes/:role/:id", (req, res, next) => {
  try {
    const role = req.params.role;
    if (role !== "medecin" && role !== "admin") {
      res.status(404).json({ erreur: "Role inconnu." });
      return;
    }
    const actif = req.body?.actif;
    if (actif !== true && actif !== false) {
      res.status(422).json({ erreur: "actif doit valoir true ou false." });
      return;
    }

    // Le nom de table n'est pas un parametre liable : il ne vient pas du
    // client, il est choisi ici entre deux valeurs litterales.
    const { changes } = ecrire(
      role === "medecin"
        ? "UPDATE medecins SET actif = :actif WHERE id = :id"
        : "UPDATE admins SET actif = :actif WHERE id = :id",
      // node:sqlite ne lie pas de booleen : la colonne est un INTEGER 0/1.
      { id: Number(req.params.id), actif: actif ? 1 : 0 },
    );

    if (changes === 0) {
      res.status(404).json({ erreur: "Compte inconnu." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// -------------------------------------------------------- particularites ---
// Meme handler que la console : une note ecrite par le backoffice et une note
// ecrite depuis la fiche produisent la meme ligne, validee pareil. Seule la
// porte differe — jeton admin ici, session medecin la-bas.
adminApi.post("/residents/:code/particularites", ajouterParticularite);

adminApi.delete("/particularites/:id", (req, res, next) => {
  try {
    const { changes } = ecrire("DELETE FROM particularites WHERE id = :id", {
      id: Number(req.params.id),
    });
    if (changes === 0) {
      res.status(404).json({ erreur: "Particularite inconnue." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------ inspection brute ---
adminApi.get("/tables/:nom", (req, res, next) => {
  try {
    const nom = req.params.nom;
    if (!TABLES.includes(nom)) {
      res.status(404).json({ erreur: `Table inconnue ou non exposee : ${nom}` });
      return;
    }
    const limite = Math.min(Number(req.query.limite ?? 50) || 50, 500);

    // Le nom de table ne peut pas etre un parametre lie en SQL. Il n'est
    // interpole qu'apres etre passe par la liste blanche ci-dessus.
    const colonnes = db
      .prepare(`PRAGMA table_info("${nom}")`)
      .all()
      .map((c) => (c as { name: string }).name);

    const lignes = requete(`SELECT * FROM "${nom}" ORDER BY rowid DESC LIMIT :limite`, {
      limite,
    });

    res.json({ nom, colonnes, lignes });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------- ecrans <-> requetes ---
/**
 * La table de correspondance entre ce qui s'affiche et ce qui la produit.
 *
 * Elle est ici, et pas dans un document, pour une raison simple : un document
 * se desynchronise en silence, une route se teste. Le backoffice appelle
 * chaque source listee et affiche ce qu'elle renvoie a cote du nom du bloc.
 */
const ECRANS = [
  {
    ecran: "02 — Sante de l'equipage",
    blocs: [
      { bloc: "Indice de bien-etre", source: "v_depistage_jour.indice_bienetre", route: "GET /api/crew" },
      { bloc: "Depistage PHQ-9 >= 10", source: "v_depistage_jour.pct_phq9", route: "GET /api/crew" },
      { bloc: "Anxiete GAD-7 >= 10", source: "v_depistage_jour.pct_gad7", route: "GET /api/crew" },
      { bloc: "Sommeil ISI >= 15", source: "v_depistage_jour.pct_isi", route: "GET /api/crew" },
      { bloc: "Courbe de bien-etre", source: "v_bienetre_jour", route: "GET /api/crew" },
      { bloc: "Signaux par module", source: "v_signaux_module", route: "GET /api/crew" },
      { bloc: "Motifs de conversation", source: "v_motifs_30j", route: "GET /api/crew" },
      { bloc: "Alertes physiologiques", source: "v_alertes_physio", route: "GET /api/crew" },
      { bloc: "File de triage", source: "signaux JOIN residents", route: "GET /api/crew" },
    ],
  },
  {
    ecran: "03 — Fiche resident",
    blocs: [
      { bloc: "En-tete et statut", source: "residents", route: "GET /api/residents/:code" },
      { bloc: "Ligne bracelet", source: "bracelets", route: "GET /api/residents/:code" },
      { bloc: "Huit tuiles de constantes", source: "mesures_jour (14 j)", route: "GET /api/residents/:code" },
      { bloc: "Graphique de sommeil", source: "nuits (14 j)", route: "GET /api/residents/:code" },
      { bloc: "Resumes de conversation", source: "conversations + conversation_tags", route: "GET /api/residents/:code" },
      { bloc: "Particularites medicales", source: "particularites + medecins (auteur)", route: "GET /api/residents/:code" },
      { bloc: "Suivi en cours", source: "suivis", route: "GET /api/residents/:code" },
      { bloc: "Bilan sanguin", source: "bilans_sanguins + analyses_sang (3 derniers)", route: "GET /api/residents/:code" },
    ],
  },
  {
    ecran: "01 — Borne de cabine",
    blocs: [
      {
        bloc: "Conversation",
        source: "AUCUNE — le verbatim reste dans la borne, base separee",
        route: "POST /ingest/conversation (resume seul)",
      },
    ],
  },
];

adminApi.get("/ecrans", (_req, res, next) => {
  try {
    // On ne se contente pas de lister : on execute les vues pour que le
    // backoffice montre la valeur reelle a cote du nom du bloc.
    const valeurs = {
      depistage: requete("SELECT * FROM v_depistage_jour")[0] ?? null,
      bienetre: requete(
        `SELECT jour, jour_vol, indice, residents_evalues
           FROM v_bienetre_jour ORDER BY jour DESC LIMIT 12`,
      ),
      modules: requete("SELECT * FROM v_signaux_module ORDER BY pct_residents DESC"),
      motifs: requete("SELECT * FROM v_motifs_30j ORDER BY conversations DESC LIMIT 6"),
      physio: requete("SELECT ordre, libelle, pct FROM v_alertes_physio ORDER BY ordre"),
    };
    res.json({ ecrans: ECRANS, valeurs });
  } catch (e) {
    next(e);
  }
});
