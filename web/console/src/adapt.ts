import type { BilanApi, CrewApi, ResidentApi, SeveriteApi } from "./api";
import type {
  BarRow,
  BloodMarker,
  BloodReport,
  ConversationSummary,
  EtatConstante,
  Kpi,
  ParticularityNote,
  SensEcart,
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
  /**
   * Le verdict affiché sous le graphe. Il s'appuie sur la MEME regle que
   * `alerte` : une tuile ambre et un graphe qui annonce « dans la norme » se
   * contrediraient, et c'est la console qui perdrait sa credibilite.
   */
  etat: (valeur: number, base: number) => EtatConstante;
}

/** Assemble un verdict a partir du sens et de la regle qui l'a produit. */
function verdict(sens: SensEcart, repere: string): EtatConstante {
  const mot = {
    haut: "Trop élevée",
    bas: "Trop basse",
    dans: "Dans la norme",
    sans: "Sans seuil",
  }[sens];
  return { sens, verdict: mot, repere };
}

const VITAUX: DefinitionVital[] = [
  {
    key: "hr", label: "Fréquence cardiaque au repos", unit: "bpm",
    champ: "fc_repos_bpm", titre: "FC de repos", suffixe: " bpm", pas: 5, decimales: 0,
    alerte: (v) => v > 75,
    etat: (v, base) => verdict(v > 75 ? "haut" : "dans", `seuil 75 bpm · base ${entier(Math.round(base))}`),
  },
  {
    key: "spo2", label: "Oxygénation du sang", unit: "%",
    champ: "spo2_pct", titre: "SpO₂", suffixe: " %", pas: 2, decimales: 0,
    alerte: (v) => v < 95,
    etat: (v, base) => verdict(v < 95 ? "bas" : "dans", `seuil 95 % · base ${entier(Math.round(base))}`),
  },
  {
    key: "resp", label: "Fréquence respiratoire", unit: "/min",
    champ: "resp_min", titre: "Respiration", suffixe: " /min", pas: 2, decimales: 0,
    // La norme 12–18 existait deja, mais rien ne la faisait respecter : sans
    // cette alerte, le graphe aurait annonce « trop élevée » sur une tuile
    // restee neutre.
    alerte: (v) => v > 18 || v < 12,
    etat: (v, base) =>
      verdict(
        v > 18 ? "haut" : v < 12 ? "bas" : "dans",
        `norme 12–18 /min · base ${entier(Math.round(base))}`,
      ),
  },
  {
    key: "hrv", label: "Variabilité cardiaque · RMSSD", unit: "ms",
    champ: "rmssd_ms", titre: "Variabilité cardiaque", suffixe: " ms", pas: 5, decimales: 0,
    alerte: (v, base) => v < base * 0.8,
    etat: (v, base) =>
      verdict(
        v < base * 0.8 ? "bas" : "dans",
        `seuil ${entier(Math.round(base * 0.8))} ms · base ${entier(Math.round(base))}`,
      ),
  },
  {
    key: "temp", label: "Température cutanée", unit: "°C",
    champ: "temp_c", titre: "Température cutanée", suffixe: " °C", pas: 0.5, decimales: 1,
    // Aucun seuil publie pour une temperature CUTANEE, qui n'est pas la
    // temperature corporelle : on l'ecrit au lieu de laisser croire a une
    // normale.
    etat: (_v, base) => verdict("sans", `base perso ${fr(base, 1)} °C`),
  },
  {
    key: "eda", label: "Activité électrodermale", unit: "µS",
    champ: "eda_us", titre: "Activité électrodermale", suffixe: " µS", pas: 0.5, decimales: 1,
    alerte: (v, base) => v > base * 1.3,
    etat: (v, base) =>
      verdict(
        v > base * 1.3 ? "haut" : "dans",
        `seuil ${fr(base * 1.3, 1)} µS · base ${fr(base, 1)}`,
      ),
  },
  {
    key: "steps", label: "Pas sur 24 h",
    champ: "pas", titre: "Activité", suffixe: " pas", pas: 500, decimales: 0,
    alerte: (v) => v < 4000,
    etat: (v, base) =>
      verdict(v < 4000 ? "bas" : "dans", `plancher 4 000 pas · base ${entier(Math.round(base))}`),
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
      spark: serie.slice(-7),
      watch: def.alerte?.(valeur, base) ?? false,
      chart: {
        title: def.titre,
        subtitle: `${c.length} derniers jours · ${def.unit ?? "pas"}`,
        values: serie,
        min,
        max,
        ticks,
        refLine: Math.round(base * 10) / 10,
        etat: def.etat(valeur, base),
        unitSuffix: def.suffixe,
      },
    };
  });

  // Les secousses n'ont pas de série quotidienne : on la compose depuis les
  // événements, en comptant zéro pour les jours sans rien.
  const chutes = c.map(
    (l) => d.evenements.filter((e) => e.jour === l.jour).reduce((a, e) => a + e.n, 0),
  );
  const totalChutes = chutes.reduce((a, b) => a + b, 0);
  vitals.push({
    key: "falls",
    label: "Secousses et chutes",
    unit: "évt",
    value: String(chutes.at(-1) ?? 0),
    spark: chutes.slice(-7),
    chart: {
      title: "Secousses détectées",
      subtitle: `${c.length} derniers jours · événements`,
      values: chutes,
      min: 0,
      max: Math.max(3, ...chutes),
      ticks: [0, 1, 2, 3],
      etat: totalChutes
        ? { sens: "haut", verdict: `${totalChutes} sur la période`, repere: "toute secousse remonte" }
        : { sens: "dans", verdict: "Aucune secousse", repere: `sur ${c.length} jours` },
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
    // Une note non signée s'écrit « non signée », et pas rien du tout : c'est
    // une information pour le médecin qui la lit, pas un détail d'affichage.
    signature: p.auteur
      ? `${p.auteur}${p.constate_le ? ` · ${dateCourte(p.constate_le)}` : ""}`
      : "note non signée",
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

  // « suivi par Dr. Oyelaran » : le médecin traitant, celui qui suit le
  // résident au long cours — pas celui qui a prélevé tel bilan. La mention
  // disparaît si personne n'est rattaché, plutôt que d'afficher un tiret.
  const suiviPar = r.traitant_nom
    ? ` · suivi par ${[r.traitant_titre, r.traitant_nom].filter(Boolean).join(" ")}`
    : "";

  const tips = c.map((_, i) => (i === c.length - 1 ? "Aujourd’hui" : `J−${c.length - 1 - i}`));

  return {
    resident: {
      id: r.code,
      initials: `${r.prenom[0] ?? ""}${r.nom[0] ?? ""}`,
      name: `${r.prenom} ${r.nom}`,
      status: statut,
      meta: `${r.age} ans · ${r.poste} · Module ${r.cabine} · embarqué au J+${entier(
        r.embarque_jour_vol,
      )}${suiviPar}`,
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
    bloodReports: adapterBilans(d.bilans ?? []),
    dayLabels: etiquettes(tips),
    dayTips: tips,
  };
}

// ----------------------------------------------------------- bilan sanguin --
/** Libellés des onze panels. Les clés sont celles du CHECK de `analyses_sang`. */
const PANELS: Record<string, string> = {
  cellules_sanguines: "Cellules sanguines",
  fer: "Fer",
  foie: "Foie",
  reins: "Reins",
  sucre: "Sucre",
  thyroide: "Thyroïde",
  electrolytes: "Électrolytes",
  inflammation: "Infection et inflammation",
  lipides: "Lipides",
  vitamines: "Vitamines",
  hormones: "Hormones",
};

/** « 2026-09-22 » -> « 22/09 ». */
function dateCourte(iso: string): string {
  const [, mois, jour] = iso.split("-");
  return jour && mois ? `${jour}/${mois}` : iso;
}

/** Nombre de jours entre aujourd'hui et une date ISO, positif dans le futur. */
function joursAvant(iso: string): number {
  const cible = new Date(`${iso}T12:00:00`).getTime();
  const maintenant = new Date().setHours(12, 0, 0, 0);
  return Math.round((cible - maintenant) / 86400000);
}

/**
 * Regroupe les dosages par panel et les met en forme.
 *
 * Le serveur envoie une ligne par marqueur, dans l'ordre du panel ; la console
 * les empile dans cet ordre plutôt que de les trier à nouveau — un bilan se
 * lit toujours dans le même ordre, c'est ce qui permet de le parcourir vite.
 */
function adapterBilans(bilans: BilanApi[]): BloodReport[] {
  return bilans.map((b) => {
    const parPanel = new Map<string, BloodMarker[]>();

    for (const a of b.analyses) {
      const valeur =
        a.valeur_num !== null
          ? String(a.valeur_num).replace(".", ",")
          : (a.valeur_texte ?? "—");
      const reference =
        a.ref_bas !== null && a.ref_haut !== null
          ? `${String(a.ref_bas).replace(".", ",")}–${String(a.ref_haut).replace(".", ",")}`
          : // Un marqueur qualitatif n'a pas de bornes à comparer : on écrit la
            // norme attendue plutôt qu'un intervalle vide.
            "négatif attendu";

      const liste = parPanel.get(a.panel) ?? [];
      liste.push({
        label: a.marqueur,
        value: valeur,
        unit: a.unite ?? "",
        reference,
        level: a.interpretation,
      });
      parPanel.set(a.panel, liste);
    }

    const panels = [...parPanel.entries()].map(([cle, markers]) => ({
      key: cle,
      label: PANELS[cle] ?? cle,
      markers,
      flagged: markers.filter((m) => m.level !== "normal").length,
    }));

    const dans = b.prochain_le ? joursAvant(b.prochain_le) : null;

    return {
      date: dateCourte(b.preleve_le),
      dayLabel: `J+${entier(b.jour_vol)}`,
      doctor: b.medecin,
      comment: b.commentaire,
      next:
        dans === null
          ? null
          : dans > 0
            ? `prochaine prise de sang dans ${dans} j`
            : dans === 0
              ? "prise de sang prévue aujourd’hui"
              : `prise de sang en retard de ${-dans} j`,
      simulated: b.source === "simule",
      panels,
      flagged: panels.reduce((n, p) => n + p.flagged, 0),
    };
  });
}
