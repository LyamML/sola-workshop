/**
 * Ce que les écrans 02 et 03 affichent, une fois la réponse du serveur mise
 * en forme par `adapt.ts`.
 *
 * Les chaînes arrivent prêtes (« 6 240 », « J+4 128 », « 5 h 18 ») : un
 * composant pose ce qu'il reçoit. Restent bruts les compteurs, parce que le
 * composant accorde la phrase qui les entoure (« 1 ouvert », « 3 ouverts »),
 * et les champs qui dépendent de la personne connectée — l'identifiant de
 * l'assigné, pour savoir si c'est « vous » —, parce que l'adaptateur ne sait
 * pas qui regarde.
 */
import type { Niveau, Origine, StatutSignal } from "./api";

/** La teinte d'une pastille. */
export type Ton = "crit" | "watch" | "ok" | "neutre";

export interface Pastille {
  libelle: string;
  ton: Ton;
}

// ------------------------------------------------------------- courbes --
export interface Repere {
  valeur: number;
  libelle: string;
}

export interface Courbe {
  /** Le nom de la série : titre de la figure et première entrée de la légende. */
  nom: string;
  points: { x: number; y: number }[];
  /** Tracés en tirets, dans la couleur de vigilance. */
  seuils: Repere[];
  /** La base personnelle, en pointillé. */
  base: Repere | null;
  /** Ce que la légende dit des seuils, quand leur libellé ne suffit pas. */
  legendeSeuil?: string;
  /** La série passe dans la couleur de vigilance. */
  alerte: boolean;
  /** Largeur du dessin, en unités du viewBox : la hauteur est fixe. */
  largeur: number;
  /** Place réservée aux graduations de gauche. */
  marge?: number;
  graduationsX: number[];
  /** L'étendue des abscisses, quand elle dépasse celle des points. */
  domaineX?: [number, number];
  formatY?: (v: number) => string;
  /** La valeur d'un point, telle que l'infobulle l'écrit. */
  bulle: (v: number) => string;
}

// --------------------------------------------------------- écran 02 --
export type CleIndicateur = "indice" | "phq9" | "gad7" | "isi";

export interface Indicateur {
  cle: CleIndicateur;
  libelle: string;
  valeur: string;
  unite: string;
  /** « 104 résidents » ; absent pour l'indice, qui est une moyenne. */
  residents: string | null;
}

export interface Periode {
  cle: "7" | "30" | "365";
  libelle: string;
  /** Premier et dernier jour des points retenus : c'est sur eux que l'écart se calcule. */
  debut: string;
  fin: string;
  ecarts: Record<CleIndicateur, Pastille>;
  courbes: Record<CleIndicateur, Courbe>;
}

export interface Barre {
  libelle: string;
  valeur: string;
  /** Longueur en %, relative à la plus longue barre. */
  part: number;
}

export interface LigneFile {
  id: number;
  gravite: Pastille;
  resident: string;
  nom: string;
  /** « R-0912 · C-14 · 34 ans » */
  details: string;
  motif: string;
  origine: Origine;
  heure: string;
  /** Le jour d'ouverture, quand toute la file n'est pas du même jour. */
  jour: string | null;
  statut: StatutSignal;
  assigne: string | null;
  assigneId: number | null;
}

export interface VueCrew {
  ancre: { jour: string; jourVol: number };
  /** « 1 240 résidents · J+4 128 · dernière synchro 16:04 » */
  entete: string;
  indicateurs: Indicateur[];
  periodes: Periode[];
  remonte: {
    motifs: { conversations: string; barres: Barre[] };
    modules: Barre[];
    physio: { nuit: string; barres: Barre[] };
  };
  file: LigneFile[];
  compteurs: { ouverts: number; critiques: number; sansPersonne: number };
  piedFile: string;
}

// --------------------------------------------------------- écran 03 --
export type CleConstante = "hrv" | "hr" | "spo2" | "resp" | "sleep" | "eda" | "temp" | "steps";

