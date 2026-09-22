import { useCallback, useEffect, useRef, useState } from "react";

export type Source = "demo" | "api";

/**
 * Charge une vue depuis le serveur de bord, avec repli sur le jeu de
 * démonstration.
 *
 * Le repli est la valeur de départ : la page s'affiche immédiatement, remplie,
 * et se met à jour quand le serveur répond. Il n'y a donc ni écran de
 * chargement ni page blanche — pour une console médicale, un écran vide est
 * une information fausse, alors qu'un écran marqué « démonstration » est une
 * information honnête.
 *
 * `source` dit lequel des deux est affiché, et l'interface le montre.
 *
 * `rafraichir` recharge **sans** repasser par le repli : après une écriture,
 * la fiche doit se mettre à jour, pas clignoter en revenant une seconde au jeu
 * de démonstration.
 */
export function useSource<TApi, TVue>(
  charger: () => Promise<TApi>,
  adapter: (donnees: TApi) => TVue,
  repli: TVue,
  deps: unknown[] = [],
): { vue: TVue; source: Source; erreur: string | null; rafraichir: () => void } {
  const [vue, setVue] = useState<TVue>(repli);
  const [source, setSource] = useState<Source>("demo");
  const [erreur, setErreur] = useState<string | null>(null);

  // `charger` et `adapter` sont des fonctions recréées à chaque rendu : on ne
  // peut pas les mettre en dépendance sans boucler. On garde la dernière
  // version dans une référence, et l'effet reste piloté par `deps`.
  const dernier = useRef({ charger, adapter });
  dernier.current = { charger, adapter };
  const vivant = useRef(true);

  const aller = useCallback(() => {
    const { charger, adapter } = dernier.current;
    charger()
      .then((donnees) => {
        if (!vivant.current) return;
        setVue(adapter(donnees));
        setSource("api");
        setErreur(null);
      })
      .catch((e: unknown) => {
        if (!vivant.current) return;
        // Le serveur absent n'est pas une erreur d'affichage : on garde ce qui
        // est affiché et on note pourquoi, pour l'indicateur d'en-tête.
        setErreur(e instanceof Error ? e.message : "serveur injoignable");
      });
  }, []);

  useEffect(() => {
    vivant.current = true;
    setVue(repli);
    setSource("demo");
    setErreur(null);
    aller();

    return () => {
      vivant.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { vue, source, erreur, rafraichir: aller };
}
