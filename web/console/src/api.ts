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
    const reponse = await fetch(`${BASE}${chemin}`, { signal: arret.signal });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    return (await reponse.json()) as T;
  } finally {
    clearTimeout(minuteur);
  }
}

// ---------------------------------------------------------------- écriture --
/**
 * La lecture est ouverte. L'écriture l'est aussi, provisoirement.
 *
 * Elle passait par le jeton du backoffice : le médecin devait recopier une clé
 * de 64 caractères pour écrire une ligne dans un dossier. C'était doublement
 * faux — une console de soin doit s'ouvrir sans cérémonie, et surtout un jeton
 * partagé ne dit pas QUI a écrit la note, ce qui est précisément ce qu'un
 * dossier médical doit retenir.
 *
 * La porte sera la session médecin (table `medecins`). D'ici là, la note part
 * sans auteur : c'est la limite à ne pas oublier au moment de la présenter.
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

export const api = {
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
  particularites: { type: string; niveau: SeveriteApi; titre: string; detail: string }[];
  suivis: { type: string; titre: string; detail: string }[];
  etat_mental: { evalue_le: string; score_moral: number | null }[];
}
