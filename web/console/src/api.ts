/**
 * Lecture du serveur de bord.
 *
 * La console fonctionne SANS serveur : si l'API ne répond pas, les pages
 * retombent sur le jeu de démonstration de `src/data/`. Ce n'est pas de la
 * prudence gratuite — une console médicale qui affiche une page blanche parce
 * qu'un service est tombé est pire qu'inutile, et une soutenance où le serveur
 * refuse de démarrer ne doit pas devenir une soutenance sans écrans.
 *
 * L'origine se règle par `VITE_API_URL` ; par défaut le serveur local.
 */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5175";

/** Au-delà, on considère le serveur absent plutôt que lent. */
const DELAI_MS = 2500;

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

// ---------------------------------------------------------------- écriture --
/**
 * Lecture comme écriture passent par la session.
 *
 * Le médecin se connecte une fois, avec son adresse et son mot de passe ; le
 * serveur pose un cookie `httpOnly` qu'aucun script de la page ne peut lire.
 * C'est ce cookie qui dit QUI écrit, et c'est pour cela qu'une note de dossier
 * porte enfin un nom — ce qu'un jeton partagé, recopié à la main dans un
 * champ, ne pouvait pas faire.
 */

/** Porte le code HTTP, pour distinguer un refus d'une donnée invalide. */
export class ErreurApi extends Error {
  constructor(
    public statut: number,
    message: string,
  ) {
    super(message);
  }
}

async function poster<T>(chemin: string, corps: unknown): Promise<T> {
  // Pas de délai d'abandon ici, contrairement à la lecture : une écriture
  // abandonnée côté client mais aboutie côté serveur laisse l'utilisateur
  // croire à un échec, et il recommence. Mieux vaut attendre.
  const reponse = await fetch(`${BASE}${chemin}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(corps),
  });
  const donnees = (await reponse.json().catch(() => ({}))) as { erreur?: string };
  if (!reponse.ok) {
    throw new ErreurApi(reponse.status, donnees.erreur ?? `HTTP ${reponse.status}`);
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
    poster<{ compte: Compte }>("/auth/connexion", { email, mdp }),
  deconnexion: () => poster<{ ok: true }>("/auth/deconnexion", {}),

  crew: () => lire<CrewApi>("/api/crew"),
  resident: (code: string) => lire<ResidentApi>(`/api/residents/${code}`),

  ajouterNote: (code: string, note: NouvelleNote) =>
    // `type` reste « info » : le formulaire de la console ne demande pas de
    // ranger la note entre allergie, contre-indication et antecedent. Le
    // backoffice le fait, pour les saisies d'initialisation.
    poster<{ id: number }>(`/api/residents/${code}/particularites`, {
      ...note,
      type: "info",
    }),
};

// ----------------------------------------------------------------- types --
export type SeveriteApi = "critique" | "surveillance" | "info";

export interface CrewApi {
  vaisseau: { nom: string; residents: number; jour_vol: number; synchro_at: string | null };
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
  physio: { libelle: string; pct: number }[];
  triage: {
    id: number;
    severite: SeveriteApi;
    resident: string;
    cabine: string;
    age: number;
    motif: string;
    ouvert_a: string;
    assigne_a: string | null;
    statut: string;
  }[];
  compteurs: { ouverts: number; critiques: number; non_assignes: number };
}

export interface ResidentApi {
  resident: {
    code: string;
    prenom: string;
    nom: string;
    poste: string;
    cabine: string;
    groupe_sanguin: string;
    statut: "ok" | "surveillance" | "critique";
    embarque_jour_vol: number;
    age: number;
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
  nuits: { nuit_du: string; jour_vol: number; sommeil_min: number | null }[];
  evenements: { jour: string; type: string; n: number }[];
  conversations: {
    id: number;
    debut_at: string;
    jour_vol: number;
    duree_min: number;
    severite: SeveriteApi;
    resume: string;
    actions_proposees: number;
    actions_acceptees: number;
    remontee_auto: number;
    tags: string[];
  }[];
  conversations_total: number;
  particularites: {
    type: string;
    niveau: SeveriteApi;
    titre: string;
    detail: string;
    constate_le: string | null;
    /** Null pour les notes antérieures aux comptes : elles n'ont pas d'auteur. */
    auteur: string | null;
  }[];
  suivis: { type: string; titre: string; detail: string }[];
  etat_mental: { evalue_le: string; score_moral: number | null }[];
  bilans: BilanApi[];
}

/** Une consultation avec prise de sang, et ses dosages. */
export interface BilanApi {
  id: number;
  preleve_le: string;
  jour_vol: number;
  prochain_le: string | null;
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
