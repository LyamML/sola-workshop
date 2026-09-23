import { useState } from "react";
import { pluriel } from "../format";
import type { BilanFiche } from "../types";

/**
 * Bilan sanguin — écran 03.
 *
 * Le seul bloc de la fiche qui ne vienne pas d'un capteur : un médecin reçoit
 * le résident toutes les deux semaines, prélève, et commente.
 *
 * Trois choix d'affichage, et ils se tiennent :
 *
 *   · ce qui sort des repères est dit en tête de carte, en une ligne : on n'a
 *     pas à parcourir vingt-neuf marqueurs pour trouver le seul qui compte ;
 *   · les panneaux gardent l'ordre du laboratoire, toujours le même, et tous
 *     dépliés : un bilan se relit de haut en bas à la même vitesse à chaque
 *     fois ;
 *   · la valeur porte sa couleur, jamais la ligne entière. Vingt-neuf lignes
 *     colorées, c'est une page qui crie ; une valeur en ambre, c'est une page
 *     qui montre.
 *
 * « valeurs simulées » reste une mention discrète au pied : un bilan simulé
 * se lit comme un autre, et la fiche ne le range pas à part.
 */
export function BilanSanguin({ bilans }: { bilans: BilanFiche[] }) {
  const [choisi, setChoisi] = useState(bilans[0]?.id ?? null);
  const bilan = bilans.find((b) => b.id === choisi) ?? bilans[0];

  if (!bilan) {
    return (
      <section className="mk-card">
        <div className="mk-ch">
          <h3>Bilan sanguin</h3>
        </div>
        <p className="vide">Aucun bilan sanguin en base pour ce résident.</p>
      </section>
    );
  }

  const n = bilan.horsBorne.length;

  return (
    <section className="mk-card">
      <div className="mk-ch">
        <h3>Bilan sanguin</h3>
        <span className="sub">{bilan.sous}</span>
        {bilans.length > 1 && (
          // Un déroulant plutôt qu'une rangée de boutons : l'historique
          // s'allonge d'un bilan toutes les deux semaines, et le déroulant
          // garde la même largeur au dixième qu'au deuxième.
          <div className="r">
            <label className="cache" htmlFor="bilanDate">
              Date du bilan
            </label>
            <select
              id="bilanDate"
              className="select"
              value={String(bilan.id)}
              onChange={(e) => setChoisi(Number(e.target.value))}
            >
              {bilans.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.option}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {bilan.panneaux.length > 0 &&
        (n ? (
          <div className="bil-flag">
            <b>{pluriel(n, "marqueur hors borne", "marqueurs hors borne")}</b>
            {bilan.horsBorne.map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
        ) : (
          <div className="bil-flag ok">
            <b>Tous les marqueurs dans les repères</b>
          </div>
        ))}

      {bilan.commentaire && <p className="bil-com">{bilan.commentaire}</p>}

      {bilan.panneaux.length ? (
        <div className="mrk-l two">
          {bilan.panneaux.map((p) => (
            <div className="pn" key={p.cle}>
              <h5>{p.libelle}</h5>
              {p.marqueurs.map((m) => (
                <div className="mrk" key={m.nom}>
                  <span>{m.nom}</span>
                  <span className={`val${m.ton === "hors" ? " w" : m.ton === "critique" ? " c" : ""}`}>
                    {m.valeur}
                    {m.repere && <em>{m.repere}</em>}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="vide">Prélèvement sans résultat rendu pour l'instant.</p>
      )}

      <div className="bil-pied">
        <span>{bilan.prochain}</span>
        {bilan.simule && <span className="chip ghost">valeurs simulées</span>}
      </div>
    </section>
  );
}
