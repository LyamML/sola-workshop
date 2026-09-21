/** Gravité d'un signal. `info` couvre ce qui est remonté pour contexte seul. */
export type Severity = "crit" | "watch" | "info";

export interface Kpi {
  label: string;
  value: string;
  unit?: string;
  spark: number[];
  tone?: "watch";
  deltaDirection: "up" | "down" | "flat";
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

export interface VitalSign {
  key: string;
  label: string;
  value: string;
  unit?: string;
  reference: string;
  spark: number[];
  watch?: boolean;
  /** Constante réellement mesurée par le bracelet, ou valeur simulée. */
  measured: boolean;
  chart: {
    title: string;
    subtitle: string;
    values: number[];
    min: number;
    max: number;
    ticks: number[];
    refLine?: number;
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
}
