import type { CrewApi, ResidentApi, SeveriteApi } from "./api";
import type {
  BarRow,
  ConversationSummary,
  Kpi,
  ParticularityNote,
  Severity,
  TriageSignal,
  VitalSign,
  WellbeingSeries,
} from "./types";

/**
 * Traduction des réponses du serveur vers les types d'affichage.
 *
 * Le partage des rôles est volontaire : le serveur renvoie des nombres, la
 * console décide comment on les lit. « 6 240 » plutôt que 6240, « J+4 128 »
 * plutôt que 4128, une barre en rouge au-delà d'un seuil — tout cela est de
 * la présentation, et n'a rien à faire dans une requête SQL.
 *
 * Les seuils d'affichage ci-dessous sont donc ici, nommés, plutôt que dispersés
 * dans le JSX.
 */

/** Au-delà, une barre de module passe en rouge. */
const SEUIL_MODULE_CRITIQUE = 12;
/** Au-delà, une barre d'alerte physiologique passe en ambre. */
const SEUIL_PHYSIO_SURVEILLANCE = 9;
/** Ligne de référence de la courbe de bien-être : seuil d'alerte équipage. */
const REFERENCE_BIENETRE = 70;

const MODULES: Record<string, string> = {
  A: "Commandement",
  B: "Habitat 1",
  C: "Hydroponie",
  D: "Habitat 2",
  E: "Maintenance",
  F: "Recherche",
};

const GRAVITE: Record<SeveriteApi, Severity> = {
  critique: "crit",
  surveillance: "watch",
  info: "info",
};

// ------------------------------------------------------------- formatage --
// `toLocaleString` separe les milliers par une espace fine insecable (U+202F)
// que la police de la console ne rend pas. On la remplace par une espace
// insecable ordinaire : meme role typographique, mais visible.
const espaces = (t: string) => t.replace(/ /g, " ");

const fr = (n: number, decimales = 1) =>
  espaces(
    n.toLocaleString("fr-FR", {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }),
  );

const entier = (n: number) => espaces(n.toLocaleString("fr-FR"));

