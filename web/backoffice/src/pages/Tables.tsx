import { useState } from "react";
import { api } from "../api";
import { Cadre, Etat, nombre } from "../components/Base";
import { useChargement } from "../hooks";

const TABLES = [
  "residents", "bracelets", "particularites", "suivis", "mesures",
  "mesures_jour", "nuits", "etat_mental", "conversations",
  "conversation_tags", "signaux", "evenements",
];

/**
 * Lecture brute d'une table.
 *
 * Le dernier recours quand un chiffre paraît faux : regarder les lignes
 * elles-mêmes, sans mise en forme. Côté serveur, le nom de table passe par
 * une liste blanche — il n'est jamais interpolé tel quel dans du SQL.
 */
export function Tables() {
  const [nom, setNom] = useState("residents");
  const [limite, setLimite] = useState(25);

  const { donnees, erreur, charge } = useChargement(() => api.table(nom, limite), [nom, limite]);

  return (
    <div className="page">
      <h1 className="titre">Tables</h1>
      <p className="sous">
        Les dernières lignes écrites, sans mise en forme. Utile pour vérifier
        qu’une ingestion est bien arrivée, ou qu’un <code>db:rollup</code> a bien
        recalculé ce qu’il devait.
      </p>

      <Cadre
        titre={nom}
        aide={donnees ? `${donnees.colonnes.length} colonnes` : undefined}
        sansPadding
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <div className="filtres">
            <select value={nom} onChange={(e) => setNom(e.target.value)}>
              {TABLES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select value={limite} onChange={(e) => setLimite(Number(e.target.value))}>
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n} lignes
                </option>
              ))}
            </select>
          </div>
        </div>

        <Etat charge={charge} erreur={erreur} vide={donnees?.lignes.length === 0}>
          <div className="defile">
            <table>
              <thead>
                <tr>
                  {donnees?.colonnes.map((c) => (
                    <th key={c} className={c.endsWith("_id") || c === "id" ? "num" : undefined}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {donnees?.lignes.map((ligne, i) => (
                  <tr key={i}>
                    {donnees.colonnes.map((c) => {
                      const v = ligne[c];
                      const estNombre = typeof v === "number";
                      return (
                        <td key={c} className={estNombre ? "num" : undefined}>
                          {v === null || v === undefined ? (
                            <span style={{ color: "var(--ink-3)" }}>null</span>
                          ) : estNombre ? (
                            nombre(v)
                          ) : (
                            String(v)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Etat>
      </Cadre>
    </div>
  );
}
