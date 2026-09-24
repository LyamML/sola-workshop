import { Router } from "express";
import { compte } from "../auth.js";
import { config } from "../config.js";
import { db, ecrire, requete, residentId } from "../db.js";

/**
 * Backoffice : l'outil de l'administrateur de bord.
 *
 * Il repond a deux questions, et a elles seules : les flux arrivent-ils, et
 * qui a acces ? D'ou trois lectures —
 *
 *   1. `/admin/ecrans` : chaque bloc de la console, la source qui le remplit
 *      et ce qu'elle renvoie a l'instant ;
 *   2. `/admin/apercu` et `/admin/tables/:nom` : fraicheur des flux, volume
 *      des tables, dernieres lignes ecrites ;
 *   3. `/admin/comptes` : qui peut ouvrir quoi, et qui ne l'a jamais fait.
 *
 * Une seule ecriture : activer ou desactiver un compte. Aucun geste clinique
 * ici. Changer un statut, assigner ou clore un signal, ecrire une note, cela
 * se fait dans la console, sous la session du soignant qui en repond : une
 * correction de dossier sans nom de soignant, c'est exactement ce que les
 * comptes sont venus empecher.
 *
 * Separe de `/api` pour la meme raison : la console est un outil de soin, le
 * backoffice un outil d'exploitation, et `/admin` exige le role
 * administrateur.
 */
export const adminApi = Router();

// Tables que le backoffice accepte d'afficher en brut. Liste blanche, et non
// liste noire : un nom de table venant du client n'est jamais interpole dans
// du SQL sans etre passe par ici.
//
// `medecins`, `admins` et `sessions` n'y sont PAS, et c'est delibere : la
// lecture brute fait un `SELECT *`, qui servirait les empreintes de mots de
// passe et de cookies. Elles sont comptees, jamais parcourues ; les comptes se
// lisent par /admin/comptes, qui choisit ses colonnes.
const TABLES = [
  "residents", "bracelets", "particularites", "suivis", "mesures",
  "mesures_jour", "nuits", "etat_mental", "conversations",
  "conversation_tags", "signaux", "evenements",
  "bilans_sanguins", "analyses_sang",
];
const TABLES_COMPTES = ["medecins", "admins", "sessions"];

