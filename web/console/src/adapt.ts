import type {
  AnalyseApi,
  BilanApi,
  CrewApi,
  ResidentApi,
  SeveriteApi,
  StatutResident,
} from "./api";
import {
  dateCourte,
  duree,
  entier,
  fr,
  frMax,
  heure,
  horodatage,
  jv,
  nombreLibre,
  pluriel,
} from "./format";
import type {
  Barre,
  BilanFiche,
  CleConstante,
  CleIndicateur,
  Constante,
  Courbe,
  IconeSuivi,
  Indicateur,
  LigneFile,
  Marqueur,
  Panneau,
  Pastille,
  Periode,
  VueCrew,
  VueResident,
} from "./types";

/**
 * De la réponse du serveur à ce que les écrans 02 et 03 affichent.
 *
 * Tout ce que ces deux écrans écrivent passe par ici, serveur allumé comme
 * serveur éteint : le repli (`repli.ts`) applique ces mêmes fonctions à une
 * réponse figée, écrite par `scripts/db-repli.mjs`. Une chaîne ne peut donc
 * pas dire une chose quand le serveur répond et une autre quand il se tait.
 */

const arrondi = (v: number, decimales = 0) => {
  const k = 10 ** decimales;
  return Math.round(v * k) / k;
};

const GRAVITES: Record<SeveriteApi, Pastille> = {
  critique: { libelle: "Critique", ton: "crit" },
  surveillance: { libelle: "Surveillance", ton: "watch" },
  info: { libelle: "Info", ton: "neutre" },
};
export const gravite = (s: SeveriteApi): Pastille => GRAVITES[s] ?? GRAVITES.info;

const STATUTS: Record<StatutResident, Pastille> = {
  critique: { libelle: "Critique", ton: "crit" },
  surveillance: { libelle: "Surveillance", ton: "watch" },
  ok: { libelle: "Suivi normal", ton: "ok" },
};
export const statut = (s: StatutResident): Pastille => STATUTS[s] ?? STATUTS.ok;

/** Les six modules d'habitation, par la lettre qui ouvre le numéro de cabine. */
export const MODULES: Record<string, string> = {
  A: "Commandement",
  B: "Habitat 1",
  C: "Hydroponie",
  D: "Habitat 2",
  E: "Maintenance",
  F: "Recherche",
};

// ------------------------------------------------------------ écran 02 --
const INDICATEURS: {
  cle: CleIndicateur;
  libelle: string;
  unite: string;
  serie: string;
  champ: "indice" | "pct_phq9" | "pct_gad7" | "pct_isi";
}[] = [
  {
    cle: "indice",
    libelle: "Indice de bien-être",
    unite: "/100",
    serie: "Indice de bien-être, sur 100",
    champ: "indice",
  },
  {
    cle: "phq9",
    libelle: "Dépistage dépressif · PHQ-9 ≥ 10",
    unite: "%",
    serie: "Part de l'équipage au PHQ-9 ≥ 10, en %",
    champ: "pct_phq9",
  },
  {
    cle: "gad7",
    libelle: "Anxiété · GAD-7 ≥ 10",
    unite: "%",
    serie: "Part de l'équipage au GAD-7 ≥ 10, en %",
    champ: "pct_gad7",
  },
  {
    cle: "isi",
    libelle: "Troubles du sommeil · ISI ≥ 15",
    unite: "%",
    serie: "Part de l'équipage à l'ISI ≥ 15, en %",
    champ: "pct_isi",
  },
];

/**
 * Les trois périodes de la tendance, découpées dans la même série.
 *
 * Sur douze mois, un point par mois puis le dernier jour : les points
 * quotidiens du dernier mois, mis au bout d'une année mensuelle, y
 * dessineraient un mois de bruit.
 */
const PERIODES: {
  cle: Periode["cle"];
  libelle: string;
  garde: (jourVol: number, ancre: number) => boolean;
  /** En jours avant l'ancre. */
  graduations: number[];
}[] = [
  { cle: "7", libelle: "7 jours", garde: (x, a) => x >= a - 6, graduations: [6, 5, 4, 3, 2, 1, 0] },
  { cle: "30", libelle: "30 jours", garde: (x, a) => x >= a - 30, graduations: [28, 21, 14, 7, 0] },
  {
    cle: "365",
    libelle: "12 mois",
    garde: (x, a) => x >= a - 360 && x <= a - 30,
    graduations: [360, 300, 240, 180, 120, 60, 0],
  },
];

