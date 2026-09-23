import { useCallback, useEffect, useState } from "react";

/**
 * Le retour d'un geste — « Signal pris », « Note ajoutée » — en une ligne au
 * bas de l'écran, qui s'efface seule.
 *
 * Pas de bouton d'annulation : un geste de soin se corrige par un autre
 * geste, visible dans le dossier, pas par un retour arrière qu'on n'aurait
 * pas eu le temps de voir.
 *
 * La zone reste dans la page même vide : un lecteur d'écran n'annonce que ce
 * qui arrive dans une région qu'il connaît déjà.
 */
export function useAvis() {
  const [avis, setAvis] = useState<{ texte: string; n: number } | null>(null);

  useEffect(() => {
    if (!avis) return;
    const t = setTimeout(() => setAvis(null), 5000);
    return () => clearTimeout(t);
  }, [avis]);

  // Le compteur relance l'effacement quand deux avis se suivent.
  const montrer = useCallback((texte: string) => setAvis((a) => ({ texte, n: (a?.n ?? 0) + 1 })), []);

  const rendu = (
    <div className="avis" role="status">
      {avis && (
        <span className="avis-in" key={avis.n}>
          {avis.texte}
        </span>
      )}
    </div>
  );

  return { montrer, rendu };
}