export interface Constante {
  cle: CleConstante;
  libelle: string;
  valeur: string;
  unite: string | null;
  alerte: boolean;
  /** La partie en gras : « ▼ sous le seuil 38 depuis 6 j ». */
  ecart: string | null;
  /** La suite, en clair : « base 47 », « — dans la norme · seuil 75 ». */
  repere: string | null;
  /**
   * La tuile à une lecture du bracelet, pour une constante qu'il mesure à
   * chaque envoi : la fiche la prend tant qu'il envoie (`suivreLeDirect`).
   */
  enDirect?: {
    champ: "spo2_pct" | "rmssd_ms" | "temp_c" | "pas";
    lire: (v: number) => Pick<Constante, "valeur" | "alerte" | "ecart" | "repere">;
  };
  /**
   * Une constante qui s'accumule dans la journée — les pas —, quand son
   * dernier jour, `x`, n'est peut-être pas fini : la tuile qui le dit en
   * cours, avec le verdict de la veille plutôt que le sien. La fiche la prend
   * si le bracelet remplit encore ce jour-là (`suivreLeDirect`).
   */
  enCours?: { x: number } & Pick<Constante, "alerte" | "ecart" | "repere">;
  courbe: Courbe;
}

export interface SignalFiche {
  id: number;
  gravite: Pastille;
  /** « Surveillance · physio · J+4 128 · 06:20 » */
  entete: string;
  motif: string;
  statut: StatutSignal;
  assigne: string | null;
  assigneId: number | null;
  motifsCloture: string[];
}

export interface NoteFiche {
  id: number;
  niveau: Niveau;
  titre: string;
  detail: string;
  /** « Dr. Oyelaran · 23/09 », ou « note non signée ». */
  signature: string;
}

export interface ConversationFiche {
  id: number;
  entete: string;
  gravite: Pastille;
  tags: string[];
  duree: string;
  resume: string;
  /** « 2 actions proposées · 2 acceptées · remonté automatiquement » */
  actions: string;
  notifie: boolean;
}

export interface ContexteFiche {
  id: number;
  entete: string;
  tags: string[];
  duree: string;
  notifie: boolean;
}

export type IconeSuivi = "pill" | "sun" | "cal" | "user" | "pulse";

export interface SuiviFiche {
  icone: IconeSuivi;
  titre: string;
  detail: string;
}

export interface Marqueur {
  nom: string;
  /** « 711 pmol/L », ou « Négatif » pour un résultat en toutes lettres. */
  valeur: string;
  /** « 150–650 », « > 0,4 » ; rien pour un qualitatif dans la norme. */
  repere: string | null;
  ton: "normal" | "hors" | "critique";
}

export interface Panneau {
  cle: string;
  libelle: string;
  marqueurs: Marqueur[];
}

export interface BilanFiche {
  id: number;
  /** L'intitulé court du sélecteur : « 23/09 · J+4 128 ». */
  option: string;
  sous: string;
  /** « Vitamine B12 · 711 pmol/L · repère 150–650 » */
  horsBorne: string[];
  commentaire: string | null;
  panneaux: Panneau[];
  prochain: string;
  simule: boolean;
}

export interface VueResident {
  code: string;
  ancre: { jour: string; jourVol: number };
  identite: {
    initiales: string;
    nom: string;
    statut: Pastille;
    /** « R-0448 · 28 ans · Technicien hydroponie · Cabine C-12 · suivi par Dr. Oyelaran » */
    meta: string;
    confiance: { nom: string; suite: string } | null;
    bracelet: string | null;
  };
  signaux: SignalFiche[];
  /** « du J+4 115 au J+4 128 » */
  fenetre: string;
  constantes: Constante[];
  evenements: { alerte: boolean; texte: string };
  notes: NoteFiche[];
  conversations: {
    total: number;
    remontees: number;
    contexte: number;
    liste: ConversationFiche[];
    contexteListe: ContexteFiche[];
    /** Les résumés de contexte en base au-delà de ceux servis. */
    contexteAutres: number;
  };
  suivis: SuiviFiche[];
  bilans: BilanFiche[];
}
