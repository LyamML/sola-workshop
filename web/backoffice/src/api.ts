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

  ecrans: () => appel<Ecrans>("/admin/ecrans"),
  apercu: () => appel<Apercu>("/admin/apercu"),
  // Le nom vient de l'adresse de la page : encode, il reste un seul segment
  // de chemin quoi qu'on y ait tape. Le serveur le passe ensuite a sa liste
  // blanche.
  table: (nom: string, limite = 50) =>
    appel<TableBrute>(`/admin/tables/${encodeURIComponent(nom)}?limite=${limite}`),

  comptes: () => appel<ListeComptes>("/admin/comptes"),
  activerCompte: (role: "medecin" | "admin", id: number, actif: boolean) =>
    appel<{ ok: true }>(`/admin/comptes/${role}/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ actif }),
    }),
};

// ------------------------------------------------------------------ types --
/**
 * Le compte connecte. `/auth/moi` renvoie aussi son adresse, mais le
 * backoffice ne l'affiche nulle part : elle n'est pas declaree, pour que
 * personne ne soit tente de l'ecrire a l'ecran.
 */
export interface Compte {
  role: "medecin" | "admin";
  id: number;
  prenom: string;
  nom: string;
}

// --- Ecrans et sources
export interface BlocServi {
  bloc: string;
  source: string;
  /** Precision sur la source, quand son nom ne suffit pas. */
  note: string | null;
  /** Faux : la console ne lit rien en base pour ce bloc. */
  lu: boolean;
  /** Null alors que `lu` : la source ne renvoie rien, le bloc est du decor. */
  valeur: string | null;
  /** La source a leve une erreur ; le detail est dans le journal du serveur. */
  illisible?: boolean;
}

export interface Ecrans {
  ecrans: { ecran: string; aide: string[]; blocs: BlocServi[] }[];
}

// --- Base
export interface Flux {
  flux: string;
  /** Null : la table ne porte pas de jour de vol. */
  dernier_jour_vol: number | null;
  derniere_ecriture: string | null;
  /** Ecart avec le flux le plus recent, en jours ; null sans aucune ecriture. */
  retard_j: number | null;
}

export interface VolumeTable {
  nom: string;
  /** Null : le serveur ne connait pas cette table, il ne la compte pas. */
  lignes: number | null;
  parcourable: boolean;
}

export interface Apercu {
  jour_vol: number;
  fraicheur: Flux[];
  tables: VolumeTable[];
}

export interface TableBrute {
  nom: string;
  colonnes: string[];
  lignes: Record<string, unknown>[];
}

// --- Comptes : ni empreinte ni adresse, le serveur ne sert ni l'une ni l'autre.
export interface Soignant {
  id: number;
  code: string;
  titre: string;
  prenom: string;
  nom: string;
  poste: string;
  actif: number;
  derniere_connexion: string | null;
  signaux_ouverts: number;
  notes_signees: number;
}

export interface Administrateur {
  id: number;
  prenom: string;
  nom: string;
  actif: number;
  derniere_connexion: string | null;
}

export interface ListeComptes {
  soignants: Soignant[];
  administrateurs: Administrateur[];
}
