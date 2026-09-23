import type { CSSProperties } from "react";

const MAX_HOURS = 9;
const LOW_THRESHOLD = 6;

/**
 * Durées de sommeil. La ligne d'objectif est posée en CSS à 7/9 de la hauteur
 * traçable, de sorte qu'elle reste alignée sur la base des barres.
 *
 * La hauteur de chaque barre est passée en variable CSS plutôt qu'en `height` :
 * l'étiquette de survol s'accroche à la même variable et se pose donc au sommet
 * du bâton, quelle que soit sa taille.
 */
export function SleepChart({ nights }: { nights: number[] }) {
  return (
    <div className="sleep">
      {nights.map((hours, i) => {
        const label =
          i === 0 ? "J−13" : i === nights.length - 1 ? "J" : i === 6 ? "J−7" : "";
        const style = { "--h": `${((hours / MAX_HOURS) * 100).toFixed(1)}%` } as CSSProperties;
        return (
          <div className="col" key={i} style={style}>
            {/* La valeur est dans le DOM en permanence, seulement masquée à
                l'œil : un lecteur d'écran lit les quatorze nuits, la souris n'en
                révèle qu'une. */}
            <span className="val">{hours.toFixed(1).replace(".", ",")} h</span>
            <div className={`stick${hours < LOW_THRESHOLD ? " low" : ""}`} />
            <span className="cl">{label}</span>
          </div>
        );
      })}
      {/* Posée après les colonnes et remontée d'un cran : une ligne de repère
          qui passe derrière ce qu'elle repère ne sert à rien. */}
      <div className="target">
        <span>objectif 7 h</span>
      </div>
    </div>
  );
}