/**
 * L'écart entre le premier et le dernier point de la période.
 *
 * La flèche suit la donnée, la teinte suit le sens clinique : un indice de
 * bien-être qui baisse est à surveiller, une part d'anxieux qui baisse ne
 * l'est pas.
 */
function ecartPeriode(cle: CleIndicateur, valeurs: number[]): Pastille {
  if (valeurs.length < 2) return { libelle: "—", ton: "neutre" };
  const d = arrondi(valeurs[valeurs.length - 1]! - valeurs[0]!, 1);
  if (d === 0) return { libelle: "stable", ton: "neutre" };
  const mauvais = cle === "indice" ? d < 0 : d > 0;
  return { libelle: `${d > 0 ? "▲" : "▼"} ${fr(Math.abs(d))} pt`, ton: mauvais ? "watch" : "ok" };
}

function barres<T>(
  lignes: T[],
  mesure: (l: T) => number,
  libelle: (l: T) => string,
  valeur: (l: T) => string,
): Barre[] {
  const max = Math.max(0, ...lignes.map(mesure));
  return lignes.map((l) => ({
    libelle: libelle(l),
    valeur: valeur(l),
    part: max > 0 ? arrondi((100 * mesure(l)) / max, 1) : 0,
  }));
}

/**
 * Du plus récent au plus ancien, comme le serveur les sert. Refait ici pour
 * le repli : une réponse figée avant ce tri s'afficherait sinon dans l'ancien
 * ordre. Les horodatages « AAAA-MM-JJ HH:MM:SS » se comparent comme du texte.
 */
function plusRecentsDabord<T extends { id: number; ouvert_at: string }>(signaux: T[]): T[] {
  return [...signaux].sort((a, b) =>
    a.ouvert_at === b.ouvert_at ? b.id - a.id : a.ouvert_at < b.ouvert_at ? 1 : -1,
  );
}

