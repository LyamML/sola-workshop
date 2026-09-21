import type { BarRow, Kpi, TriageSignal, WellbeingSeries } from "../types";

/**
 * Données d'équipage — jeu de démonstration.
 * À remplacer par les agrégats du serveur de bord (une requête par bloc).
 */

export const SHIP = {
  name: "Méridien",
  residents: 1240,
  flightDay: "J+4 128",
  lastSync: "il y a 4 min",
};

export const KPIS: Kpi[] = [
  {
    label: "Indice de bien-être",
    value: "72,4",
    unit: "/100",
    spark: [78, 77, 77, 76, 74, 73, 72],
    tone: "watch",
    deltaDirection: "up",
    deltaLabel: "▲ 2,8 pt",
    footNote: "sur 30 jours",
  },
  {
    label: "Dépistage dépressif · PHQ-9 ≥ 10",
    value: "8,4",
    unit: "%",
    spark: [7.1, 7.3, 7.4, 7.8, 8.0, 8.2, 8.4],
    tone: "watch",
    deltaDirection: "up",
    deltaLabel: "▲ 1,1 pt",
    footNote: "104 résidents",
  },
  {
    label: "Anxiété · GAD-7 ≥ 10",
    value: "6,1",
    unit: "%",
    spark: [6.6, 6.5, 6.4, 6.5, 6.3, 6.2, 6.1],
    deltaDirection: "down",
    deltaLabel: "▼ 0,4 pt",
    footNote: "76 résidents",
  },
  {
    label: "Troubles du sommeil · ISI ≥ 15",
    value: "14,2",
    unit: "%",
    spark: [11.4, 11.9, 12.4, 13.0, 13.5, 13.9, 14.2],
    tone: "watch",
    deltaDirection: "up",
    deltaLabel: "▲ 2,3 pt",
    footNote: "176 résidents",
  },
];

export type PeriodKey = "7" | "30" | "365";

export const WELLBEING: Record<PeriodKey, WellbeingSeries> = {
  "7": {
    values: [74.1, 73.6, 73.2, 72.9, 73.4, 72.7, 72.4],
    min: 70,
    max: 76,
    ticks: [71, 73, 75],
    refLine: 70,
    labels: ["J−6", null, null, "J−3", null, null, "J"],
    tips: ["J−6", "J−5", "J−4", "J−3", "J−2", "J−1", "Aujourd’hui"],
    subtitle: "7 derniers jours · moyenne équipage",
  },
  "30": {
    values: [75.1, 74.8, 74.2, 73.9, 74.4, 73.6, 73.1, 72.8, 73.3, 72.6, 72.9, 72.4],
    min: 70,
    max: 77,
    ticks: [71, 73, 75, 77],
    refLine: 70,
    labels: ["J−30", null, null, "J−22", null, null, "J−15", null, null, "J−7", null, "J"],
    tips: [
      "J−30", "J−27", "J−24", "J−22", "J−19", "J−16",
      "J−15", "J−12", "J−9", "J−7", "J−3", "Aujourd’hui",
    ],
    subtitle: "30 derniers jours · moyenne équipage",
    note: { index: 6, text: "Bascule du cycle lumineux" },
  },
  "365": {
    values: [78.1, 77.4, 76.9, 77.8, 75.2, 74.0, 71.1, 69.8, 72.6, 74.3, 75.1, 72.4],
    min: 66,
    max: 80,
    ticks: [68, 72, 76, 80],
    refLine: 70,
    labels: ["J+3770", null, null, "J+3860", null, null, "J+3950", null, null, "J+4040", null, null],
    tips: [
      "J+3 770", "J+3 800", "J+3 830", "J+3 860", "J+3 890", "J+3 920",
      "J+3 950", "J+3 981", "J+4 010", "J+4 040", "J+4 070", "J+4 128",
    ],
    subtitle: "12 derniers mois · moyenne équipage",
    note: { index: 7, text: "Panne d’éclairage circadien — module C" },
  },
};

export const MODULE_BARS: BarRow[] = [
  { name: "Module C · Hydroponie", value: 14.8, tone: "crit" },
  { name: "Module A · Commandement", value: 9.2 },
  { name: "Module E · Maintenance", value: 8.6 },
  { name: "Module B · Habitat 1", value: 6.4 },
  { name: "Module D · Habitat 2", value: 5.9 },
  { name: "Module F · Recherche", value: 4.1 },
];

export const MOTIF_BARS: BarRow[] = [
  { name: "Troubles du sommeil", value: 312 },
  { name: "Humeur basse", value: 187 },
  { name: "Anxiété, stress chronique", value: 141 },
  { name: "Isolement social", value: 96 },
  { name: "Désynchronisation circadienne", value: 74 },
  { name: "Dépendance au compagnon", value: 27 },
];

export const PHYSIO_BARS: BarRow[] = [
  { name: "HRV sous la base personnelle", value: 11.3, tone: "watch" },
  { name: "Sommeil < 6 h", value: 9.7, tone: "watch" },
  { name: "Activité < 4 000 pas", value: 7.8 },
  { name: "FC de repos élevée", value: 4.2 },
  { name: "SpO₂ < 95 %", value: 1.6 },
  { name: "Chute détectée", value: 0.3 },
];

export const TRIAGE: TriageSignal[] = [
  {
    severity: "crit",
    severityLabel: "Critique",
    residentId: "R-0912",
    location: "C-14 · 34 ans",
    trigger: "HRV sous 18 ms depuis 4 jours + verbalisation de désespoir détectée en conversation",
    openedAt: "00:12",
    assignee: "Non assigné",
    unassigned: true,
  },
  {
    severity: "crit",
    severityLabel: "Critique",
    residentId: "R-1147",
    location: "E-03 · 51 ans",
    trigger: "SpO₂ à 88 % au repos pendant 6 min · antécédent BPCO",
    openedAt: "00:41",
    assignee: "Dr. Oyelaran",
  },
  {
    severity: "crit",
    severityLabel: "Critique",
    residentId: "R-0233",
    location: "A-07 · 62 ans",
    trigger: "Chute détectée par l’accéléromètre · aucune réponse à la borne après 90 s",
    openedAt: "02:05",
    assignee: "Équipe d’intervention",
  },
  {
    severity: "watch",
    severityLabel: "Surveillance",
    residentId: "R-0448",
    location: "C-12 · 28 ans",
    trigger: "3 nuits sous 5 h 30 · HRV −35 % vs base personnelle · ton irritable",
    openedAt: "06:20",
    assignee: "Dr. Ferreira",
  },
  {
    severity: "watch",
    severityLabel: "Surveillance",
    residentId: "R-0781",
    location: "B-22 · 41 ans",
    trigger: "Retrait social depuis 12 jours · 4 invitations déclinées · activité −48 %",
    openedAt: "09:15",
    assignee: "Non assigné",
    unassigned: true,
  },
  {
    severity: "info",
    severityLabel: "Dépendance",
    residentId: "R-1003",
    location: "F-05 · 24 ans",
    trigger:
      "Usage du compagnon 9 h 40 / jour (+180 % en 3 semaines) · 2 interactions humaines / semaine",
    openedAt: "11:02",
    assignee: "Dr. Ferreira",
  },
];
