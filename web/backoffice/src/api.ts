/**
 * Client du backoffice.
 *
 * Le jeton d'administration a disparu. Il vivait dans le `sessionStorage`,
 * lisible par n'importe quel script injecte dans la page, et il prouvait
 * qu'on connaissait une cle — jamais qu'on etait quelqu'un. A sa place : un
 * compte dans la table `admins`, un mot de passe hache en argon2id, et une
 * session dans un cookie `httpOnly` qu'aucun script de la page ne peut lire.
 *
 * Toutes les requetes portent `credentials: "include"` : le serveur est sur un
 * autre port, et sans cette option le navigateur ne renvoie pas le cookie.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5175";

export class ErreurApi extends Error {
  constructor(
    readonly statut: number,
    message: string,
  ) {
    super(message);
  }
}

async function appel<T>(chemin: string, options: RequestInit = {}): Promise<T> {
  const reponse = await fetch(`${BASE}${chemin}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  if (!reponse.ok) {
    // Le serveur renvoie toujours `{ erreur: "..." }` ; on se rabat sur le
    // code HTTP si la reponse n'est pas du JSON (proxy, serveur eteint).
    const corps = await reponse.json().catch(() => ({}) as { erreur?: string });
    throw new ErreurApi(reponse.status, corps.erreur ?? `HTTP ${reponse.status}`);
  }
  return reponse.json() as Promise<T>;
}

export const api = {
  /** Qui est connecte. Un 401 est une reponse normale : « personne ». */
  moi: () => appel<{ compte: Compte }>("/auth/moi"),
  connexion: (email: string, mdp: string) =>
    appel<{ compte: Compte }>("/auth/connexion", {
      method: "POST",
      body: JSON.stringify({ email, mdp }),
    }),
  deconnexion: () => appel<{ ok: true }>("/auth/deconnexion", { method: "POST" }),

  comptes: () => appel<ListeComptes>("/admin/comptes"),
  activerCompte: (role: "medecin" | "admin", id: number, actif: boolean) =>
    appel<{ ok: true }>(`/admin/comptes/${role}/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ actif }),
    }),

  apercu: () => appel<Apercu>("/admin/apercu"),
  ecrans: () => appel<Ecrans>("/admin/ecrans"),

  residents: (f: FiltreResidents) => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.module) p.set("module", f.module);
    if (f.statut) p.set("statut", f.statut);
    p.set("page", String(f.page ?? 0));
    p.set("limite", String(f.limite ?? 50));
    return appel<ListeResidents>(`/admin/residents?${p}`);
  },
  modifierResident: (code: string, champs: Partial<Pick<Resident, "statut" | "poste" | "cabine">>) =>
    appel<{ ok: true }>(`/admin/residents/${code}`, {
      method: "PATCH",
      body: JSON.stringify(champs),
    }),

  /** Fiche complete : c'est la meme route que lit la console medicale. */
  fiche: (code: string) => appel<Fiche>(`/api/residents/${code}`),

  signaux: (statut: string) => appel<{ lignes: Signal[] }>(`/admin/signaux?statut=${statut}`),
  modifierSignal: (id: number, champs: ChampsSignal) =>
    appel<{ ok: true }>(`/admin/signaux/${id}`, {
      method: "PATCH",
      body: JSON.stringify(champs),
    }),

  ajouterParticularite: (code: string, p: NouvelleParticularite) =>
    appel<{ id: number }>(`/admin/residents/${code}/particularites`, {
      method: "POST",
      body: JSON.stringify(p),
    }),

  table: (nom: string, limite = 50) =>
    appel<TableBrute>(`/admin/tables/${nom}?limite=${limite}`),
};

// ------------------------------------------------------------------ types --
export interface Compte {
  role: "medecin" | "admin";
  id: number;
  prenom: string;
  nom: string;
  email: string;
  code: string | null;
  titre: string | null;
}

/** Les comptes, sans leur empreinte : le serveur ne la sert jamais. */
export interface ListeComptes {
  lignes: {
    role: "medecin" | "admin";
    id: number;
    code: string | null;
    titre: string | null;
    prenom: string;
    nom: string;
    poste: string;
    email: string;
    actif: number;
    cree_le: string;
    derniere_connexion: string | null;
    notes_signees: number;
    signaux_ouverts: number;
  }[];
  sessions_ouvertes: number;
}

export type Severite = "critique" | "surveillance" | "info";
export type Statut = "ok" | "surveillance" | "critique";

export interface Resident {
  id: number;
  code: string;
  prenom: string;
  nom: string;
  poste: string;
  cabine: string;
  module: string;
  groupe_sanguin: string;
  statut: Statut;
  age: number;
  signaux: number;
  moral: number | null;
  sommeil_min: number | null;
}

export interface FiltreResidents {
  q?: string;
  module?: string;
  statut?: string;
  page?: number;
  limite?: number;
}

export interface ListeResidents {
  total: number;
  page: number;
  limite: number;
  lignes: Resident[];
}

export interface Signal {
  id: number;
  severite: Severite;
  motif: string;
  origine: string;
  ouvert_at: string;
  /** Le compte a qui le signal est assigne, s'il l'est a une personne. */
  assigne_id: number | null;
  /** Le nom affiche : celui du compte, sinon le texte libre (« Equipe… »). */
  assigne_a: string | null;
  statut: "ouvert" | "en_cours" | "clos";
  clos_at: string | null;
  clos_motif: string | null;
  resident: string;
  prenom: string;
  nom: string;
  cabine: string;
  age: number;
}

export interface ChampsSignal {
  /** Une personne : le signal pointe alors sur un compte medecin. */
  assigne_id?: number | null;
  /** Ce qui n'est pas une personne : « Equipe d'intervention ». */
  assigne_a?: string | null;
  statut?: "ouvert" | "en_cours" | "clos";
  clos_motif?: string;
}

export interface NouvelleParticularite {
  type: "allergie" | "contre_indication" | "antecedent" | "info";
  niveau: Severite;
  titre: string;
  detail: string;
}

export interface Apercu {
  base: string;
  jour_vol: number;
  tables: { nom: string; lignes: number }[];
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
  signaux: { statut: string; severite: Severite; n: number }[];
  fraicheur: { flux: string; dernier: string | null }[];
}

export interface Ecrans {
  ecrans: { ecran: string; blocs: { bloc: string; source: string; route: string }[] }[];
  valeurs: {
    depistage: Apercu["depistage"];
    bienetre: { jour: string; jour_vol: number; indice: number; residents_evalues: number }[];
    modules: { module: string; signaux: number; pct_residents: number }[];
    motifs: { motif: string; conversations: number }[];
    physio: { ordre: number; libelle: string; pct: number }[];
  };
}

export interface TableBrute {
  nom: string;
  colonnes: string[];
  lignes: Record<string, unknown>[];
}

export interface Fiche {
  resident: Record<string, unknown> & { code: string; prenom: string; nom: string };
  bracelet: { serie: string; batterie_pct: number | null; synchro_at: string | null } | null;
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
  nuits: { nuit_du: string; sommeil_min: number | null; latence_min: number | null }[];
  conversations: {
    id: number;
    debut_at: string;
    jour_vol: number;
    duree_min: number;
    severite: Severite;
    resume: string;
    tags: string[];
    remontee_auto: number;
  }[];
  conversations_total: number;
  particularites: { type: string; niveau: Severite; titre: string; detail: string }[];
  suivis: { type: string; titre: string; detail: string }[];
  etat_mental: {
    evalue_le: string;
    score_moral: number | null;
    phq9: number | null;
    gad7: number | null;
    isi: number | null;
  }[];
}
