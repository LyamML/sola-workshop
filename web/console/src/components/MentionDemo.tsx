import type { Source } from "../useSource";

/**
 * « jeu de démonstration », tant que l'écran affiche le repli. Une console
 * médicale doit dire d'où viennent ses chiffres : un écran rempli sans serveur
 * est honnête s'il le dit, trompeur sinon.
 */
export function MentionDemo({ source }: { source: Source }) {
  if (source !== "demo") return null;
  return (
    <span
      className="chip watch"
      title="Ces chiffres sont ceux du jeu de démonstration, figés dans la console ; ceux du serveur de bord les remplacent dès qu'il répond."
    >
      jeu de démonstration
    </span>
  );
}
