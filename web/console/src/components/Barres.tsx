import type { Barre } from "../types";

/**
 * Des barres horizontales, déjà triées par l'adaptateur. Aucune teinte : la
 * longueur dit l'ordre, et une barre rouge ferait passer un motif de
 * conversation fréquent pour une alerte.
 */
export function Barres({ barres, vide }: { barres: Barre[]; vide: string }) {
  if (!barres.length) return <p className="vide">{vide}</p>;
  return (
    <div className="bars">
      {barres.map((b) => (
        <div className="bar" key={b.libelle}>
          <span className="bl">{b.libelle}</span>
          <span className="bv">{b.valeur}</span>
          <span className="bt" aria-hidden="true">
            <i style={{ width: `${b.part}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
