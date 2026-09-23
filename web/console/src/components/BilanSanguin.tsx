import { useState } from "react";
import type { BloodReport } from "../types";

/**
 * Bilan sanguin — écran 03.
 *
 * Le seul bloc de la fiche qui ne vienne pas d'un capteur : un médecin reçoit
 * le résident toutes les deux semaines, prélève, et commente. Le bracelet
 * mesure en continu et ne sait rien du fer ni de la thyroïde.
 *
 * Trois choix d'affichage, et ils se tiennent :
 *
 *   · les onze panels gardent l'ordre du laboratoire, toujours le même. Un
 *     bilan se parcourt de haut en bas à la même vitesse à chaque fois, ce
 *     qu'un tri par gravité rendrait impossible ;
 *   · un panel entièrement normal se replie. Ce qui est dans les bornes n'a
 *     pas besoin d'être lu, mais doit rester consultable — d'où un repli et
 *     non un masquage ;
 *   · la valeur porte sa couleur, jamais la ligne entière. Vingt-neuf lignes
 *     colorées, c'est une page qui crie ; deux valeurs en ambre, c'est une
 *     page qui montre.
 */

const NIVEAUX: Record<string, { classe: string; mot: string }> = {
  bas: { classe: "watch", mot: "bas" },
  eleve: { classe: "watch", mot: "élevé" },
  critique: { classe: "crit", mot: "hors bornes" },
};

export function BilanSanguin({ reports }: { reports: BloodReport[] }) {
  const [index, setIndex] = useState(0);
  const bilan = reports[index];

  if (!bilan) {
    return (
      <div className="card pad-lg">
        <div className="card-h">
          <h3>Bilan sanguin</h3>
        </div>
        <p className="sub" style={{ marginTop: 10 }}>
          Aucune prise de sang enregistrée pour ce résident.
        </p>
      </div>
    );
  }

  return (
    <div className="card pad-lg">
      <div className="card-h">
        <h3>Bilan sanguin</h3>
        <span className="sub">
          {bilan.doctor ? `prélevé par ${bilan.doctor}` : "prélèvement sans médecin renseigné"}
          {bilan.flagged > 0
            ? ` · ${bilan.flagged} marqueur${bilan.flagged > 1 ? "s" : ""} hors bornes`
            : " · tout dans les bornes"}
        </span>
        {reports.length > 1 && (
          <div className="right">
            {/* Un deroulant plutot qu'une rangee de boutons : l'historique
                s'allonge d'un bilan toutes les deux semaines, et une rangee
                qui grandit finit par pousser le titre a la ligne. Le deroulant
                garde la meme largeur au dixieme bilan qu'au deuxieme. */}
            <div className="selectwrap">
              <label htmlFor="bilanDate" style={{ position: "absolute", left: -9999 }}>
                Date du bilan
              </label>
              <select
                id="bilanDate"
                value={String(index)}
                onChange={(e) => setIndex(Number(e.target.value))}
              >
                {reports.map((r, i) => (
                  <option key={r.date} value={String(i)}>
                    {r.date}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {bilan.comment && <p className="bilan-note">« {bilan.comment} »</p>}

      <div className="panels">
        {bilan.panels.map((panel) => (
          <details key={panel.key} className="panel" open={panel.flagged > 0}>
            <summary>
              <span className="nom">{panel.label}</span>
              {panel.flagged > 0 ? (
                // Le nombre seul ne dit pas de quoi il est le nombre : replié,
                // ce panel n'a plus que son titre pour se faire comprendre.
                <span className="chip watch">
                  {panel.flagged} hors borne{panel.flagged > 1 ? "s" : ""}
                </span>
              ) : (
                <span className="sub">normal</span>
              )}
            </summary>
            <table className="dosages">
              <tbody>
                {panel.markers.map((m) => {
                  const n = NIVEAUX[m.level];
                  return (
                    <tr key={m.label}>
                      <th scope="row">{m.label}</th>
                      <td className={`valeur${n ? ` ${n.classe}` : ""}`}>
                        {m.value}
                        {m.unit && <span className="unite"> {m.unit}</span>}
                        {n && <span className="mention"> {n.mot}</span>}
                      </td>
                      <td className="ref">{m.reference}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        ))}
      </div>

      <div className="bilan-pied">
        <span>
          {bilan.dayLabel} · {bilan.next ?? "pas de prochain rendez-vous programmé"}
        </span>
        {/* Même honnêteté que les tuiles de constantes : ce qui n'est pas
            mesuré le dit. */}
        {bilan.simulated && <span className="chip">valeurs simulées</span>}
      </div>
    </div>
  );
}