// ------------------------------------------------------------- formatage ---
// La valeur servie par /admin/ecrans est une phrase, pas un objet : la
// correspondance se lit d'un coup d'oeil, et une seule mise en forme vaut pour
// tous les blocs au lieu d'un cas par bloc dans l'interface.
//
// `toLocaleString` separe les milliers par une espace fine (U+202F) que les
// polices de bord ne dessinent pas ; la console la remplace par une insecable
// ordinaire, on fait de meme pour ecrire « 1 240 » comme elle.
const espaces = (t: string) => t.replace(/\u202f/g, "\u00a0");
const entier = (n: number) => espaces(n.toLocaleString("fr-FR"));
const decimal = (n: number) =>
  espaces(n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pct = (n: number) => `${decimal(n)}\u00a0%`;
const jourVol = (n: number) => `J+${entier(n)}`;
// Zero prend le singulier en francais : « 0 alerte ».
const pluriel = (n: number, singulier: string, forme = `${singulier}s`) =>
  `${entier(n)} ${n >= 2 ? forme : singulier}`;

/**
 * Le jour que la console tient pour « aujourd'hui », lu dans la meme vue
 * qu'elle : « J+4 128 » designe ici le meme jour que la-bas. JOUR_VOL ne sert
 * que tant que la base n'a aucun jour complet.
 */
function jourCourant(): { jour: string | null; jourVol: number } {
  try {
    const j = requete<{ jour: string; jour_vol: number }>(
      "SELECT jour, jour_vol FROM v_jour_courant",
    )[0];
    if (j) return { jour: j.jour, jourVol: j.jour_vol };
  } catch (e) {
    // Une base chargee avant la vue ne doit pas faire tomber l'onglet : le
    // reglage prend le relais, et le journal dit pourquoi.
    console.error("[sola] v_jour_courant illisible", e);
  }
  return { jour: null, jourVol: config.jourVol };
}

// ---------------------------------------------------------------- apercu ---
/**
 * « Les donnees arrivent-elles ? » : la fraicheur des flux, puis le volume de
 * chaque table.
 *
 * Les flux continus seulement. Une chute ou un bilan sanguin arrive quand il
 * arrive — quelques-uns par semaine, un bilan tous les quinze jours — et leur
 * silence ne dit rien d'une panne ; celui des mesures, si.
 */
adminApi.get("/apercu", (_req, res, next) => {
  try {
    // L'heure du fait (mesure, debut d'echange, synchro, ouverture) et non
    // `created_at` : une borne qui vide sa file apres une coupure ecrit
    // aujourd'hui les mesures d'hier, et c'est l'heure de la mesure qui dit
    // si le flux est a jour. Les deux agregats n'ont que leur heure de calcul.
    //
    // `retard_j` compare chaque flux au plus recent d'entre eux, en jours.
    // Calcule par SQLite, qui lit ses propres horodatages sans hesiter sur le
    // fuseau, la ou le navigateur les prendrait pour de l'heure locale.
    const fraicheur = requete(
      `WITH derniers (ordre, flux, dernier_jour_vol, derniere_ecriture) AS (
         SELECT 1, 'mesures',       NULL,          MAX(mesure_at)  FROM mesures
         UNION ALL
         SELECT 2, 'conversations', MAX(jour_vol), MAX(debut_at)   FROM conversations
         UNION ALL
         SELECT 3, 'bracelets',     NULL,          MAX(synchro_at) FROM bracelets
         UNION ALL
         SELECT 4, 'signaux',       NULL,          MAX(ouvert_at)  FROM signaux
         UNION ALL
         SELECT 5, 'mesures_jour',  MAX(jour_vol), MAX(calcule_at) FROM mesures_jour
         UNION ALL
         SELECT 6, 'nuits',         MAX(jour_vol), MAX(created_at) FROM nuits
       )
       SELECT flux, dernier_jour_vol, derniere_ecriture,
              ROUND(julianday((SELECT MAX(derniere_ecriture) FROM derniers))
                    - julianday(derniere_ecriture), 3) AS retard_j
         FROM derniers
        ORDER BY ordre`,
    );

    // sqlite_master ne sert qu'a savoir quelles tables existent : le nom
    // interpole dans le COUNT est celui de la liste ci-dessus, jamais celui
    // lu en base. Une table que la liste ne connait pas est montree sans
    // compte plutot qu'interpolee.
    const connues = [...TABLES, ...TABLES_COMPTES];
    const tables = requete<{ name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    ).map(({ name }) => {
      const nom = connues.find((t) => t === name);
      return {
        nom: name,
        lignes: nom
          ? (requete<{ n: number }>(`SELECT COUNT(*) AS n FROM "${nom}"`)[0]?.n ?? 0)
          : null,
        parcourable: TABLES.includes(name),
      };
    });

    res.json({ jour_vol: jourCourant().jourVol, fraicheur, tables });
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- comptes ---
/**
 * Les comptes, sans leur empreinte ni leur adresse.
 *
 * Colonnes choisies une a une, jamais `*` : `mdp_hash` n'a d'usage dans
 * aucune interface, et une empreinte affichee est une empreinte copiee.
 * L'adresse n'est pas servie non plus : c'est l'identifiant de connexion, la
 * moitie de ce qu'il faut pour ouvrir une session, et elle n'aide ni a
 * activer ni a desactiver un compte — le matricule suffit a le reconnaitre.
 *
 * La creation passe par `npm run compte`, au terminal, donc physiquement a
 * bord : c'est la reponse la plus simple au probleme du premier compte,
 * celui qu'aucun compte existant ne peut creer.
 */
adminApi.get("/comptes", (_req, res, next) => {
  try {
    const soignants = requete(
      `SELECT m.id, m.code, m.titre, m.prenom, m.nom, m.poste, m.actif,
              m.derniere_connexion,
              (SELECT COUNT(*) FROM signaux s
                WHERE s.assigne_id = m.id AND s.statut <> 'clos') AS signaux_ouverts,
              (SELECT COUNT(*) FROM particularites p
                WHERE p.auteur_id = m.id) AS notes_signees
         FROM medecins m
        ORDER BY m.code`,
    );

    // Dans l'ordre de creation : le premier compte, celui du terminal, en tete.
    const administrateurs = requete(
      `SELECT id, prenom, nom, actif, derniere_connexion
         FROM admins
        ORDER BY id`,
    );

    res.json({ soignants, administrateurs });
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
      res.status(404).json({ erreur: "Rôle inconnu." });
      return;
    }
    const actif = req.body?.actif;
    if (actif !== true && actif !== false) {
      res.status(422).json({ erreur: "actif doit valoir true ou false." });
      return;
    }
    const id = Number(req.params.id);

    // Se desactiver soi-meme fermerait sa propre session a la requete
    // suivante, et `npm run compte` ne sait pas reactiver : le dernier
    // administrateur actif fermerait la porte derriere lui, sans autre issue
    // qu'un UPDATE tape a la main. Un autre administrateur peut le faire.
    const moi = compte(res);
    if (!actif && role === "admin" && moi?.role === "admin" && moi.id === id) {
      res.status(409).json({
        erreur:
          "Votre propre compte ne se désactive pas d’ici\u00a0: un autre administrateur peut le faire.",
      });
      return;
    }

    // Le nom de table n'est pas un parametre liable : il ne vient pas du
    // client, il est choisi ici entre deux valeurs litterales.
    const { changes } = ecrire(
      role === "medecin"
        ? "UPDATE medecins SET actif = :actif WHERE id = :id"
        : "UPDATE admins SET actif = :actif WHERE id = :id",
      // node:sqlite ne lie pas de booleen : la colonne est un INTEGER 0/1.
      { id, actif: actif ? 1 : 0 },
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

// ------------------------------------------------------ inspection brute ---
adminApi.get("/tables/:nom", (req, res, next) => {
  try {
    const nom = req.params.nom;
    if (!TABLES.includes(nom)) {
      res.status(404).json({ erreur: `Table inconnue ou non exposée\u00a0: ${nom}` });
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

// ------------------------------------------------------ ecrans <-> sources ---

/** Le resident dont la fiche sert d'exemple : celui dont les maquettes racontent l'histoire. */
const TEMOIN = "R-0448";

interface Contexte {
  jour: string | null;
  jourVol: number;
  /** Identifiant interne du temoin, null s'il n'est pas en base. */
  temoin: number | null;
}

interface Bloc {
  bloc: string;
  source: string;
  /** Precision sur la source, quand son nom ne suffit pas. */
  note?: string;
  /**
   * Relit ce que la console affiche. Absent : la console ne lit rien en base
   * pour ce bloc. Null : la source ne renvoie rien, le bloc est du decor.
   */
  lire?: (c: Contexte) => string | null;
}

interface Ecran {
  ecran: string;
  aide: (c: Contexte) => string[];
  blocs: Bloc[];
}

/** Un bloc de la fiche : sans temoin en base, il n'y a rien a relire. */
const duTemoin =
  (lire: (id: number, c: Contexte) => string | null) =>
  (c: Contexte): string | null =>
    c.temoin === null ? null : lire(c.temoin, c);

/**
 * La table de correspondance entre ce qui s'affiche et ce qui le produit.
 *
 * Elle est ici, et pas dans un document, pour une raison simple : un document
 * se desynchronise en silence, une route se teste. Chaque bloc relit sa
 * source a l'appel, avec les memes vues que la console, et la route sert la
 * valeur a cote du nom du bloc — jamais un chiffre recopie d'une maquette.
 */
const ECRANS: Ecran[] = [
  {
    ecran: "01 — Borne de cabine",
    aide: () => ["POST /ingest/conversation · résumé seul", "POST /ingest/bracelet · trames"],
    blocs: [
      {
        bloc: "Conversation",
        source: "aucune",
        note: "le verbatim reste dans la borne, dans une base à part",
      },
    ],
  },
  {
    ecran: "02 — Santé de l’équipage",
    aide: () => ["GET /api/crew", "GET /api/crew/empreinte · toutes les 5 s"],
    blocs: [
      {
        bloc: "File de triage",
        source: "signaux JOIN residents, medecins",
        lire: () => {
          const f = requete<{ ouverts: number; sans_personne: number }>(
            `SELECT COUNT(*) AS ouverts,
                    COALESCE(SUM(assigne_id IS NULL AND assigne_a IS NULL), 0) AS sans_personne
               FROM signaux WHERE statut <> 'clos'`,
          )[0];
          return f
            ? `${pluriel(f.ouverts, "ouvert")} · ${entier(f.sans_personne)} sans personne`
            : null;
        },
      },
      {
        bloc: "Indicateurs",
        source: "v_depistage_jour",
        lire: () => {
          const d = requete<{
            residents: number;
            indice_bienetre: number | null;
            pct_phq9: number;
            pct_gad7: number;
            pct_isi: number;
          }>(
            "SELECT residents, indice_bienetre, pct_phq9, pct_gad7, pct_isi FROM v_depistage_jour",
          )[0];
          if (!d || d.residents === 0 || d.indice_bienetre === null) return null;
          return [decimal(d.indice_bienetre), pct(d.pct_phq9), pct(d.pct_gad7), pct(d.pct_isi)].join(
            " · ",
          );
        },
      },
      {
        bloc: "Courbe de tendance",
        source: "v_depistage_serie",
        lire: () => {
          const p = requete<{ jour_vol: number; indice: number }>(
            "SELECT jour_vol, indice FROM v_depistage_serie ORDER BY jour DESC LIMIT 1",
          )[0];
          return p ? `${decimal(p.indice)} au ${jourVol(p.jour_vol)}` : null;
        },
      },
      {
        bloc: "Motifs",
        source: "v_motifs_30j · v_conversations_30j",
        lire: (c) => {
          const motifs = requete<{ n: number }>("SELECT COUNT(*) AS n FROM v_motifs_30j")[0]?.n ?? 0;
          if (motifs === 0) return null;
          const echanges =
            requete<{ conversations: number }>("SELECT conversations FROM v_conversations_30j")[0]
              ?.conversations ?? 0;
          return `${pluriel(echanges, "échange")} · 30 j jusqu’au ${jourVol(c.jourVol)}`;
        },
      },
      {
        bloc: "Modules",
        source: "v_signaux_module",
        lire: () => {
          const m = requete<{ module: string; pct_residents: number }>(
            "SELECT module, pct_residents FROM v_signaux_module ORDER BY pct_residents DESC LIMIT 1",
          )[0];
          return m ? `${m.module} · ${pct(m.pct_residents)} en tête` : null;
        },
      },
      {
        bloc: "Physio",
        source: "v_alertes_physio",
        lire: (c) => {
          // Sans jour courant, la vue renvoie 0 % partout : ce serait un
          // chiffre, pas une mesure.
          if (c.jour === null) return null;
          const p = requete<{ libelle: string; pct: number }>(
            "SELECT libelle, pct FROM v_alertes_physio ORDER BY ordre LIMIT 1",
          )[0];
          return p ? `${jourVol(c.jourVol)} · ${p.libelle}\u00a0: ${pct(p.pct)} en tête` : null;
        },
      },
    ],
  },
  {
    ecran: "03 — Fiche résident",
    aide: (c) => [
      "GET /api/residents/:code",
      "GET /api/residents/:code/direct · toutes les 10 s",
      c.temoin === null ? `${TEMOIN} absent de la base` : `valeurs de ${TEMOIN}`,
    ],
    blocs: [
      {
        bloc: "Identité et bracelet",
        source: "residents · medecins · bracelets",
        lire: duTemoin((id) => {
          const b = requete<{ serie: string; batterie_pct: number | null }>(
            "SELECT serie, batterie_pct FROM bracelets WHERE resident_id = :id LIMIT 1",
            { id },
          )[0];
          if (!b) return "aucun bracelet appairé";
          return b.batterie_pct === null
            ? `${b.serie} · batterie inconnue`
            : `${b.serie} · ${entier(b.batterie_pct)}\u00a0%`;
        }),
      },
      {
        bloc: "À savoir avant tout soin",
        source: "particularites + medecins",
        lire: duTemoin((id) => {
          // Une alerte est ce que la fiche met en tete : critique ou surveillance.
          const p = requete<{ notes: number; alertes: number; infos: number }>(
            `SELECT COUNT(*) AS notes,
                    COALESCE(SUM(niveau IN ('critique', 'surveillance')), 0) AS alertes,
                    COALESCE(SUM(niveau = 'info'), 0) AS infos
               FROM particularites WHERE resident_id = :id`,
            { id },
          )[0];
          if (!p || p.notes === 0) return "aucune note";
          return `${pluriel(p.notes, "note")} · ${pluriel(p.alertes, "alerte")}, ${pluriel(p.infos, "information")}`;
        }),
      },
      {
        bloc: "Signal ouvert",
        source: "signaux",
        lire: duTemoin((id) => {
          const s = requete<{ ouverts: number; en_cours: number }>(
            `SELECT COALESCE(SUM(statut = 'ouvert'), 0)   AS ouverts,
                    COALESCE(SUM(statut = 'en_cours'), 0) AS en_cours
               FROM signaux WHERE resident_id = :id AND statut <> 'clos'`,
            { id },
          )[0];
          const ouverts = s?.ouverts ?? 0;
          const enCours = s?.en_cours ?? 0;
          const total = ouverts + enCours;
          if (total === 0) return "aucun";
          if (ouverts === 0) return `${entier(total)} · en cours`;
          if (enCours === 0) return `${entier(total)} · ${total >= 2 ? "ouverts" : "ouvert"}`;
          return `${entier(total)} · ${pluriel(ouverts, "ouvert")}, ${entier(enCours)} en cours`;
        }),
      },
      {
        bloc: "Constantes",
        source: "mesures_jour · nuits · evenements · 14 j",
        lire: duTemoin((id, c) => {
          // La fenetre de `lireResident`, a l'identique : quatorze jours qui
          // finissent au jour courant, ou au dernier jour du resident s'il est
          // plus tard ; l'horloge du poste seulement sans jour courant. Si la
          // console change de fenetre, cette requete doit la suivre. Une
          // tuile compte des qu'un jour de la fenetre la remplit.
          const t = requete<{ jours: number; tuiles: number }>(
            `WITH a AS (SELECT COALESCE(:ancre, date('now')) AS jour),
                  f AS (SELECT MAX(a.jour, COALESCE(MAX(m.jour), a.jour)) AS fin
                          FROM a LEFT JOIN mesures_jour m ON m.resident_id = :id)
             SELECT COUNT(*) AS jours,
                    (COUNT(fc_repos_bpm) > 0) + (COUNT(rmssd_ms) > 0) + (COUNT(spo2_pct) > 0)
                  + (COUNT(resp_min) > 0) + (COUNT(temp_c) > 0) + (COUNT(eda_us) > 0)
                  + (COUNT(pas) > 0) AS tuiles
               FROM mesures_jour, f
              WHERE resident_id = :id AND jour BETWEEN date(f.fin, '-13 days') AND f.fin`,
            { id, ancre: c.jour },
          )[0];
          if (!t || t.jours === 0) return null;
          // + 1 : la tuile des chutes, que `evenements` remplit, zero compris.
          return `${pluriel(t.jours, "jour")} · ${pluriel(t.tuiles + 1, "tuile")}`;
        }),
      },
      {
        bloc: "Bilan sanguin",
        source: "bilans_sanguins + analyses_sang",
        lire: duTemoin((id) => {
          // Les trois derniers, comme la fiche, et les marqueurs du plus recent.
          const b = requete<{ bilans: number; marqueurs: number }>(
            `SELECT COUNT(*) AS bilans,
                    (SELECT COUNT(*) FROM analyses_sang a
                      WHERE a.bilan_id = (SELECT id FROM bilans_sanguins
                                           WHERE resident_id = :id
                                           ORDER BY preleve_le DESC LIMIT 1)) AS marqueurs
               FROM (SELECT id FROM bilans_sanguins
                      WHERE resident_id = :id
                      ORDER BY preleve_le DESC LIMIT 3)`,
            { id },
          )[0];
          if (!b || b.bilans === 0) return "aucun bilan";
          return `${pluriel(b.bilans, "bilan")} · ${pluriel(b.marqueurs, "marqueur")} au dernier`;
        }),
      },
      {
        bloc: "Conversations",
        source: "conversations + conversation_tags",
        lire: duTemoin((id) => {
          // « Au seuil » : remontees d'office, un seuil clinique franchi.
          const c = requete<{ n: number; seuil: number }>(
            `SELECT COUNT(*) AS n, COALESCE(SUM(remontee_auto), 0) AS seuil
               FROM conversations WHERE resident_id = :id`,
            { id },
          )[0];
          if (!c || c.n === 0) return "aucun résumé";
          return `${pluriel(c.n, "résumé")} · ${entier(c.seuil)} au seuil`;
        }),
      },
      {
        bloc: "Suivi en cours",
        source: "suivis",
        lire: duTemoin((id) => {
          const n =
            requete<{ n: number }>(
              "SELECT COUNT(*) AS n FROM suivis WHERE resident_id = :id AND actif = 1",
              { id },
            )[0]?.n ?? 0;
          return n === 0 ? "aucun protocole actif" : pluriel(n, "protocole actif", "protocoles actifs");
        }),
      },
    ],
  },
  {
    ecran: "04 — Registre",
    aide: () => ["GET /api/equipage", "GET /api/signaux"],
    blocs: [
      {
        bloc: "Résidents",
        source: "residents · mesures_jour · mesures · nuits · etat_mental · signaux · bracelets",
        lire: () =>
          pluriel(
            requete<{ n: number }>("SELECT COUNT(*) AS n FROM residents")[0]?.n ?? 0,
            "résident",
          ),
      },
      {
        bloc: "Signaux",
        source: "signaux JOIN residents, medecins",
        lire: () => {
          const s = requete<{ a_traiter: number; clos: number }>(
            `SELECT COALESCE(SUM(statut <> 'clos'), 0) AS a_traiter,
                    COALESCE(SUM(statut = 'clos'), 0)  AS clos
               FROM signaux`,
          )[0];
          return s ? `${entier(s.a_traiter)} à traiter · ${entier(s.clos)} clos` : null;
        },
      },
    ],
  },
];

/** Un bloc tel que la route le sert : sa valeur lue, ou la raison de son absence. */
function servir(b: Bloc, c: Contexte) {
  const bloc = { bloc: b.bloc, source: b.source, note: b.note ?? null };
  if (!b.lire) return { ...bloc, lu: false, valeur: null };
  try {
    return { ...bloc, lu: true, valeur: b.lire(c) };
  } catch (e) {
    // Une vue absente ou cassee ne doit pas masquer les autres lignes : c'est
    // precisement ce que cette page sert a voir. Le detail part au journal,
    // jamais dans la reponse — un message SQLite raconte le schema.
    console.error(`[sola] /admin/ecrans · ${b.bloc}`, e);
    return { ...bloc, lu: true, valeur: null, illisible: true };
  }
}

adminApi.get("/ecrans", (_req, res, next) => {
  try {
    const c: Contexte = { ...jourCourant(), temoin: residentId(TEMOIN) };
    res.json({
      ecrans: ECRANS.map((e) => ({
        ecran: e.ecran,
        aide: e.aide(c),
        blocs: e.blocs.map((b) => servir(b, c)),
      })),
    });
  } catch (e) {
    next(e);
  }
});
