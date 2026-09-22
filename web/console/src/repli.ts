import type { adapterCrew, adapterResident } from "./adapt";
import {
  KPIS,
  MODULE_BARS,
  MOTIF_BARS,
  PHYSIO_BARS,
  SHIP,
  TRIAGE,
  WELLBEING,
} from "./data/crew";
import {
  CONVERSATIONS,
  DAY_LABELS,
  DAY_TIPS,
  FOLLOW_UP,
  PARTICULARITIES,
  RESIDENT,
  SLEEP_NIGHTS,
  TOTAL_CONVERSATIONS,
  VITALS,
} from "./data/resident";

/**
 * Le jeu de démonstration, présenté dans la même forme que les réponses du
 * serveur.
 *
 * Il n'a pas disparu quand la console a été branchée sur l'API : il sert de
 * repli quand le serveur ne répond pas, et de référence pour vérifier que
 * l'adaptateur produit bien la même chose que les maquettes. Si les deux
 * divergent à l'écran, c'est l'adaptateur qui a tort.
 *
 * Les types sont déduits des adaptateurs plutôt que réécrits : ajouter un
 * champ à `adapterCrew` sans l'ajouter ici devient une erreur de compilation.
 */
export const REPLI_CREW: ReturnType<typeof adapterCrew> = {
  ship: SHIP,
  kpis: KPIS,
  wellbeing: WELLBEING,
  modules: MODULE_BARS,
  motifs: MOTIF_BARS,
  physio: PHYSIO_BARS,
  triage: TRIAGE,
  compteurs: {
    ouverts: TRIAGE.length,
    critiques: TRIAGE.filter((s) => s.severity === "crit").length,
    non_assignes: TRIAGE.filter((s) => s.unassigned).length,
  },
  maxModule: 16,
  maxMotif: 330,
  maxPhysio: 14,
};

export const REPLI_RESIDENT: ReturnType<typeof adapterResident> = {
  resident: RESIDENT,
  vitals: VITALS,
  sleepNights: SLEEP_NIGHTS,
  conversations: CONVERSATIONS,
  totalConversations: TOTAL_CONVERSATIONS,
  particularities: PARTICULARITIES,
  followUp: FOLLOW_UP,
  dayLabels: DAY_LABELS,
  dayTips: DAY_TIPS,
};
