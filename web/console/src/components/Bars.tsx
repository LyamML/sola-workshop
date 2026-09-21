import type { BarRow } from "../types";

interface BarsProps {
  rows: BarRow[];
  max: number;
  format: (value: number) => string;
}

/** Barres horizontales, une seule mesure. Chaque barre porte son étiquette et
 *  sa valeur : la couleur n'est jamais le seul véhicule de l'information. */
export function Bars({ rows, max, format }: BarsProps) {
  return (
    <div className="bars">
      {rows.map((row) => (
        <div className="bar" key={row.name}>
          <div className="top">
            <span className="n">{row.name}</span>
            <span className="v">{format(row.value)}</span>
          </div>
          <div className="track">
            <div
              className={`fill${row.tone ? ` ${row.tone}` : ""}`}
              style={{ width: `${Math.max(2, (row.value / max) * 100).toFixed(1)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export const formatPercent = (v: number) => `${v.toFixed(1).replace(".", ",")} %`;
export const formatCount = (v: number) => v.toLocaleString("fr-FR");
