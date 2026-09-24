import { Router } from "express";
import { requete } from "../db.js";
import { ancre } from "./console.js";

/**
 * Ce que l'equipe nutrition lit des bilans sanguins : des moyennes sur
 * l'equipage, jamais une ligne de dossier. Elle en deduit les carences a
 * corriger par les cultures du vaisseau, et tient l'historique chez elle :
 * elle appelle quand elle veut, aussi souvent qu'elle veut.
 *
 * Une reponse couvre un cycle de prelevement, quatorze jours, et ne garde que
 * le dernier bilan de chaque resident. Les rendez-vous s'etalent sur le cycle :
 * chacun y compte donc une fois, quel que soit son jour. Appelee chaque jour,
 * la fenetre glisse ; tous les quatorze jours, les periodes se suivent sans se
 * chevaucher. `?au=` rejoue une periode passee.
 */
export const partenairesApi = Router();

const CYCLE_JOURS = 14;

/**
 * Sous ce nombre de residents, une moyenne ne cache plus personne : ses valeurs
 * partent vides, seul l'effectif reste. Onze, parce que c'est la regle du CASD
 * pour les sorties de donnees de sante du PMSI — aucune case ne concerne moins
 * de 11 patients.
 */
const EFFECTIF_MIN = 11;

/**
 * Les marqueurs transmis : ceux dont le taux sanguin suit ce que l'on mange.
 * Les dix-sept autres restent a bord, chacun pour une raison :
 *   · sodium, potassium, calcium — le rein et les hormones tiennent leur taux
 *     quel que soit l'apport ; l'apport se lit dans les urines, ou les os ;
 *   · TSH, T4 libre — l'iode y joue, une maladie de la thyroide bien davantage ;
 *     l'iode d'une population se dose dans les urines ;
 *   · hematocrite — redit l'hemoglobine, en suivant l'hydratation ;
 *   · leucocytes, plaquettes, foie, reins, inflammation, cortisol, DHEA-S —
 *     aucun ne dit un nutriment.
 *
 * `libelle` est le nom du marqueur dans `analyses_sang` ; `cle`, celui que lit
 * l'autre equipe, en ASCII et stable si l'affichage change.
 */
const MARQUEURS = [
  // Carences : la part sous la borne basse compte ceux qui manquent.
  { cle: "hemoglobine", libelle: "Hémoglobine", groupe: "carence" },
  { cle: "ferritine", libelle: "Ferritine", groupe: "carence" },
  { cle: "fer_serique", libelle: "Fer sérique", groupe: "carence" },
  { cle: "vitamine_d", libelle: "Vitamine D", groupe: "carence" },
  { cle: "vitamine_b12", libelle: "Vitamine B12", groupe: "carence" },
  { cle: "folates", libelle: "Folates", groupe: "carence" },
  // Equilibre de la ration, sucres et graisses : c'est le haut qui compte,
  // sauf pour le HDL, qui protege et n'a qu'une borne basse.
  { cle: "glycemie", libelle: "Glycémie à jeun", groupe: "equilibre" },
  { cle: "hba1c", libelle: "HbA1c", groupe: "equilibre" },
  { cle: "cholesterol_total", libelle: "Cholestérol total", groupe: "equilibre" },
  { cle: "ldl", libelle: "LDL", groupe: "equilibre" },
  { cle: "hdl", libelle: "HDL", groupe: "equilibre" },
  { cle: "triglycerides", libelle: "Triglycérides", groupe: "equilibre" },
] as const;

/**
 * Le dernier bilan rendu de chaque resident sur la periode. `date()` autour de
 * `preleve_le` : un prelevement horodate a l'heure reste dans son jour.
 */
const DERNIERS = `
  WITH derniers AS (
    SELECT id, source
      FROM (SELECT id, source,
                   ROW_NUMBER() OVER (PARTITION BY resident_id ORDER BY preleve_le DESC) AS rang
              FROM bilans_sanguins
             WHERE statut = 'rendu'
               AND date(preleve_le) BETWEEN :du AND :au)
     WHERE rang = 1
  )`;

interface Agregat {
  marqueur: string;
  unite: string | null;
  ref_bas: number | null;
  ref_haut: number | null;
  n: number;
  moyenne: number | null;
  ecart_type: number | null;
  pct_bas: number | null;
  pct_haut: number | null;
}

