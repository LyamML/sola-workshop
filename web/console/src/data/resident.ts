import type { ConversationSummary, ParticularityNote, VitalSign } from "../types";

/**
 * Fiche du résident R-0448 — jeu de démonstration.
 *
 * `measured: true` marque les constantes que le bracelet KY-039 mesure
 * réellement. Les autres sont simulées et l'interface le dit : mieux vaut
 * deux mesures honnêtes que huit chiffres dont on ignore l'origine.
 */

export const RESIDENT = {
  id: "R-0448",
  initials: "LM",
  name: "Lyam Mafray",
  status: "Surveillance · 3 j",
  meta: "28 ans · Technicien hydroponie · Module C-12 · embarqué au J+0",
  device: "bracelet BR-0448 · batterie 61 % (≈ 4 j) · synchro il y a 2 min",
};

export const DAY_LABELS: (string | null)[] = [
  "J−13", null, null, "J−10", null, null, "J−7", null, null, "J−4", null, null, null, "J",
];

export const DAY_TIPS: string[] = [
  "J−13", "J−12", "J−11", "J−10", "J−9", "J−8", "J−7",
  "J−6", "J−5", "J−4", "J−3", "J−2", "J−1", "Aujourd’hui",
];

export const VITALS: VitalSign[] = [
  {
    key: "hr",
    label: "Fréquence cardiaque au repos",
    value: "62",
    unit: "bpm",
    reference: "base perso 55–70",
    spark: [60, 61, 63, 62, 64, 63, 62],
    measured: true,
    chart: {
      title: "FC de repos",
      subtitle: "14 derniers jours · bpm",
      values: [61, 62, 60, 63, 62, 64, 61, 63, 65, 64, 63, 62, 64, 62],
      min: 50,
      max: 75,
      ticks: [55, 65, 75],
      refLine: 62,
      unitSuffix: " bpm",
    },
  },
  {
    key: "spo2",
    label: "Oxygénation du sang",
    value: "97",
    unit: "%",
    reference: "norme ≥ 95",
    spark: [98, 97, 98, 97, 97, 96, 97],
    measured: false,
    chart: {
      title: "SpO₂",
      subtitle: "14 derniers jours · %",
      values: [98, 97, 98, 98, 97, 97, 98, 96, 97, 97, 96, 97, 97, 97],
      min: 92,
      max: 100,
      ticks: [94, 97, 100],
      refLine: 97,
      unitSuffix: " %",
    },
  },
  {
    key: "resp",
    label: "Fréquence respiratoire",
    value: "14",
    unit: "/min",
    reference: "norme 12–18",
    spark: [13, 14, 13, 14, 15, 14, 14],
    measured: false,
    chart: {
      title: "Respiration",
      subtitle: "14 derniers jours · cycles/min",
      values: [13, 14, 13, 13, 14, 14, 15, 14, 15, 16, 15, 14, 15, 14],
      min: 10,
      max: 20,
      ticks: [12, 16, 20],
      refLine: 14,
      unitSuffix: " /min",
    },
  },
  {
    key: "hrv",
    label: "Variabilité cardiaque · RMSSD",
    value: "31",
    unit: "ms",
    reference: "base perso 48 · −35 %",
    spark: [46, 44, 41, 37, 34, 33, 31],
    watch: true,
    measured: true,
    chart: {
      title: "Variabilité cardiaque",
      subtitle: "14 derniers jours · RMSSD, ms",
      values: [49, 47, 51, 46, 48, 44, 41, 43, 37, 34, 33, 31, 33, 31],
      min: 25,
      max: 55,
      ticks: [30, 40, 50],
      refLine: 48,
      unitSuffix: " ms",
    },
  },
  {
    key: "temp",
    label: "Température cutanée",
    value: "34,1",
    unit: "°C",
    reference: "base perso 34,0–34,6",
    spark: [34.4, 34.3, 34.2, 34.2, 34.1, 34.0, 34.1],
    measured: false,
    chart: {
      title: "Température cutanée",
      subtitle: "14 derniers jours · °C",
      values: [34.5, 34.4, 34.4, 34.3, 34.3, 34.2, 34.2, 34.3, 34.1, 34.0, 34.1, 34.0, 34.2, 34.1],
      min: 33.5,
      max: 35,
      ticks: [34, 34.5, 35],
      refLine: 34.3,
      unitSuffix: " °C",
    },
  },
  {
    key: "eda",
    label: "Activité électrodermale",
    value: "3,8",
    unit: "µS",
    reference: "base perso 1,8–2,6 · élevée",
    spark: [2.1, 2.3, 2.6, 3.0, 3.3, 3.6, 3.8],
    watch: true,
    measured: false,
    chart: {
      title: "Activité électrodermale",
      subtitle: "14 derniers jours · µS",
      values: [2.0, 2.1, 1.9, 2.2, 2.1, 2.4, 2.3, 2.6, 3.0, 3.1, 3.3, 3.5, 3.6, 3.8],
      min: 1,
      max: 4.5,
      ticks: [1.5, 3, 4.5],
      refLine: 2.2,
      unitSuffix: " µS",
    },
  },
  {
    key: "steps",
    label: "Pas sur 24 h",
    value: "6 240",
    reference: "objectif 8 000",
    spark: [8100, 7600, 7900, 7200, 6800, 6500, 6240],
    measured: false,
    chart: {
      title: "Activité",
      subtitle: "14 derniers jours · pas",
      values: [8600, 8200, 8800, 8100, 7900, 8100, 7600, 7900, 7200, 7000, 6800, 6500, 6600, 6240],
      min: 5000,
      max: 9500,
      ticks: [6000, 7500, 9000],
      refLine: 8000,
      unitSuffix: " pas",
    },
  },
  {
    key: "falls",
    label: "Secousses et chutes",
    value: "0",
    unit: "évt",
    reference: "dernier : J+3 902",
    spark: [0, 0, 0, 0, 0, 0, 0],
    measured: false,
    chart: {
      title: "Secousses détectées",
      subtitle: "14 derniers jours · événements",
      values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      min: 0,
      max: 3,
      ticks: [0, 1, 2, 3],
      unitSuffix: " évt",
    },
  },
];

