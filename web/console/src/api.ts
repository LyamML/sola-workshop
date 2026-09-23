/**
 * Lecture et écriture du serveur de bord.
 *
 * La console fonctionne SANS serveur : si l'API ne répond pas, les écrans 02
 * et 03 retombent sur le repli de `src/data/`, une réponse de ce même serveur
 * figée par `scripts/db-repli.mjs`. Une console médicale qui
 * affiche une page blanche parce qu'un service est tombé est pire
 * qu'inutile, et une soutenance où le serveur refuse de démarrer ne doit pas
 * devenir une soutenance sans écrans.
 *
 * L'origine se règle par `VITE_API_URL` ; par défaut le serveur local.
 */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5175";

/** Au-delà, on considère le serveur absent plutôt que lent. */
const DELAI_MS = 2500;

/** Porte le code HTTP, pour distinguer un refus d'une donnée invalide. */
export class ErreurApi extends Error {
  constructor(
    public statut: number,
    message: string,
    /** Le corps de la réponse : un 409 dit qui a pris le signal. */
    public corps: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function lire<T>(chemin: string): Promise<T> {
  const arret = new AbortController();
  const minuteur = setTimeout(() => arret.abort(), DELAI_MS);
  try {
    // `credentials: "include"` : le cookie de session est posé par le serveur
    // sur un autre port, et sans cette option le navigateur ne le renvoie pas.
    const reponse = await fetch(`${BASE}${chemin}`, {
      signal: arret.signal,
      credentials: "include",
    });
    if (!reponse.ok) throw new ErreurApi(reponse.status, `HTTP ${reponse.status}`);
    return (await reponse.json()) as T;
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Lecture comme écriture passent par la session : c'est le cookie `httpOnly`
 * posé à la connexion qui dit QUI écrit, et c'est pour cela qu'une note ou
 * une clôture porte un nom.
 *
 * Pas de délai d'abandon ici, contrairement à la lecture : une écriture
 * abandonnée côté client mais aboutie côté serveur laisse croire à un échec,
 * et on recommence. Mieux vaut attendre.
 */
async function envoyer<T>(methode: "POST" | "PATCH", chemin: string, corps: unknown): Promise<T> {
  const reponse = await fetch(`${BASE}${chemin}`, {
    method: methode,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(corps),
  });
  const donnees = (await reponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!reponse.ok) {
    const message = typeof donnees.erreur === "string" ? donnees.erreur : `HTTP ${reponse.status}`;
    throw new ErreurApi(reponse.status, message, donnees);
  }
  return donnees as T;
}

export type Niveau = "critique" | "surveillance" | "info";

export interface NouvelleNote {
  titre: string;
  detail: string;
  niveau: Niveau;
}

export interface Compte {
  role: "medecin" | "admin";
  id: number;
  prenom: string;
  nom: string;
  email: string;
  /** Matricule M-007 — les médecins seuls en ont un. */
  code: string | null;
  titre: string | null;
}

export const api = {
  /**
   * Qui est connecté. Appelé au chargement : sa réponse décide entre les
   * écrans et le formulaire de connexion. Un 401 est une réponse normale ici,
   * pas une panne — c'est simplement « personne ».
   */
  moi: () => lire<{ compte: Compte }>("/auth/moi"),
  connexion: (email: string, mdp: string) =>
    envoyer<{ compte: Compte }>("POST", "/auth/connexion", { email, mdp }),
  deconnexion: () => envoyer<{ ok: true }>("POST", "/auth/deconnexion", {}),

  crew: () => lire<CrewApi>("/api/crew"),
  resident: (code: string) => lire<ResidentApi>(`/api/residents/${encodeURIComponent(code)}`),
  statsSignaux: () => lire<StatsSignauxApi>("/api/signaux/stats"),

  /** L'assigne au compte connecté et le passe « en cours ». */
  prendre: (id: number) => envoyer<{ signal: SignalApi }>("PATCH", `/api/signaux/${id}`, { geste: "prendre" }),
  /** Le motif doit être l'un de ceux que l'origine du signal propose. */
  clore: (id: number, motif: string) =>
    envoyer<{ signal: SignalApi; statut_resident: StatutResident }>("PATCH", `/api/signaux/${id}`, {
      geste: "clore",
      motif,
    }),

  ajouterNote: (code: string, note: NouvelleNote) =>
    // `type` reste « info » : le formulaire de la console ne demande pas de
    // ranger la note entre allergie, contre-indication et antécédent. C'est
    // la priorité qui décide où la note s'affiche dans le bandeau.
    envoyer<{ id: number }>("POST", `/api/residents/${encodeURIComponent(code)}/particularites`, {
      ...note,
      type: "info",
    }),
};

// ----------------------------------------------------------------- types --
export type SeveriteApi = "critique" | "surveillance" | "info";
export type StatutResident = "ok" | "surveillance" | "critique";
export type StatutSignal = "ouvert" | "en_cours" | "clos";
export type Origine = "physio" | "conversation" | "chute" | "usage" | "manuel";

/** Le jour que la base tient pour « aujourd'hui » (`v_jour_courant`). */
export interface AncreApi {
  jour: string;
  jour_vol: number;
}

/** Un signal tel que le renvoie un geste. */
export interface SignalApi {
  id: number;
  resident_id: number;
  origine: Origine;
  statut: StatutSignal;
  assigne_id: number | null;
  assigne_a: string | null;
  clos_at: string | null;
  clos_motif: string | null;
}

export interface CrewApi {
  vaisseau: { nom: string; residents: number; jour_vol: number; synchro_at: string | null };
  ancre: AncreApi;
  depistage: {
    residents: number;
    indice_bienetre: number;
    pct_phq9: number;
    pct_gad7: number;
    pct_isi: number;
    n_phq9: number;
    n_gad7: number;
    n_isi: number;
  } | null;
  serie: {
    jour: string;
    jour_vol: number;
    indice: number;
    pct_phq9: number;
    pct_gad7: number;
    pct_isi: number;
    residents: number;
  }[];
  modules: { module: string; signaux: number; pct_residents: number }[];
  motifs: { motif: string; conversations: number }[];
  conversations_30j: number;
  physio: { libelle: string; pct: number }[];
  triage: {
    id: number;
    severite: SeveriteApi;
    origine: Origine;
    motif: string;
    statut: StatutSignal;
    resident: string;
    prenom: string;
    nom: string;
    cabine: string;
    age: number;
    ouvert_at: string;
    ouvert_jour_vol: number;
    assigne_a: string | null;
    assigne_id: number | null;
  }[];
  compteurs: { ouverts: number; critiques: number; non_assignes: number };
}

export interface ResidentApi {
  ancre: AncreApi;
  /** Les quatorze jours affichés, bornes comprises. */
  fenetre: { debut: string; fin: string; debut_jour_vol: number; fin_jour_vol: number };
  resident: {
    id: number;
    code: string;
    prenom: string;
    nom: string;
    poste: string;
    cabine: string;
    groupe_sanguin: string;
    statut: StatutResident;
    embarque_jour_vol: number;
    age: number;
    confiance_code: string | null;
    confiance_prenom: string | null;
    confiance_nom: string | null;
    confiance_cabine: string | null;
    confiance_lien: string | null;
    /**
     * Le médecin traitant. Null tant qu'aucun soignant n'est rattaché : on
     * n'invente pas un nom pour remplir la ligne.
     */
    traitant_code: string | null;
    traitant_titre: string | null;
    traitant_prenom: string | null;
    traitant_nom: string | null;
  };
  bracelet: {
    serie: string;
    firmware: string;
    batterie_pct: number | null;
    synchro_at: string | null;
  } | null;
  constantes: {
    jour: string;
    jour_vol: number;
    fc_repos_bpm: number | null;
    rmssd_ms: number | null;
    spo2_pct: number | null;
    resp_min: number | null;
    temp_c: number | null;
    eda_us: number | null;
    pas: number | null;
    source: string;
  }[];
  /** `nuit_du` est la date du lever : la nuit du 22 au 23 compte pour le 23. */
  nuits: { nuit_du: string; jour_vol: number; sommeil_min: number | null }[];
  evenements: { jour: string; type: string; n: number }[];
  signaux: {
    id: number;
    severite: SeveriteApi;
    origine: Origine;
    motif: string;
    ouvert_at: string;
    ouvert_jour_vol: number;
    statut: StatutSignal;
    assigne_a: string | null;
    assigne_id: number | null;
    motifs_cloture: string[];
  }[];
  conversations: {
    id: number;
    debut_at: string;
    jour_vol: number;
    duree_min: number;
    severite: SeveriteApi;
    resume: string;
    actions_proposees: number;
    actions_acceptees: number;
    resident_notifie_at: string | null;
    tags: string[];
  }[];
  /** Les résumés sous le seuil : l'en-tête seulement, jamais le texte. */
  contexte: {
    id: number;
    debut_at: string;
    jour_vol: number;
    duree_min: number;
    severite: SeveriteApi;
    resident_notifie_at: string | null;
    tags: string[];
  }[];
  conversations_compte: { total: number; remontees: number; contexte: number };
  particularites: {
    id: number;
    type: string;
    niveau: SeveriteApi;
    titre: string;
    detail: string;
    constate_le: string | null;
    /** Null pour les notes antérieures aux comptes : elles n'ont pas d'auteur. */
    auteur: string | null;
  }[];
  suivis: {
    type: string;
    titre: string;
    detail: string;
    debut_jour_vol: number | null;
    echeance_jour_vol: number | null;
  }[];
  bilans: BilanApi[];
}

/** Une consultation avec prise de sang, et ses dosages. */
export interface BilanApi {
  id: number;
  preleve_le: string;
  jour_vol: number;
  prochain_le: string | null;
  /** Compté depuis le jour courant de la base, pas depuis l'horloge du poste. */
  prochain_dans_j: number | null;
  statut: "planifie" | "preleve" | "rendu";
  commentaire: string | null;
  source: "analyse" | "simule";
  medecin: string | null;
  analyses: AnalyseApi[];
}

export interface AnalyseApi {
  panel: string;
  marqueur: string;
  /** L'un des deux est renseigné : un dosage chiffré, ou un résultat en toutes lettres. */
  valeur_num: number | null;
  valeur_texte: string | null;
  unite: string | null;
  ref_bas: number | null;
  ref_haut: number | null;
  interpretation: "normal" | "bas" | "eleve" | "critique";
}

export interface StatsSignauxApi {
  /** Pour l'en-tête du registre, qui n'a pas d'autre réponse où les lire. */
  ancre: AncreApi;
  residents: number;
  a_traiter: { ouverts: number; critiques: number; non_assignes: number };
  clos: {
    total: number;
    faux_positifs: number;
    /** Clos avec un motif que leur origine ne propose pas. */
    a_revoir: number;
    par_origine: { origine: Origine; clos: number; faux_positifs: number }[];
  };
}