// Chaque resultat face a SES bornes, celles ecrites avec lui : le laboratoire
// a pu en changer en cours de cycle. Une borne ne se renvoie que si elle est
// la meme pour tous. Le GROUP BY porte aussi l'unite : une moyenne de deux
// unites ne voudrait rien dire, deux lignes valent mieux.
//
// Ecart-type d'echantillon ; `max(0, …)` parce que l'arrondi peut rendre
// negative la variance de valeurs toutes egales.
const SQL_AGREGATS = `${DERNIERS}
  SELECT a.marqueur, a.unite,
         CASE WHEN MIN(a.ref_bas) = MAX(a.ref_bas) THEN MIN(a.ref_bas) END AS ref_bas,
         CASE WHEN MIN(a.ref_haut) = MAX(a.ref_haut) THEN MIN(a.ref_haut) END AS ref_haut,
         COUNT(*) AS n,
         ROUND(AVG(a.valeur_num), 2) AS moyenne,
         ROUND(sqrt(max(0, (SUM(a.valeur_num * a.valeur_num)
                            - SUM(a.valeur_num) * SUM(a.valeur_num) / COUNT(*))
                           / (COUNT(*) - 1))), 2) AS ecart_type,
         ROUND(100.0 * AVG(a.valeur_num < a.ref_bas), 1) AS pct_bas,
         ROUND(100.0 * AVG(a.valeur_num > a.ref_haut), 1) AS pct_haut
    FROM derniers d
    JOIN analyses_sang a ON a.bilan_id = d.id
   WHERE a.valeur_num IS NOT NULL
     AND a.marqueur IN (SELECT value FROM json_each(:marqueurs))
   GROUP BY a.marqueur, a.unite`;

// Sans bilan sur la periode, MIN(source) est NULL et l'egalite aussi : sans
// le premier cas, une periode vide se dirait « mixte ».
const SQL_PERIODE = `${DERNIERS}
  SELECT COUNT(*) AS preleves,
         CASE WHEN COUNT(*) = 0 THEN NULL
              WHEN MIN(source) = MAX(source) THEN MIN(source)
              ELSE 'mixte' END AS source
    FROM derniers`;

const JOUR_MS = 86_400_000;

/** Un jour du calendrier, AAAA-MM-JJ : « 2026-02-30 » ne passe pas. */
function jourValide(brut: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(brut)) return false;
  const d = new Date(`${brut}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === brut;
}

const decaler = (jour: string, jours: number) =>
  new Date(Date.parse(`${jour}T00:00:00Z`) + jours * JOUR_MS).toISOString().slice(0, 10);

const ecartJours = (debut: string, fin: string) =>
  Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / JOUR_MS);

const SANS_VALEUR = { moyenne: null, ecart_type: null, pct_bas: null, pct_haut: null };

partenairesApi.get("/nutrition/bilans", (req, res, next) => {
  try {
    const brut = String(req.query.au ?? "");
    if (brut !== "" && !jourValide(brut)) {
      res.status(400).json({ erreur: "au : date attendue au format AAAA-MM-JJ." });
      return;
    }

    // Par defaut, le jour que la console tient pour aujourd'hui : la base de
    // demonstration se lit ainsi pareil le lendemain de sa generation.
    const a = ancre();
    const au = brut || a.jour;
    const du = decaler(au, 1 - CYCLE_JOURS);

    const periode = requete<{ preleves: number; source: string | null }>(SQL_PERIODE, {
      du,
      au,
    })[0]!;
    const agregats = requete<Agregat>(SQL_AGREGATS, {
      du,
      au,
      marqueurs: JSON.stringify(MARQUEURS.map((m) => m.libelle)),
    });
    const equipage = requete<{ n: number }>("SELECT COUNT(*) AS n FROM residents")[0]!.n;

    // Un marqueur sans resultat garde sa ligne : la forme de la reponse ne
    // depend pas des donnees, et l'autre equipe n'a pas a deviner une absence.
    const marqueurs = MARQUEURS.flatMap(({ cle, libelle, groupe }) => {
      const lignes = agregats.filter((x) => x.marqueur === libelle);
      if (lignes.length === 0) {
        return [
          { cle, libelle, groupe, unite: null, ref_bas: null, ref_haut: null, n: 0, ...SANS_VALEUR },
        ];
      }
      return lignes.map(({ marqueur: _, ...x }) => ({
        cle,
        libelle,
        groupe,
        ...x,
        ...(x.n < EFFECTIF_MIN ? SANS_VALEUR : {}),
      }));
    });

    res.json({
      periode: {
        du,
        au,
        jours: CYCLE_JOURS,
        jour_vol_du: a.jour_vol - ecartJours(du, a.jour),
        jour_vol_au: a.jour_vol - ecartJours(au, a.jour),
      },
      equipage,
      preleves: periode.preleves,
      source: periode.source,
      effectif_min: EFFECTIF_MIN,
      marqueurs,
    });
  } catch (e) {
    next(e);
  }
});
