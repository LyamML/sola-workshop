import { useEffect, useState } from "react";
import { ErreurApi, api, type DirectApi } from "./api";

/** Le bracelet envoie toutes les dix secondes : relire plus souvent ne montrerait rien de neuf. */
const PERIODE_MS = 10_000;

export interface Direct {
  donnees: DirectApi;
  /** Ce qu'il faut ajouter à l'horloge du poste pour lire celle du serveur. */
  decalage: number;
  /** La dernière relecture a échoué : ce qui s'affiche date de la précédente. */
  panne: "serveur" | "session" | null;
}

/**
 * Ce que le bracelet d'un résident vient d'envoyer, relu tant que la fiche
 * est ouverte.
 *
 * Seulement quand la fiche vient du serveur : en démonstration, il n'y a pas
 * de bracelet à écouter, et la carte ne s'affiche pas plutôt que d'annoncer
 * une panne qui n'en est pas une. Une relecture manquée garde la réponse
 * précédente : l'âge de la dernière trame continue de courir, et la carte dit
 * pourquoi rien de neuf n'arrive.
 */
export function useDirect(code: string, actif: boolean): Direct | null {
  const [direct, setDirect] = useState<Direct | null>(null);

  useEffect(() => {
    setDirect(null);
    if (!actif) return;
    let vivant = true;
    let minuteur: ReturnType<typeof setTimeout> | undefined;

    const relire = () => {
      api
        .direct(code)
        .then((donnees) => {
          if (!vivant) return;
          setDirect({ donnees, decalage: Date.parse(donnees.maintenant) - Date.now(), panne: null });
        })
        .catch((e: unknown) => {
          if (!vivant) return;
          const panne = e instanceof ErreurApi && e.statut === 401 ? "session" : "serveur";
          setDirect((d) => (d ? { ...d, panne } : d));
        })
        .finally(() => {
          if (vivant) minuteur = setTimeout(relire, PERIODE_MS);
        });
    };
    relire();

    return () => {
      vivant = false;
      clearTimeout(minuteur);
    };
  }, [code, actif]);

  return direct;
}
