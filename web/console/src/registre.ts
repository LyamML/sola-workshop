import { useCallback, useEffect, useRef, useState } from "react";
import type { Origine, SeveriteApi, StatutResident, StatutSignal } from "./api";

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
  statut: StatutResident;
  age: number;
  ordre_statut: number;
  signaux: number;
  pire_severite: number | null;
  /** Le jour de la dernière ligne de constantes : pas forcément aujourd'hui. */
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
}

export interface LigneSignal {
  id: number;
  severite: SeveriteApi;
  motif: string;
  origine: Origine;
  ouvert_at: string;
  ouvert_jour_vol: number;
  assigne_a: string | null;
  assigne_id: number | null;
  statut: StatutSignal;
  clos_at: string | null;
  clos_motif: string | null;
  clos_jour_vol: number | null;
  resident: string;
  prenom: string;
  nom: string;
  cabine: string;
  module: string;
  age: number;
  ordre_severite: number;
  ordre_statut: number;
  /** Clos avec un motif que son origine ne propose pas. */
  motif_a_revoir: boolean;
}

/**
 * Charge une liste, en gardant la précédente pendant le chargement.
 *
 * Vider le tableau à chaque clic de tri ferait sauter la page à chaque
 * interaction : on garde les lignes affichées, on les grise, et on les
 * remplace quand la réponse arrive. Le tri d'un tableau doit donner
 * l'impression de retourner les lignes, pas de recharger l'écran.
 *
 * `rafraichir` relance la même requête, après un geste qui change la liste.
 */
export function useListe<T>(
  chemin: string,
  params: Record<string, string | number>,
): { lignes: T[]; total: number; chargement: boolean; erreur: string | null; rafraichir: () => void } {
  const [lignes, setLignes] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tour, setTour] = useState(0);

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

    // `credentials` comme dans api.ts : le serveur est sur un autre port, et
    // sans cette option le navigateur n'envoie pas le cookie de session — la
    // page se lirait alors comme un serveur en panne alors qu'il refuse.
    fetch(`${BASE}${chemin}?${cle}`, { signal: arret.signal, credentials: "include" })
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
  }, [chemin, cle, tour]);

  const rafraichir = useCallback(() => setTour((t) => t + 1), []);

  return { lignes, total, chargement, erreur, rafraichir };
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
