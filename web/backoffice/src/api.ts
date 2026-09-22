/**
 * Client du backoffice.
 *
 * Le jeton d'administration est saisi une fois et garde dans `sessionStorage` :
 * il disparait a la fermeture de l'onglet. C'est le compromis assume du
 * prototype, et sa limite la plus visible — un script injecte dans la page
 * pourrait le lire. Un deploiement reel utiliserait une session serveur avec
 * cookie httpOnly, un compte par personne, et une trace de qui modifie quoi.
 * La remarque est reprise dans `server/src/auth.ts`, au-dessus de `authAdmin`.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5175";
const CLE = "sola.admin.jeton";

export function jeton(): string {
  try {
    return sessionStorage.getItem(CLE) ?? "";
  } catch {
    // Navigation privee, stockage bloque : on retombe sur « pas de jeton »,
    // l'ecran de connexion s'affiche, rien ne casse.
    return "";
  }
}

export function poserJeton(valeur: string): void {
  try {
    sessionStorage.setItem(CLE, valeur);
  } catch {
    /* ignore */
  }
}

export function oublierJeton(): void {
  try {
    sessionStorage.removeItem(CLE);
  } catch {
    /* ignore */
  }
}

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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jeton()}`,
      ...options.headers,
    },
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