/** Durées de sommeil des 14 dernières nuits, en heures. */
export const SLEEP_NIGHTS = [
  7.1, 6.8, 7.4, 6.2, 7.0, 6.6, 5.9, 6.4, 5.2, 4.9, 5.4, 5.1, 6.0, 5.3,
];

export const TOTAL_CONVERSATIONS = 138;

export const CONVERSATIONS: ConversationSummary[] = [
  {
    id: "c1",
    date: "J+4 128 · 22:41",
    sortKey: 4128.2241,
    severity: "watch",
    severityLabel: "Surveillance",
    tags: ["Sommeil", "Irritabilité"],
    durationMinutes: 11,
    summary:
      "3<sup>e</sup> nuit consécutive sous 5 h 30. Attribue les réveils à un bruit de ventilation dans le module C — demande de contrôle acoustique transmise à la maintenance. Ton irritable, phrases courtes, plusieurs ruptures de conversation. <q>Je n’arrive plus à me concentrer sur rien</q>. Dépistage d’idéation suicidaire négatif (C-SSRS, items 1–2). Contact social proposé et accepté.",
    facts: ["Durée 11 min", "2 actions proposées · 2 acceptées", "Remonté automatiquement"],
  },
  {
    id: "c2",
    date: "J+4 125 · 23:02",
    sortKey: 4125.2302,
    severity: "info",
    severityLabel: "Contexte",
    tags: ["Sommeil"],
    durationMinutes: 6,
    summary:
      "Demande spontanée de conseils d’endormissement. Exercice de respiration 4-7-8 proposé et suivi jusqu’au bout. Aucun marqueur d’humeur basse sur l’échange.",
    facts: ["Durée 6 min", "1 action proposée · 1 acceptée", "Remonté pour contexte"],
  },
  {
    id: "c3",
    date: "J+4 119 · 20:15",
    sortKey: 4119.2015,
    severity: "watch",
    severityLabel: "Surveillance",
    tags: ["Humeur basse", "Isolement"],
    durationMinutes: 19,
    summary:
      "Évoque un sentiment d’inutilité après l’incident du bac 7 (J+4 117). Décline le repas collectif pour la 3<sup>e</sup> fois de la semaine. Sola a proposé un appel à l’équipe hydroponie — refusé à deux reprises. Repli verbal marqué en fin d’échange.",
    facts: ["Durée 19 min", "3 actions proposées · 0 acceptée", "Remonté automatiquement"],
  },
  {
    id: "c4",
    date: "J+4 096 · 21:30",
    sortKey: 4096.213,
    severity: "info",
    severityLabel: "Contexte",
    tags: ["Deuil", "Date anniversaire"],
    durationMinutes: 41,
    summary:
      "Anniversaire du départ de la Terre. Évoque longuement sa sœur restée au sol. Échange apaisé, marqueurs prosodiques en nette amélioration en fin de conversation. Aucune action nécessaire — noté pour anticiper la même date l’an prochain.",
    facts: ["Durée 41 min", "Aucune action proposée", "Remonté pour contexte"],
  },
];

export const PARTICULARITIES: ParticularityNote[] = [
  {
    icon: "!",
    title: "Arachide — allergie sévère",
    detail:
      "Choc anaphylactique en 2076. Auto-injecteur d’adrénaline en cabine C-12 et à l’infirmerie B. Régime tracé à la cuisine centrale.",
    level: "crit",
  },
  {
    icon: "!",
    title: "AINS — proscrits",
    detail: "Antécédent d’ulcère gastrique (2078). Paracétamol en première intention.",
    level: "crit",
  },
  {
    icon: "△",
    title: "Pénicilline — allergie",
    detail: "Éruption cutanée généralisée. Alternative : macrolides.",
    level: "watch",
  },
  {
    icon: "△",
    title: "Asthme d’effort",
    detail: "Salbutamol à la demande. Dernière crise : J+3 840, sans hospitalisation.",
    level: "watch",
  },
  {
    icon: "i",
    title: "Épisode dépressif caractérisé (2077)",
    detail:
      "Rémission complète sous suivi. Facteur de vulnérabilité à considérer dans l’interprétation des signaux actuels — pas un diagnostic en cours.",
  },
  {
    icon: "i",
    title: "Intolérance au lactose · lentilles −3,5 / −3,75",
    detail: "Groupe sanguin O−. Vaccination de bord à jour, rappel au J+4 300.",
  },
];

export const FOLLOW_UP: ParticularityNote[] = [
  {
    icon: "℞",
    title: "Mélatonine 2 mg · 21:00",
    detail:
      "Recalage circadien depuis le J+4 120. Observance 9 prises sur 9, confirmée par le bracelet.",
  },
  {
    icon: "☀",
    title: "Lumière de cabine avancée à 19:00",
    detail: "Proposé par Sola au J+4 128, accepté par le résident. À réévaluer au J+4 135.",
  },
  {
    icon: "◷",
    title: "Entretien psychologique bimensuel",
    detail: "Prochain créneau : J+4 134 à 15:00, infirmerie B. Dr. A. Ferreira.",
  },
  {
    icon: "♡",
    title: "Amara Mafray · sœur · C-15",
    detail:
      "Personne de confiance déclarée, joignable en urgence. Autorisation donnée par le résident au J+4 001.",
  },
];