export function adapterCrew(d: CrewApi): VueCrew {
  const a = d.ancre.jour_vol;
  const dep = d.depistage;

  const synchro = d.vaisseau.synchro_at
    ? ` · dernière synchro ${horodatage(d.vaisseau.synchro_at, d.ancre.jour)}`
    : "";

  const actuels: Record<CleIndicateur, { valeur: number | null; n: number | null }> = {
    indice: { valeur: dep?.indice_bienetre ?? null, n: null },
    phq9: { valeur: dep?.pct_phq9 ?? null, n: dep?.n_phq9 ?? null },
    gad7: { valeur: dep?.pct_gad7 ?? null, n: dep?.n_gad7 ?? null },
    isi: { valeur: dep?.pct_isi ?? null, n: dep?.n_isi ?? null },
  };

  const indicateurs: Indicateur[] = INDICATEURS.map((i) => {
    const { valeur, n } = actuels[i.cle];
    return {
      cle: i.cle,
      libelle: i.libelle,
      valeur: fr(valeur),
      unite: i.unite,
      residents: n === null ? null : pluriel(n, "résident"),
    };
  });

  const dernier = d.serie[d.serie.length - 1];
  const periodes: Periode[] = PERIODES.map((p) => {
    const points = d.serie.filter((s) => p.garde(s.jour_vol, a));
    if (p.cle === "365" && dernier && !points.includes(dernier)) points.push(dernier);

    const ecarts = {} as Record<CleIndicateur, Pastille>;
    const courbes = {} as Record<CleIndicateur, Courbe>;
    for (const i of INDICATEURS) {
      const valeurs = points.map((s) => s[i.champ]);
      ecarts[i.cle] = ecartPeriode(i.cle, valeurs);
      const indice = i.cle === "indice";
      courbes[i.cle] = {
        nom: i.serie,
        points: points.map((s) => ({ x: s.jour_vol, y: s[i.champ] })),
        // Le seuil d'attention de l'indice ; les parts de dépistage n'en ont
        // pas, leur seuil clinique est déjà dans leur définition (≥ 10, ≥ 15).
        seuils: indice ? [{ valeur: 70, libelle: "Seuil d'attention (70)" }] : [],
        base: null,
        legendeSeuil: indice ? "Seuil d'attention · 70" : undefined,
        alerte: false,
        largeur: 600,
        graduationsX: p.graduations.map((k) => a - k),
        bulle: indice ? (v) => fr(v) : (v) => `${fr(v)} %`,
      };
    }

    return {
      cle: p.cle,
      libelle: p.libelle,
      debut: points[0] ? jv(points[0].jour_vol) : "—",
      fin: points.length ? jv(points[points.length - 1]!.jour_vol) : "—",
      ecarts,
      courbes,
    };
  });

  // Toute la file du même jour : on le dit une fois au pied, plutôt que sur
  // chaque ligne.
  const jours = new Set(d.triage.map((t) => t.ouvert_jour_vol));
  const memeJour = jours.size === 1 ? d.triage[0]!.ouvert_jour_vol : null;

  const file: LigneFile[] = plusRecentsDabord(d.triage).map((t) => ({
    id: t.id,
    gravite: gravite(t.severite),
    resident: t.resident,
    nom: `${t.prenom} ${t.nom}`,
    details: `${t.resident} · ${t.cabine} · ${entier(t.age)} ans`,
    motif: t.motif,
    origine: t.origine,
    heure: heure(t.ouvert_at),
    jour: memeJour === null ? jv(t.ouvert_jour_vol) : null,
    statut: t.statut,
    assigne: t.assigne_a,
    assigneId: t.assigne_id,
  }));

  const total = d.compteurs.ouverts;
  const n = file.length;
  const piedFile = n
    ? [
        n < total ? `${entier(n)} plus récents sur ${entier(total)}` : `${pluriel(n, "signal", "signaux")} à traiter`,
        "les plus récents d'abord",
        memeJour !== null ? `ouverts le ${jv(memeJour)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const physio = [...d.physio].sort((x, y) => y.pct - x.pct);

  return {
    ancre: { jour: d.ancre.jour, jourVol: a },
    entete: `${entier(d.vaisseau.residents)} résidents · ${jv(a)}${synchro}`,
    indicateurs,
    periodes,
    remonte: {
      motifs: {
        conversations: entier(d.conversations_30j),
        barres: barres(
          d.motifs,
          (m) => m.conversations,
          (m) => m.motif,
          (m) => entier(m.conversations),
        ),
      },
      // Rangés par part des résidents du module, pas par nombre : un petit
      // module avec 11 signaux va plus mal qu'un grand qui en compte 18.
      modules: barres(
        d.modules,
        (m) => m.pct_residents,
        (m) => `${m.module} · ${MODULES[m.module] ?? `module ${m.module}`}`,
        (m) => `${entier(m.signaux)} · ${fr(m.pct_residents)} %`,
      ),
      physio: {
        nuit: jv(a),
        barres: barres(
          physio,
          (p) => p.pct,
          (p) => p.libelle,
          (p) => `${fr(p.pct)} %`,
        ),
      },
    },
    file,
    compteurs: {
      ouverts: d.compteurs.ouverts,
      critiques: d.compteurs.critiques,
      sansPersonne: d.compteurs.non_assignes,
    },
    piedFile,
  };
}

// ------------------------------------------------------------ écran 03 --
type Champ = "rmssd_ms" | "fc_repos_bpm" | "spo2_pct" | "resp_min" | "eda_us" | "temp_c" | "pas";

interface Seuil {
  valeur: number;
  /** Au-dessus (`haut`) ou au-dessous (`bas`) de la valeur, la tuile passe en vigilance. */
  sens: "haut" | "bas";
  nom: "seuil" | "norme" | "plancher";
  /** Le libellé sur la courbe, quand il ne suit pas la règle commune. */
  trace?: string;
}

const SOUS = { seuil: "sous le seuil", norme: "sous la norme", plancher: "sous le plancher" };
const DESSUS = {
  seuil: "au-dessus du seuil",
  norme: "au-dessus de la norme",
  plancher: "au-dessus du plancher",
};

interface Descripteur {
  cle: Exclude<CleConstante, "sleep">;
  libelle: string;
  serie: string;
  unite: string | null;
  /** L'unité dans les libellés de la courbe. */
  suffixe: string;
  champ: Champ;
  /**
   * La précision affichée, qui est aussi celle que les règles jugent : une
   * tuile qui écrit « 95 » ne peut pas se dire sous le seuil 95.
   */
  decimales: number;
  /** Décimales fixes (« 34,0 ») plutôt qu'au plus (« 62 », « 61,4 »). */
  fixe: boolean;
  decimalesBase: number;
  /**
   * `null` : le seuil se tire d'une base personnelle qui manque. Un tableau
   * vide : cette constante n'a pas de seuil, et la tuile le dit.
   */
  seuils: (base: number | null) => Seuil[] | null;
  /** Le seuil vient de la base : une tuile en vigilance la rappelle. */
  personnel?: boolean;
  legendeSeuil?: string;
  marge?: number;
  formatY?: (v: number) => string;
}

/**
 * Les sept constantes chiffrées de la fiche, dans l'ordre des tuiles, le
 * sommeil mis à part.
 *
 * Deux seuils sont personnels : 80 % de la base pour la variabilité
 * cardiaque, 130 % pour l'activité électrodermale — ce qui compte chez elles
 * est l'écart à soi. Les autres sont fixes, les mêmes pour tout l'équipage.
 * La base est la moyenne des sept premiers jours de la fenêtre.
 */
const MESUREES: Descripteur[] = [
  {
    cle: "hrv",
    libelle: "Variabilité cardiaque · RMSSD",
    serie: "Variabilité cardiaque · RMSSD, en ms",
    unite: "ms",
    suffixe: "ms",
    champ: "rmssd_ms",
    decimales: 1,
    fixe: false,
    decimalesBase: 0,
    seuils: (b) => (b === null ? null : [{ valeur: arrondi(b * 0.8), sens: "bas", nom: "seuil" }]),
    personnel: true,
  },
  {
    cle: "hr",
    libelle: "FC de repos",
    serie: "FC de repos, en bpm",
    unite: "bpm",
    suffixe: "bpm",
    champ: "fc_repos_bpm",
    decimales: 1,
    fixe: false,
    decimalesBase: 0,
    seuils: () => [{ valeur: 75, sens: "haut", nom: "seuil" }],
  },
  {
    cle: "spo2",
    libelle: "SpO₂",
    serie: "SpO₂, en %",
    unite: "%",
    suffixe: "%",
    champ: "spo2_pct",
    decimales: 1,
    fixe: false,
    decimalesBase: 0,
    seuils: () => [{ valeur: 95, sens: "bas", nom: "seuil" }],
  },
  {
    cle: "resp",
    libelle: "Respiration",
    serie: "Respiration, en cycles par minute",
    unite: "/min",
    suffixe: "/min",
    champ: "resp_min",
    decimales: 1,
    fixe: false,
    decimalesBase: 0,
    seuils: () => [
      { valeur: 12, sens: "bas", nom: "norme", trace: "norme basse 12" },
      { valeur: 18, sens: "haut", nom: "norme", trace: "norme haute 18" },
    ],
    legendeSeuil: "norme 12–18 /min",
  },
  {
    cle: "eda",
    libelle: "Activité électrodermale",
    serie: "Activité électrodermale, en µS",
    unite: "µS",
    suffixe: "µS",
    champ: "eda_us",
    decimales: 1,
    fixe: true,
    decimalesBase: 1,
    seuils: (b) =>
      b === null ? null : [{ valeur: arrondi(b * 1.3, 1), sens: "haut", nom: "seuil" }],
    personnel: true,
  },
  {
    cle: "temp",
    libelle: "Température cutanée",
    serie: "Température cutanée, en °C · sans seuil",
    unite: "°C",
    suffixe: "°C",
    champ: "temp_c",
    decimales: 1,
    fixe: true,
    decimalesBase: 1,
    seuils: () => [],
  },
  {
    cle: "steps",
    libelle: "Pas sur 24 h",
    serie: "Pas sur 24 h",
    unite: null,
    suffixe: "pas",
    champ: "pas",
    decimales: 0,
    fixe: false,
    decimalesBase: 0,
    seuils: () => [{ valeur: 4000, sens: "bas", nom: "plancher" }],
    marge: 50,
    formatY: entier,
  },
];

/** La règle de sommeil court, en minutes : 5 h 30. */
const NUIT_COURTE = 330;
/** À partir de combien de nuits courtes sur la fenêtre la tuile passe en vigilance. */
const NUITS_COURTES_ALERTE = 3;

/** Combien de jours d'affilée, en remontant depuis le dernier, la règle tient. */
function depuis(points: { x: number; y: number }[], fin: number, juge: (v: number) => boolean) {
  const parJour = new Map(points.map((p) => [p.x, p.y]));
  let n = 0;
  for (let x = fin; parJour.has(x) && juge(parJour.get(x)!); x--) n++;
  return n;
}

/** Le point le plus récent d'une série, quel que soit l'ordre où elle arrive. */
const plusRecent = <T extends { x: number }>(points: T[]) =>
  points.length ? points.reduce((a, p) => (p.x > a.x ? p : a)) : undefined;

/**
 * Une tuile, au dernier jour de la fenêtre.
 *
 * `bracelet` : le résident a une ligne ce jour-là. S'il en a une sans cette
 * constante, c'est un capteur qui ne la mesure pas — le bracelet réel
 * n'envoie que la FC et la SpO₂ —, et la tuile reprend sa dernière valeur en
 * disant de quel jour elle date. Sans ligne du tout, c'est un bracelet muet,
 * et la tuile reste vide : c'est l'absence qu'il faut voir.
 *
 * Une valeur reprise garde son alerte. Une variabilité sous son seuil hier ne
 * remonte pas parce que le bracelet du jour ne la mesure pas, et éteindre
 * l'alerte laisserait un capteur absent dire que tout va bien. « Depuis » se
 * compte alors à partir de la valeur reprise, et le repère la date.
 */
function constante(
  m: Descripteur,
  lignes: ResidentApi["constantes"],
  debut: number,
  fin: number,
  bracelet: boolean,
): Constante {
  const f = (v: number) => (m.fixe ? fr(v, m.decimales) : frMax(v, m.decimales));
  const fb = (v: number) => (m.fixe ? fr(v, m.decimalesBase) : frMax(v, m.decimalesBase));

  const points = lignes
    .filter((l) => l[m.champ] !== null && l.jour_vol >= debut && l.jour_vol <= fin)
    .map((l) => ({ x: l.jour_vol, y: arrondi(l[m.champ]!, m.decimales) }));

  const debutBase = points.filter((p) => p.x <= debut + 6);
  const base = debutBase.length
    ? arrondi(debutBase.reduce((s, p) => s + p.y, 0) / debutBase.length, m.decimalesBase)
    : null;
  const seuils = m.seuils(base);
  const dernier = points.find((p) => p.x === fin) ?? (bracelet ? plusRecent(points) : undefined);
  const date = dernier && dernier.x !== fin ? `dernière mesure le ${jv(dernier.x)}` : null;

  const franchi = (s: Seuil, v: number) => (s.sens === "haut" ? v > s.valeur : v < s.valeur);
  const depasse = dernier && seuils?.find((s) => franchi(s, dernier.y));

  let ecart: string | null = null;
  let repere: string | null;
  if (!dernier) {
    repere = points.length ? `— aucune mesure le ${jv(fin)}` : "— aucune mesure sur la fenêtre";
  } else if (depasse) {
    const n = depuis(points, dernier.x, (v) => franchi(depasse, v));
    ecart = `${depasse.sens === "bas" ? `▼ ${SOUS[depasse.nom]}` : `▲ ${DESSUS[depasse.nom]}`} ${f(depasse.valeur)} depuis ${entier(n)} j`;
    repere = date ?? (m.personnel && base !== null ? `base ${fb(base)}` : null);
  } else if (date) {
    repere = `— ${date}`;
  } else if (seuils === null) {
    repere = "— base personnelle indisponible";
  } else if (seuils.length === 0) {
    repere = base === null ? "— sans seuil" : `— sans seuil · base ${fb(base)}`;
  } else if (seuils.length === 2) {
    repere = `— dans la norme · ${f(seuils[0]!.valeur)}–${f(seuils[1]!.valeur)}`;
  } else {
    repere = `— dans la norme · ${seuils[0]!.nom} ${f(seuils[0]!.valeur)}`;
  }

  const alerte = Boolean(depasse);
  return {
    cle: m.cle,
    libelle: m.libelle,
    valeur: dernier ? f(dernier.y) : "—",
    unite: m.unite,
    alerte,
    ecart,
    repere,
    courbe: {
      nom: m.serie,
      points,
      seuils: (seuils ?? []).map((s) => ({
        valeur: s.valeur,
        libelle: s.trace ?? `${s.nom} ${f(s.valeur)} ${m.suffixe}`,
      })),
      base: base === null ? null : { valeur: base, libelle: `base personnelle ${fb(base)} ${m.suffixe}` },
      legendeSeuil: m.legendeSeuil,
      alerte,
      largeur: 1000,
      marge: m.marge,
      graduationsX: [fin - 12, fin - 8, fin - 4, fin],
      domaineX: [debut, fin],
      formatY: m.formatY,
      bulle: (v) => `${f(v)} ${m.suffixe}`,
    },
  };
}

/** La règle de `constante` : un bracelet qui écrit sans estimer le sommeil garde la dernière nuit, datée. */
function sommeil(
  nuits: ResidentApi["nuits"],
  debut: number,
  fin: number,
  bracelet: boolean,
): Constante {
  const presentes = nuits.filter(
    (n) => n.sommeil_min !== null && n.jour_vol >= debut && n.jour_vol <= fin,
  ) as { jour_vol: number; sommeil_min: number }[];
  const duJour = presentes.find((n) => n.jour_vol === fin);
  const derniere =
    duJour ?? (bracelet ? plusRecent(presentes.map((n) => ({ ...n, x: n.jour_vol }))) : undefined);
  const courtes = presentes.filter((n) => n.sommeil_min < NUIT_COURTE).length;
  const alerte = courtes >= NUITS_COURTES_ALERTE;
  const compte = `${pluriel(courtes, "nuit")} sur ${entier(presentes.length)} sous 5 h 30`;
  const absente = derniere ? `dernière nuit le ${jv(derniere.jour_vol)}` : `aucune nuit le ${jv(fin)}`;

  let ecart: string | null = null;
  let repere: string | null = null;
  if (alerte) {
    ecart = compte;
    if (!duJour) repere = absente;
  } else if (!presentes.length) {
    repere = "— aucune nuit enregistrée sur la fenêtre";
  } else if (!duJour) {
    repere = `— ${absente}`;
  } else {
    repere = courtes ? `— ${compte}` : "— aucune nuit sous 5 h 30";
  }

  return {
    cle: "sleep",
    libelle: "Sommeil · dernière nuit",
    valeur: derniere ? duree(derniere.sommeil_min) : "—",
    unite: null,
    alerte,
    ecart,
    repere,
    courbe: {
      nom: "Sommeil, en heures",
      points: presentes.map((n) => ({ x: n.jour_vol, y: n.sommeil_min / 60 })),
      seuils: [{ valeur: NUIT_COURTE / 60, libelle: "règle 5 h 30" }],
      base: null,
      alerte,
      largeur: 1000,
      graduationsX: [fin - 12, fin - 8, fin - 4, fin],
      domaineX: [debut, fin],
      bulle: (h) => duree(h * 60),
    },
  };
}

/** Écart en jours entre deux dates ISO : les événements n'ont pas de jour de vol. */
const joursEntre = (de: string, a: string) =>
  Math.round((Date.parse(a.slice(0, 10)) - Date.parse(de.slice(0, 10))) / 86_400_000);

function evenements(d: ResidentApi, fin: number, jours: number) {
  const somme = (type: string) =>
    d.evenements.filter((e) => e.type === type).reduce((s, e) => s + e.n, 0);
  const chutes = somme("chute");
  const secousses = somme("secousse");
  if (!chutes && !secousses) {
    return { alerte: false, texte: `Aucune secousse ni chute sur ${entier(jours)} jours` };
  }
  const dernier = d.evenements
    .filter((e) => e.type === "chute" || e.type === "secousse")
    .reduce((m, e) => (e.jour > m ? e.jour : m), "");
  const quoi = [chutes && pluriel(chutes, "chute"), secousses && pluriel(secousses, "secousse")]
    .filter(Boolean)
    .join(" et ");
  return {
    alerte: true,
    texte: `${quoi} sur ${entier(jours)} jours · dernière le ${jv(fin - joursEntre(dernier, d.fenetre.fin))}`,
  };
}

const ICONES: Record<string, IconeSuivi> = {
  traitement: "pill",
  action: "sun",
  rendez_vous: "cal",
  contact: "user",
};

/** Les panneaux dans l'ordre du laboratoire, pas dans l'ordre alphabétique où la base les rend. */
const PANNEAUX: [string, string][] = [
  ["cellules_sanguines", "Cellules sanguines"],
  ["fer", "Fer"],
  ["foie", "Foie"],
  ["reins", "Reins"],
  ["sucre", "Sucre"],
  ["thyroide", "Thyroïde"],
  ["electrolytes", "Électrolytes"],
  ["inflammation", "Inflammation"],
  ["lipides", "Lipides"],
  ["vitamines", "Vitamines"],
  ["hormones", "Hormones"],
];

/**
 * Le repère d'un dosage. Une seule borne s'écrit comme un laboratoire
 * l'écrit : le HDL protège, il n'a pas de plafond, seulement « > 0,4 ».
 */
function repereDosage(a: AnalyseApi): string | null {
  if (a.ref_bas !== null && a.ref_haut !== null) {
    return `${nombreLibre(a.ref_bas)}–${nombreLibre(a.ref_haut)}`;
  }
  if (a.ref_bas !== null) return `> ${nombreLibre(a.ref_bas)}`;
  if (a.ref_haut !== null) return `< ${nombreLibre(a.ref_haut)}`;
  // Un résultat en toutes lettres n'a pas de bornes ; il n'appelle un repère
  // que s'il sort de la norme.
  return a.interpretation === "normal" ? null : "négatif attendu";
}

function marqueur(a: AnalyseApi): Marqueur {
  return {
    nom: a.marqueur,
    valeur:
      a.valeur_num !== null
        ? `${nombreLibre(a.valeur_num)}${a.unite ? ` ${a.unite}` : ""}`
        : (a.valeur_texte ?? "—"),
    repere: repereDosage(a),
    ton: a.interpretation === "normal" ? "normal" : a.interpretation === "critique" ? "critique" : "hors",
  };
}

function prochaine(j: number | null): string {
  if (j === null) return "pas de prochaine prise de sang programmée";
  if (j === 0) return "prochaine prise de sang prévue aujourd'hui";
  if (j > 0) return `prochaine prise de sang dans ${entier(j)} j`;
  return `prochaine prise de sang en retard de ${entier(-j)} j`;
}

function bilans(liste: BilanApi[]): BilanFiche[] {
  const options = liste.map((b) => `${dateCourte(b.preleve_le)} · ${jv(b.jour_vol)}`);
  return liste.map((b, i) => {
    const panneaux: Panneau[] = [];
    const inconnus = [...new Set(b.analyses.map((a) => a.panel))]
      .filter((p) => !PANNEAUX.some(([cle]) => cle === p))
      .sort();
    for (const [cle, libelle] of [...PANNEAUX, ...inconnus.map((p) => [p, p] as [string, string])]) {
      const marqueurs = b.analyses.filter((a) => a.panel === cle).map(marqueur);
      if (marqueurs.length) panneaux.push({ cle, libelle, marqueurs });
    }
    const hors = panneaux.flatMap((p) => p.marqueurs).filter((m) => m.ton !== "normal");

    return {
      id: b.id,
      option: options[i]!,
      sous: `${options[i]}${b.medecin ? ` · prélevé par ${b.medecin}` : ""}`,
      horsBorne: hors.map((m) => `${m.nom} · ${m.valeur}${m.repere ? ` · repère ${m.repere}` : ""}`),
      commentaire: b.commentaire,
      panneaux,
      // Un bilan ancien a déjà eu son suivant : « en retard de 14 j » y
      // serait faux. Seul le dernier annonce la prochaine prise de sang.
      prochain: i === 0 ? prochaine(b.prochain_dans_j) : `bilan suivant le ${options[i - 1]}`,
      simule: b.source === "simule",
    };
  });
}

/**
 * « Bracelet BR-0448 · 61 % · synchro 16:04 ». La synchro arrive écrite : la
 * fiche la donne à l'heure de bord de la base, la carte en direct à celle du
 * poste, à la seconde.
 */
export function ligneBracelet(serie: string, batterie: number | null, synchro: string | null): string {
  return [
    `Bracelet ${serie}`,
    batterie !== null ? `${entier(batterie)} %` : null,
    synchro ? `synchro ${synchro}` : "jamais synchronisé",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function adapterResident(d: ResidentApi): VueResident {
  const r = d.resident;
  const { debut_jour_vol: debut, fin_jour_vol: fin } = d.fenetre;

  const traitant = r.traitant_nom
    ? r.traitant_titre
      ? `${r.traitant_titre} ${r.traitant_nom}`
      : `${r.traitant_prenom ?? ""} ${r.traitant_nom}`.trim()
    : null;

  const b = d.bracelet;
  const bracelet = b
    ? ligneBracelet(b.serie, b.batterie_pct, b.synchro_at ? horodatage(b.synchro_at, d.ancre.jour) : null)
    : null;

  const parDescripteur = new Map(MESUREES.map((m) => [m.cle, m]));
  const ordre: CleConstante[] = ["hrv", "hr", "spo2", "resp", "sleep", "eda", "temp", "steps"];
  const duJour = d.constantes.some((l) => l.jour_vol === fin);
  const constantes = ordre.map((cle) =>
    cle === "sleep"
      ? sommeil(d.nuits, debut, fin, duJour)
      : constante(parDescripteur.get(cle)!, d.constantes, debut, fin, duJour),
  );

  const compte = d.conversations_compte;

  return {
    code: r.code,
    ancre: { jour: d.ancre.jour, jourVol: d.ancre.jour_vol },
    identite: {
      initiales: `${r.prenom.charAt(0)}${r.nom.charAt(0)}`.toUpperCase(),
      nom: `${r.prenom} ${r.nom}`,
      statut: statut(r.statut),
      meta: [
        r.code,
        `${entier(r.age)} ans`,
        r.poste,
        `Cabine ${r.cabine}`,
        traitant ? `suivi par ${traitant}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      confiance: r.confiance_prenom
        ? {
            nom: `${r.confiance_prenom} ${r.confiance_nom ?? ""}`.trim(),
            suite: `${r.confiance_lien ? `, ${r.confiance_lien}` : ""}${r.confiance_cabine ? ` · ${r.confiance_cabine}` : ""}`,
          }
        : null,
      bracelet,
    },
    signaux: plusRecentsDabord(d.signaux).map((s) => ({
      id: s.id,
      gravite: gravite(s.severite),
      entete: `${gravite(s.severite).libelle} · ${s.origine} · ${jv(s.ouvert_jour_vol)} · ${heure(s.ouvert_at)}`,
      motif: s.motif,
      statut: s.statut,
      assigne: s.assigne_a,
      assigneId: s.assigne_id,
      motifsCloture: s.motifs_cloture,
    })),
    fenetre: `du ${jv(debut)} au ${jv(fin)}`,
    constantes,
    evenements: evenements(d, fin, fin - debut + 1),
    notes: d.particularites.map((p) => ({
      id: p.id,
      niveau: p.niveau,
      titre: p.titre,
      detail: p.detail,
      // Une note d'avant les comptes n'a pas d'auteur : on l'écrit, plutôt
      // que d'en inventer un.
      signature: [p.auteur ?? "note non signée", p.constate_le ? dateCourte(p.constate_le) : null]
        .filter(Boolean)
        .join(" · "),
    })),
    conversations: {
      total: compte.total,
      remontees: compte.remontees,
      contexte: compte.contexte,
      liste: d.conversations.map((c) => ({
        id: c.id,
        entete: `${jv(c.jour_vol)} · ${heure(c.debut_at)}`,
        gravite: gravite(c.severite),
        tags: c.tags,
        duree: `${entier(c.duree_min)} min`,
        resume: c.resume,
        actions: [
          c.actions_proposees
            ? `${pluriel(c.actions_proposees, "action proposée", "actions proposées")} · ${entier(c.actions_acceptees)} ${c.actions_acceptees > 1 ? "acceptées" : "acceptée"}`
            : "Aucune action proposée",
          "remonté automatiquement",
        ].join(" · "),
        notifie: c.resident_notifie_at !== null,
      })),
      contexteListe: d.contexte.map((c) => ({
        id: c.id,
        entete: `${jv(c.jour_vol)} · ${heure(c.debut_at)}`,
        tags: c.tags,
        duree: `${entier(c.duree_min)} min`,
        notifie: c.resident_notifie_at !== null,
      })),
      contexteAutres: Math.max(0, compte.contexte - d.contexte.length),
    },
    suivis: d.suivis.map((s) => ({
      icone: ICONES[s.type] ?? "pulse",
      titre: s.titre,
      detail: s.detail,
    })),
    bilans: bilans(d.bilans),
  };
}
