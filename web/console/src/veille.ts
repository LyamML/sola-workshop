import { useEffect, useRef } from "react";
import { api } from "./api";

/** Un signal remonté doit se voir sans recharger la page, et l'empreinte ne coûte presque rien à relire. */
const PERIODE_MS = 5_000;

/**
 * Relit l'empreinte des signaux à traiter tant que l'écran 02 est ouvert, et
 * appelle `surChangement` quand elle diffère de celle de la file affichée.
 *
 * `affichee` est l'empreinte servie avec la file, tenue à jour par qui la
 * charge : c'est à elle qu'on compare, jamais à la relecture précédente.
 *
 * Un onglet caché ne relit rien — le navigateur y ralentit de toute façon les
 * minuteurs — et relit dès qu'il revient au premier plan, là où une file
 * restée en arrière se verrait.
 */
export function useVeilleSignaux(
  actif: boolean,
  affichee: { readonly current: string | null },
  surChangement: () => void,
): void {
  const rappel = useRef(surChangement);
  rappel.current = surChangement;

  useEffect(() => {
    if (!actif) return;
    let vivant = true;
    let enVol = false;
    let minuteur: ReturnType<typeof setTimeout> | undefined;

    const relire = () => {
      clearTimeout(minuteur);
      if (!vivant || enVol || document.hidden) return;
      enVol = true;
      api
        .empreinteCrew()
        .then(({ empreinte }) => {
          if (vivant && empreinte !== affichee.current) rappel.current();
        })
        // Serveur tombé ou session expirée : la file reste celle du dernier
        // chargement, et on retente au tour suivant.
        .catch(() => {})
        .finally(() => {
          enVol = false;
          if (vivant) minuteur = setTimeout(relire, PERIODE_MS);
        });
    };
    const auRetour = () => {
      if (!document.hidden) relire();
    };

    // La file vient d'arriver avec son empreinte : rien à relire tout de suite.
    minuteur = setTimeout(relire, PERIODE_MS);
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      vivant = false;
      clearTimeout(minuteur);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [actif, affichee]);
}
