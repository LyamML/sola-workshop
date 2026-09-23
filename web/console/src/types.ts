/** Gravité d'un signal. `info` couvre ce qui est remonté pour contexte seul. */
export type Severity = "crit" | "watch" | "info";

export interface Kpi {
  label: string;
  value: string;
  unit?: string;
  spark: number[];
  tone?: "watch";
  deltaDirection: "up" | "down" | "flat";
  /**
   * Couleur de la pastille, qui suit le sens CLINIQUE et non le signe : une
   * baisse du bien-être se lit en rouge, une baisse du PHQ-9 en vert. Absent,
   * la direction sert de couleur.
   */
  deltaTone?: "up" | "down" | "flat";
  deltaLabel: string;
  footNote: string;
}

export interface BarRow {
  name: string;
  value: number;
  tone?: "watch" | "crit";
}

export interface WellbeingSeries {
  values: number[];
  min: number;
  max: number;
  ticks: number[];
  refLine: number;
  labels: (string | null)[];
  tips: string[];
  subtitle: string;
  note?: { index: number; text: string };
}

export interface TriageSignal {
  severity: Severity;
  severityLabel: string;
  residentId: string;
  location: string;
  trigger: string;
  openedAt: string;
  assignee: string;
  unassigned?: boolean;
}

/**
 * De quel côté la dernière mesure tombe par rapport à la règle qui la juge.
 * `sans` couvre les constantes pour lesquelles aucun seuil n'est défini : on
 * le dit plutôt que de laisser croire à une normale.
 */
export type SensEcart = "haut" | "bas" | "dans" | "sans";

/** Le verdict affiché sous le graphe d'une constante. */
export interface EtatConstante {
  sens: SensEcart;
  /** En clair : « Trop élevée », « Dans la norme »… */
  verdict: string;
  /** La règle et la base personnelle, pour qu'on voie sur quoi il s'appuie. */
  repere: string;
}

export interface VitalSign {
  key: string;
  label: string;
  value: string;
  unit?: string;
  spark: number[];
  watch?: boolean;
  chart: {
    title: string;
    subtitle: string;
    values: number[];
    min: number;
    max: number;
    ticks: number[];
    refLine?: number;
    /** Position de la dernière mesure : c'est la légende du graphe. */
    etat?: EtatConstante;
    unitSuffix: string;
  };
}

export interface ConversationSummary {
  id: string;
  date: string;
  /** Clé de tri chronologique : jour de vol + heure. */
  sortKey: number;
  severity: Severity;
  severityLabel: string;
  tags: string[];
  durationMinutes: number;
  summary: string;
  facts: string[];
}

export interface ParticularityNote {
  icon: string;
  title: string;
  detail: string;
  level?: "crit" | "watch";
  /** « Dr. Nakamura · 12/09 », ou absent quand la note n'est pas signée. */
  signature?: string;
}

/**
 * Bilan sanguin tel que la fiche l'affiche : les dosages sont déjà groupés par
 * panel et formatés. La virgule décimale et l'écriture des bornes de référence
 * sont de la présentation, elles restent ici.
 */
export interface BloodPanel {
  key: string;
  label: string;
  markers: BloodMarker[];
  /** Nombre de marqueurs hors bornes dans ce panel. */
  flagged: number;
}

export interface BloodMarker {
  label: string;
  value: string;
  unit: string;
  reference: string;
  level: "normal" | "bas" | "eleve" | "critique";
}

export interface BloodReport {
  date: string;
  dayLabel: string;
  doctor: string | null;
  comment: string | null;
  next: string | null;
  simulated: boolean;
  panels: BloodPanel[];
  flagged: number;
}
