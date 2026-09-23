import { Fragment } from "react";
import { type BlocServi, api } from "../api";
import { Cadre, Etat } from "../components/Base";
import { useChargement } from "../hooks";

/**
 * Correspondance entre ce qui s'affiche et ce qui le produit.
 *
 * Les écrans ont été dessinés avant la base : tant qu'un chiffre reste écrit
 * en dur dans l'interface, rien ne prouve que le schéma sait le produire. Ici
 * chaque bloc de la console est mis en face de la source qui le remplit et de
 * ce qu'elle renvoie à l'instant — le serveur relit chaque source à l'appel,
 * avec les mêmes vues que la console.
 */
export function Ecrans() {
  const { donnees, erreur, charge } = useChargement(() => api.ecrans(), []);

  return (
    <div className="page">
      <h1 className="titre">Écrans et sources</h1>
      <p className="sous">
        Chaque bloc de la console, la vue qui le remplit, et ce qu’elle renvoie
        maintenant. Une case vide&nbsp;: le bloc est du décor.
      </p>

      <Etat charge={charge} erreur={erreur}>
        <div className="grille">
          {donnees?.ecrans.map((e) => (
            <Cadre key={e.ecran} titre={e.ecran} aide={<ListeRoutes routes={e.aide} />} sansPadding>
              <table className="correspondance">
                <colgroup>
                  <col className="c-bloc" />
                  <col />
                  <col className="c-valeur" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Bloc</th>
                    <th scope="col">Source</th>
                    <th scope="col" className="num">
                      Valeur servie
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {e.blocs.map((b) => (
                    <tr key={b.bloc}>
                      <th scope="row" data-etiquette="Bloc">
                        {b.bloc}
                      </th>
                      <td data-etiquette="Source">
                        <code>{b.source}</code>
                        {b.note && <span className="muet"> — {b.note}</span>}
                      </td>
                      <td data-etiquette="Valeur servie" className="valeur">
                        <Valeur b={b} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Cadre>
          ))}
        </div>
      </Etat>
    </div>
  );
}

/** Les routes d'un écran, chacune d'un seul tenant : une route coupée en deux ne se relit plus. */
function ListeRoutes({ routes }: { routes: string[] }) {
  return (
    <span className="routes">
      {routes.map((r, i) => (
        <Fragment key={r}>
          {i > 0 && " · "}
          <span>{r}</span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Les quatre cas d'une valeur servie, qui ne se confondent pas : un bloc qui
 * ne lit rien en base, une source en erreur, une source vide (le décor), une
 * valeur. Une case vide ne doit vouloir dire qu'une seule chose.
 */
function Valeur({ b }: { b: BlocServi }) {
  if (!b.lu) return <span className="muet">—</span>;
  if (b.illisible) {
    return <span className="illisible">source illisible · voir le journal du serveur</span>;
  }
  if (b.valeur === null) return <span className="sr">aucune valeur, bloc de décor</span>;
  return <>{b.valeur}</>;
}
