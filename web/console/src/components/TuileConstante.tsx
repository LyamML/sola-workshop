import type { Constante } from "../types";

/**
 * Une constante de la fiche : sa dernière valeur, et l'écart qui la fait
 * passer en vigilance, avec depuis quand.
 *
 * Les huit tuiles ont le même rang et la même règle, que la constante soit
 * mesurée par le bracelet ou simulée : les séparer ferait croire qu'une moitié
 * du dossier est vide. La tuile choisie donne sa courbe sous la grille.
 */
export function TuileConstante({
  constante: c,
  choisie,
  onChoisir,
}: {
  constante: Constante;
  choisie: boolean;
  onChoisir: () => void;
}) {
  return (
    <button
      type="button"
      className={`vt${c.alerte ? " w" : ""}`}
      aria-pressed={choisie}
      onClick={onChoisir}
    >
      <span className="l">{c.libelle}</span>
      <span className="v">
        {c.valeur}
        {c.unite && c.valeur !== "—" && <small>{c.unite}</small>}
      </span>
      <span className="e">
        {c.ecart && <b>{c.ecart}</b>}
        {c.ecart && c.repere && " · "}
        {c.repere}
      </span>
    </button>
  );
}
