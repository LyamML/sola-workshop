import { useEffect, useRef, useState } from "react";

/**
 * Listes paginées, triées et filtrées côté serveur.
 *
 * Le tri ne se fait PAS dans le navigateur : la console travaille sur 1 240
 * résidents et l'affichage n'en tient que cinquante. Trier la page affichée
 * donnerait « la SpO₂ la plus basse parmi les cinquante déjà chargés », ce qui
 * n'est pas la question posée. C'est donc le serveur qui trie, sur la table
 * entière, et la page suit.
 */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5175";

/** Au-delà, on considère le serveur absent plutôt que lent. */
const DELAI_MS = 4000;

export interface PageApi<T> {
  total: number;
  page: number;
  taille: number;
  lignes: T[];
}

export type Sens = "asc" | "desc";

export interface LigneEquipage {
  code: string;
  prenom: string;
  nom: string;
  poste: string;
  cabine: string;
  module: string;
  statut: "ok" | "surveillance" | "critique";
  age: number;
  signaux: number;
  pire_severite: number | null;
  constantes_du: string | null;
  fc_repos_bpm: number | null;
  fc_moy_bpm: number | null;
  rmssd_ms: number | null;
  spo2_pct: number | null;
  resp_min: number | null;
  temp_c: number | null;
  pas: number | null;
  nuit_du: string | null;
  sommeil_min: number | null;
  evalue_le: string | null;
  score_moral: number | null;
  phq9: number | null;
  gad7: number | null;
  isi: number | null;
  synchro_at: string | null;
  batterie_pct: number | null;
}

export interface LigneSignal {
  id: number;
  severite: "critique" | "surveillance" | "info";
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
  module: string;
  age: number;
}

/**
 * Charge une liste, en gardant la précédente pendant le chargement.
 *
 * Vider le tableau à chaque clic de tri ferait sauter la page à chaque
 * interaction : on garde les lignes affichées, on les grise, et on les
 * remplace quand la réponse arrive. Le tri d'un tableau doit donner
 * l'impression de retourner les lignes, pas de recharger l'écran.
 */
export function useListe<T>(
  chemin: string,
  params: Record<string, string | number>,
): { lignes: T[]; total: number; chargement: boolean; erreur: string | null } {
  const [lignes, setLignes] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  // La requête part à chaque changement de paramètre : on la décrit par sa
  // chaîne plutôt que par l'objet, sinon un objet recréé à l'identique à
  // chaque rendu relancerait l'effet en boucle.
  const cle = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  ).toString();

  const premier = useRef(true);

  useEffect(() => {
    let vivant = true;
    const arret = new AbortController();
    const minuteur = setTimeout(() => arret.abort(), DELAI_MS);
    setChargement(true);

    fetch(`${BASE}${chemin}?${cle}`, { signal: arret.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PageApi<T>>;
      })
      .then((d) => {
        if (!vivant) return;
        setLignes(d.lignes);
        setTotal(d.total);
        setErreur(null);
      })
      .catch((e: unknown) => {
        if (!vivant) return;
        // Le registre n'a pas de jeu de démonstration : il EST la base. Sans
        // serveur on le dit, au lieu d'afficher un tableau vide qui se lirait
        // comme « aucun résident ne correspond ».
        setErreur(e instanceof Error ? e.message : "serveur injoignable");
        if (premier.current) setLignes([]);
      })
      .finally(() => {
        clearTimeout(minuteur);
        if (!vivant) return;
        premier.current = false;
        setChargement(false);
      });

    return () => {
      vivant = false;
      arret.abort();
    };
  }, [chemin, cle]);

  return { lignes, total, chargement, erreur };
}

/** Retarde la propagation d'une saisie : une requête par mot, pas par touche. */
export function useRetard<T>(valeur: T, ms = 250): T {
  const [retardee, setRetardee] = useState(valeur);
  useEffect(() => {
    const t = setTimeout(() => setRetardee(valeur), ms);
    return () => clearTimeout(t);
  }, [valeur, ms]);
  return retardee;
}

// ------------------------------------------------------------- formatage --
const espaces = (t: string) => t.replace(/ /g, " ");

export const nombre = (v: number | null, decimales = 0) =>
  v === null || v === undefined
    ? "—"
    : espaces(
        v.toLocaleString("fr-FR", {
          minimumFractionDigits: decimales,
          maximumFractionDigits: decimales,
        }),
      );

/** Minutes vers « 6 h 12 » : personne ne lit un sommeil en 372 minutes. */
export function duree(min: number | null): string {
  if (min === null || min === undefined) return "—";
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

/** « 09:56 » si c'est aujourd'hui, « 20/09 09:56 » sinon. */
export function horodatage(iso: string | null): string {
  if (!iso) return "—";
  const [jour, heure = ""] = iso.split(" ");
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const hm = heure.slice(0, 5);
  if (jour === aujourdhui) return hm;
  const [, m, j] = (jour ?? "").split("-");
  return `${j}/${m} ${hm}`;
}

/** Écart au présent, arrondi à l'unité qui se lit. */
export function depuis(iso: string | null): string {
  if (!iso) return "jamais";
  const minutes = Math.round((Date.now() - new Date(iso.replace(" ", "T")).getTime()) / 60000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  return `il y a ${Math.round(heures / 24)} j`;
}