/** « il y a 4 min », à partir d'un horodatage SQLite. */
function depuis(quand: string | null): string {
  if (!quand) return "jamais";
  const minutes = Math.round((Date.now() - new Date(quand.replace(" ", "T")).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return "à l’instant";
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  return heures < 24 ? `il y a ${heures} h` : `il y a ${Math.round(heures / 24)} j`;
}

/**
 * Domaine et graduations d'un graphique, déduits des valeurs.
 *
 * Un domaine collé aux extrêmes écrase la courbe contre les bords ; on garde
 * donc une marge, et on arrondit à des valeurs qu'un humain lit sans effort.
 */
function domaine(valeurs: number[], pas: number): { min: number; max: number; ticks: number[] } {
  const bas = Math.min(...valeurs);
  const haut = Math.max(...valeurs);
  const marge = Math.max((haut - bas) * 0.25, pas);
  const min = Math.floor((bas - marge) / pas) * pas;
  const max = Math.ceil((haut + marge) / pas) * pas;
  const ticks: number[] = [];
  for (let i = 1; i <= 3; i++) {
    ticks.push(Math.round((min + ((max - min) * i) / 3) / pas) * pas);
  }
  return { min, max, ticks: [...new Set(ticks)] };
}

/** Quatre étiquettes réparties sur l'axe, le reste vide : sinon c'est illisible. */
function etiquettes(tips: string[]): (string | null)[] {
  const n = tips.length;
  const gardes = new Set([0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1]);
  return tips.map((t, i) => (gardes.has(i) ? t : null));
}

/**
 * Variation par rapport a une reference.
 *
 * `deltaDirection` porte la fleche, `deltaTone` porte la couleur — et les deux
 * ne coincident pas toujours. Une hausse du PHQ-9 est une mauvaise nouvelle,
 * une hausse de l'indice de bien-etre est une bonne. Confondre les deux donne
 * une pastille verte sous un indicateur qui se degrade, ce qui est exactement
 * l'erreur qu'un tableau de bord clinique ne peut pas se permettre.
 */
function ecart(
  courant: number,
  reference: number,
  hausseEstBonne = false,
): Pick<Kpi, "deltaDirection" | "deltaLabel" | "deltaTone"> {
  const delta = courant - reference;
  if (Math.abs(delta) < 0.05) {
    return { deltaDirection: "flat", deltaLabel: "stable", deltaTone: "flat" };
  }
  const monte = delta > 0;
  return {
    deltaDirection: monte ? "up" : "down",
    deltaTone: monte === hausseEstBonne ? "down" : "up",
    deltaLabel: `${monte ? "▲" : "▼"} ${fr(Math.abs(delta))} pt`,
  };
}

// =========================================================== écran 02 =====
export function adapterCrew(d: CrewApi) {
  const serie = d.serie;
  const dernier = serie.at(-1);
  const depistage = d.depistage;

  // Référence des écarts : la valeur d'il y a trente jours, ou le point le
  // plus ancien dont on dispose si l'historique est plus court.
  const refJour = serie.find((p) => p.jour >= dateIlYA(30)) ?? serie[0];

  const spark = (champ: "indice" | "pct_phq9" | "pct_gad7" | "pct_isi") =>
    serie.slice(-7).map((p) => p[champ]);

  const kpis: Kpi[] = [
    {
      label: "Indice de bien-être",
      value: fr(dernier?.indice ?? 0),
      unit: "/100",
      spark: spark("indice"),
      tone: (dernier?.indice ?? 100) < 75 ? "watch" : undefined,
      ...ecart(dernier?.indice ?? 0, refJour?.indice ?? 0, true),
      footNote: "sur 30 jours",
    },
    {
      label: "Dépistage dépressif · PHQ-9 ≥ 10",
      value: fr(depistage?.pct_phq9 ?? 0),
      unit: "%",
      spark: spark("pct_phq9"),
      tone: "watch",
      ...ecart(dernier?.pct_phq9 ?? 0, refJour?.pct_phq9 ?? 0),
      footNote: `${entier(depistage?.n_phq9 ?? 0)} résidents`,
    },
    {
      label: "Anxiété · GAD-7 ≥ 10",
      value: fr(depistage?.pct_gad7 ?? 0),
      unit: "%",
      spark: spark("pct_gad7"),
      ...ecart(dernier?.pct_gad7 ?? 0, refJour?.pct_gad7 ?? 0),
      footNote: `${entier(depistage?.n_gad7 ?? 0)} résidents`,
    },
    {
      label: "Troubles du sommeil · ISI ≥ 15",
      value: fr(depistage?.pct_isi ?? 0),
      unit: "%",
      spark: spark("pct_isi"),
      tone: "watch",
      ...ecart(dernier?.pct_isi ?? 0, refJour?.pct_isi ?? 0),
      footNote: `${entier(depistage?.n_isi ?? 0)} résidents`,
    },
  ];

  const wellbeing = {
    "7": fenetre(serie.filter((p) => p.jour >= dateIlYA(6)), "7 derniers jours"),
    "30": fenetre(serie.filter((p) => p.jour >= dateIlYA(30)), "30 derniers jours"),
    // L'année : les points mensuels, plus aujourd'hui. Reprendre les trente
    // points quotidiens écraserait le dernier mois contre le bord droit.
    "365": fenetre(
      [...serie.filter((p) => p.jour < dateIlYA(30)), serie.at(-1)!].filter(Boolean),
      "12 derniers mois",
    ),
  } as Record<"7" | "30" | "365", WellbeingSeries>;

  const modules: BarRow[] = d.modules.map((m) => ({
    name: `Module ${m.module} · ${MODULES[m.module] ?? "—"}`,
    value: m.pct_residents,
    tone: m.pct_residents >= SEUIL_MODULE_CRITIQUE ? "crit" : undefined,
  }));

  const motifs: BarRow[] = d.motifs.map((m) => ({
    name: m.motif,
    value: m.conversations,
  }));

  const physio: BarRow[] = d.physio.map((p) => ({
    name: p.libelle,
    value: p.pct,
    tone: p.pct >= SEUIL_PHYSIO_SURVEILLANCE ? "watch" : undefined,
  }));

  const triage: TriageSignal[] = d.triage.map((s) => ({
    severity: GRAVITE[s.severite],
    severityLabel:
      s.severite === "critique"
        ? "Critique"
        : s.severite === "surveillance"
          ? "Surveillance"
          : "Contexte",
    residentId: s.resident,
    location: `${s.cabine} · ${s.age} ans`,
    trigger: s.motif,
    openedAt: s.ouvert_a,
    assignee: s.assigne_a ?? "Non assigné",
    unassigned: !s.assigne_a,
  }));

  return {
    ship: {
      name: d.vaisseau.nom,
      residents: d.vaisseau.residents,
      flightDay: `J+${entier(d.vaisseau.jour_vol)}`,
      lastSync: depuis(d.vaisseau.synchro_at),
    },
    kpis,
    wellbeing,
    modules,
    motifs,
    physio,
    triage,
    compteurs: d.compteurs,
    maxModule: Math.max(16, ...modules.map((m) => m.value)),
    maxMotif: Math.max(...motifs.map((m) => m.value), 1) * 1.06,
    maxPhysio: Math.max(14, ...physio.map((p) => p.value)),
  };
}

function fenetre(points: CrewApi["serie"], sousTitre: string): WellbeingSeries {
  const values = points.map((p) => p.indice);
  const tips = points.map((p) => `J+${entier(p.jour_vol)}`);
  const { min, max, ticks } = domaine([...values, REFERENCE_BIENETRE], 1);
  return {
    values,
    min,
    max,
    ticks,
    refLine: REFERENCE_BIENETRE,
    labels: etiquettes(tips),
    tips,
    subtitle: `${sousTitre} · moyenne équipage`,
  };
}

/** Date ISO d'il y a `n` jours — pour découper la série sans refaire d'appel. */
function dateIlYA(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return new Date(d.getTime() - n * 86400000).toISOString().slice(0, 10);
}

// =========================================================== écran 03 =====

/**
 * Constantes réellement mesurées par le bracelet KY-039. Ce n'est pas une
 * donnée mais une propriété du matériel : deux capteurs, huit constantes
 * affichées, et l'interface doit dire lesquelles sont estimées. Mieux vaut
 * deux mesures honnêtes que huit chiffres dont on ignore l'origine.
 */
const MESUREES = new Set(["hr", "hrv"]);

interface DefinitionVital {
  key: string;
  label: string;
  unit?: string;
  champ: keyof ResidentApi["constantes"][number];
  titre: string;
  suffixe: string;
  pas: number;
  decimales: number;
  /** Seuil au-delà (ou en deçà) duquel la tuile passe en ambre. */
  alerte?: (valeur: number, base: number) => boolean;
  reference: (valeur: number, base: number, mini: number, maxi: number) => string;
}

const VITAUX: DefinitionVital[] = [
  {
    key: "hr", label: "Fréquence cardiaque au repos", unit: "bpm",
    champ: "fc_repos_bpm", titre: "FC de repos", suffixe: " bpm", pas: 5, decimales: 0,
    alerte: (v) => v > 75,
    reference: (_v, _b, mini, maxi) => `base perso ${Math.round(mini)}–${Math.round(maxi)}`,
  },
  {
    key: "spo2", label: "Oxygénation du sang", unit: "%",
    champ: "spo2_pct", titre: "SpO₂", suffixe: " %", pas: 2, decimales: 0,
    alerte: (v) => v < 95,
    reference: () => "norme ≥ 95",
  },
  {
    key: "resp", label: "Fréquence respiratoire", unit: "/min",
    champ: "resp_min", titre: "Respiration", suffixe: " /min", pas: 2, decimales: 0,
    reference: () => "norme 12–18",
  },
  {
    key: "hrv", label: "Variabilité cardiaque · RMSSD", unit: "ms",
    champ: "rmssd_ms", titre: "Variabilité cardiaque", suffixe: " ms", pas: 5, decimales: 0,
    alerte: (v, base) => v < base * 0.8,
    reference: (v, base) =>
      `base perso ${Math.round(base)} · ${v < base ? "−" : "+"}${Math.round(
        Math.abs((v - base) / base) * 100,
      )} %`,
  },
  {
    key: "temp", label: "Température cutanée", unit: "°C",
    champ: "temp_c", titre: "Température cutanée", suffixe: " °C", pas: 0.5, decimales: 1,
    reference: (_v, _b, mini, maxi) => `base perso ${fr(mini)}–${fr(maxi)}`,
  },
  {
    key: "eda", label: "Activité électrodermale", unit: "µS",
    champ: "eda_us", titre: "Activité électrodermale", suffixe: " µS", pas: 0.5, decimales: 1,
    alerte: (v, base) => v > base * 1.3,
    reference: (v, base) => `base perso ${fr(base)} · ${v > base ? "élevée" : "normale"}`,
  },
  {
    key: "steps", label: "Pas sur 24 h",
    champ: "pas", titre: "Activité", suffixe: " pas", pas: 500, decimales: 0,
    alerte: (v) => v < 4000,
    reference: () => "objectif 8 000",
  },
];

export function adapterResident(d: ResidentApi) {
  const r = d.resident;
  const c = d.constantes;

  const vitals: VitalSign[] = VITAUX.map((def) => {
    const serie = c.map((l) => Number(l[def.champ] ?? 0));
    const valeur = serie.at(-1) ?? 0;
    // Base personnelle : la première moitié de la fenêtre. Comparer un
    // résident à lui-même vaut mieux que le comparer à une norme de
    // population — c'est tout l'intérêt d'un bracelet porté en continu.
    const debut = serie.slice(0, Math.max(1, Math.floor(serie.length / 2)));
    const base = debut.reduce((a, b) => a + b, 0) / debut.length;
    const { min, max, ticks } = domaine(serie, def.pas);

    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      value: def.key === "steps" ? entier(valeur) : fr(valeur, def.decimales),
      reference: def.reference(valeur, base, Math.min(...serie), Math.max(...serie)),
      spark: serie.slice(-7),
      watch: def.alerte?.(valeur, base) ?? false,
      measured: MESUREES.has(def.key),
      chart: {
        title: def.titre,
        subtitle: `${c.length} derniers jours · ${def.unit ?? "pas"}`,
        values: serie,
        min,
        max,
        ticks,
        refLine: Math.round(base * 10) / 10,
        unitSuffix: def.suffixe,
      },
    };
  });

  // Les secousses n'ont pas de série quotidienne : on la compose depuis les
  // événements, en comptant zéro pour les jours sans rien.
  const chutes = c.map(
    (l) => d.evenements.filter((e) => e.jour === l.jour).reduce((a, e) => a + e.n, 0),
  );
  vitals.push({
    key: "falls",
    label: "Secousses et chutes",
    unit: "évt",
    value: String(chutes.at(-1) ?? 0),
    reference: `${chutes.reduce((a, b) => a + b, 0)} sur la période`,
    spark: chutes.slice(-7),
    measured: false,
    chart: {
      title: "Secousses détectées",
      subtitle: `${c.length} derniers jours · événements`,
      values: chutes,
      min: 0,
      max: Math.max(3, ...chutes),
      ticks: [0, 1, 2, 3],
      unitSuffix: " évt",
    },
  });

  const conversations: ConversationSummary[] = d.conversations.slice(0, 4).map((conv) => ({
    id: String(conv.id),
    date: `J+${entier(conv.jour_vol)} · ${conv.debut_at.slice(11, 16)}`,
    sortKey: conv.jour_vol + Number(conv.debut_at.slice(11, 13)) / 100,
    severity: GRAVITE[conv.severite],
    severityLabel: conv.severite === "info" ? "Contexte" : "Surveillance",
    tags: conv.tags,
    durationMinutes: conv.duree_min,
    summary: conv.resume,
    facts: [
      `Durée ${conv.duree_min} min`,
      conv.actions_proposees === 0
        ? "Aucune action proposée"
        : `${conv.actions_proposees} action${conv.actions_proposees > 1 ? "s" : ""} proposée${
            conv.actions_proposees > 1 ? "s" : ""
          } · ${conv.actions_acceptees} acceptée${conv.actions_acceptees > 1 ? "s" : ""}`,
      conv.remontee_auto === 1 ? "Remonté automatiquement" : "Remonté pour contexte",
    ],
  }));

  const ICONES: Record<string, string> = {
    critique: "!",
    surveillance: "△",
    info: "i",
  };
  const particularities: ParticularityNote[] = d.particularites.map((p) => ({
    icon: ICONES[p.niveau] ?? "i",
    title: p.titre,
    detail: p.detail,
    level: p.niveau === "critique" ? "crit" : p.niveau === "surveillance" ? "watch" : undefined,
  }));

  const ICONES_SUIVI: Record<string, string> = {
    traitement: "℞",
    action: "☀",
    rendez_vous: "◷",
    contact: "♡",
  };
  const followUp: ParticularityNote[] = d.suivis.map((s) => ({
    icon: ICONES_SUIVI[s.type] ?? "·",
    title: s.titre,
    detail: s.detail,
  }));

  const batterie = d.bracelet?.batterie_pct;
  const statut =
    r.statut === "critique" ? "Critique" : r.statut === "surveillance" ? "Surveillance" : "Suivi";

  const tips = c.map((_, i) => (i === c.length - 1 ? "Aujourd’hui" : `J−${c.length - 1 - i}`));

  return {
    resident: {
      id: r.code,
      initials: `${r.prenom[0] ?? ""}${r.nom[0] ?? ""}`,
      name: `${r.prenom} ${r.nom}`,
      status: statut,
      meta: `${r.age} ans · ${r.poste} · Module ${r.cabine} · embarqué au J+${entier(
        r.embarque_jour_vol,
      )}`,
      device: d.bracelet
        ? `bracelet ${d.bracelet.serie} · batterie ${batterie ?? "?"} % · synchro ${depuis(
            d.bracelet.synchro_at,
          )}`
        : "aucun bracelet appairé",
    },
    vitals,
    sleepNights: d.nuits.map((n) => Math.round(((n.sommeil_min ?? 0) / 60) * 10) / 10),
    conversations,
    totalConversations: d.conversations_total,
    particularities,
    followUp,
    dayLabels: etiquettes(tips),
    dayTips: tips,
  };
}
