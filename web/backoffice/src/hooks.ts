import { useCallback, useEffect, useState } from "react";
import { ErreurApi } from "./api";

/**
 * Charge une ressource et expose les trois etats qu'une page doit savoir
 * afficher : en cours, en erreur, chargee. Les ecrans d'un outil
 * d'exploitation passent leur temps en erreur ou en attente — autant que ce
 * soit le cas par defaut plutot qu'un cas particulier.
 *
 * Un 401 recharge la page : la session a expire, le formulaire de connexion
 * reprend la main. Inutile de laisser rejouer la meme requete.
 */
export function useChargement<T>(
  charger: () => Promise<T>,
  deps: unknown[],
): { donnees: T | null; erreur: string | null; charge: boolean; relancer: () => void } {
  const [donnees, setDonnees] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const [tick, setTick] = useState(0);

  const relancer = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let vivant = true;
    setCharge(false);
    setErreur(null);

    charger()
      .then((d) => {
        if (vivant) setDonnees(d);
      })
      .catch((e: unknown) => {
        if (!vivant) return;
        if (e instanceof ErreurApi && e.statut === 401) {
          window.location.reload();
          return;
        }
        setErreur(e instanceof Error ? e.message : "Erreur inconnue");
      })
      .finally(() => {
        if (vivant) setCharge(true);
      });

    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { donnees, erreur, charge, relancer };
}
