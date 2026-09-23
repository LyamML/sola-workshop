import { Fragment, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type Flux, type VolumeTable, api } from "../api";
import { Cadre, Etat, horodatage, nombre, pluriel } from "../components/Base";
import { useChargement } from "../hooks";

/**
 * Au-delà d'un jour d'écart avec le flux le plus récent, un flux est en
 * retard. Un jour et non une heure : les agrégats se calculent une fois par
 * jour, et un signal peut ne pas s'ouvrir pendant des heures sans que rien ne
 * soit en panne.
 */
const RETARD_TOLERE_J = 1;

const enRetard = (f: Flux) =>
  f.derniere_ecriture === null || (f.retard_j !== null && f.retard_j > RETARD_TOLERE_J);

/**
 * La base : les flux arrivent-ils ?
 *
 * La fraîcheur d'abord, parce qu'un écran qui paraît figé pose d'abord cette
 * question — est-ce l'interface ou la base ? Les volumes ensuite, et chaque
 * table se parcourt d'un clic. La table ouverte est dans l'adresse de la
 * page : un lien copié rouvre la même.
 */
export function Base() {
  const { donnees, erreur, charge } = useChargement(() => api.apercu(), []);
  const [params, setParams] = useSearchParams();
  const choisie = params.get("table");
  const parcours = useRef<HTMLDivElement>(null);

  function ouvrir(nom: string) {
    setParams({ table: nom });
    // Le parcours est sous la volumétrie, souvent hors de l'écran : y porter
    // le focus fait défiler jusqu'à lui, et le clavier suit.
    parcours.current?.focus();
  }

  return (
    <div className="page">
      <h1 className="titre">Base</h1>
      <p className="sous">
        Les flux arrivent-ils&nbsp;? La fraîcheur d’abord, les volumes ensuite&nbsp;;
        chaque table se parcourt d’un clic.
      </p>

      <Etat charge={charge} erreur={erreur}>
        {donnees && (
          <>
            <div className="grille g-2 haut">
              <Fraicheur flux={donnees.fraicheur} jourVol={donnees.jour_vol} />
              <Volumetrie tables={donnees.tables} choisie={choisie} ouvrir={ouvrir} />
            </div>

            <div id="parcours" ref={parcours} tabIndex={-1} className="ancre">
              <Parcours key={choisie ?? ""} nom={choisie} tables={donnees.tables} />
            </div>
          </>
        )}
      </Etat>
    </div>
  );
}

// -------------------------------------------------------------- fraicheur --
function Fraicheur({ flux, jourVol }: { flux: Flux[]; jourVol: number }) {
  // Les flux en retard en tête, le plus en retard d'abord : une ligne ambre
  // en bas de tableau ne se voit pas. Les autres gardent l'ordre du serveur.
  const poids = (f: Flux) =>
    !enRetard(f) ? -1 : f.retard_j === null ? Number.MAX_VALUE : f.retard_j;
  const lignes = [...flux].sort((a, b) => poids(b) - poids(a));

  return (
    <Cadre
      titre="Fraîcheur des flux"
      aide={`dernier jour de vol en base\u00a0: J+${nombre(jourVol)}`}
      sansPadding
    >
      <div className="defile">
        <table className="fraicheur">
          <thead>
            <tr>
              <th scope="col">Flux</th>
              <th scope="col" className="num">
                Dernier jour
              </th>
              <th scope="col" className="num">
                Dernière écriture
              </th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((f) => {
              const retard = enRetard(f);
              return (
                <tr key={f.flux} className={retard ? "retard" : undefined}>
                  <th scope="row" className="code">
                    {f.flux}
                  </th>
                  <td className="num">
                    {f.dernier_jour_vol === null ? "—" : `J+${nombre(f.dernier_jour_vol)}`}
                  </td>
                  <td className="num">
                    {horodatage(f.derniere_ecriture)}
                    {retard && (
                      <span className="ecart">
                        {f.retard_j === null
                          ? "aucune écriture en base"
                          : `${pluriel(Math.round(f.retard_j), "jour")} avant les autres flux`}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="pied">
        Un flux passe en ambre quand sa dernière écriture a plus d’un jour de
        retard sur les autres.
      </p>
    </Cadre>
  );
}

// ------------------------------------------------------------- volumetrie --
function Volumetrie({
  tables,
  choisie,
  ouvrir,
}: {
  tables: VolumeTable[];
  choisie: string | null;
  ouvrir: (nom: string) => void;
}) {
  const comptees = tables.filter((t) => !t.parcourable && t.lignes !== null).map((t) => t.nom);
  const inconnues = tables.filter((t) => t.lignes === null).map((t) => t.nom);

  return (
    <Cadre titre="Volumétrie" aide={pluriel(tables.length, "table")} sansPadding>
      <ul className="volumes">
        {tables.map((t) => {
          const contenu = (
            <>
              <span className="nom">{t.nom}</span>
              <span className="sr"> : </span>
              <span className="lignes">{nombre(t.lignes)}</span>
            </>
          );
          return (
            <li key={t.nom}>
              {t.parcourable ? (
                // Le nom accessible dit « lignes » : lu seul, hors de la colonne
                // qu'on voit, le chiffre ne dit pas ce qu'il compte.
                <button
                  type="button"
                  className="paire"
                  aria-label={`${t.nom}, ${t.lignes === null ? "non comptée" : pluriel(t.lignes, "ligne")}`}
                  aria-pressed={t.nom === choisie}
                  aria-controls="parcours"
                  onClick={() => ouvrir(t.nom)}
                >
                  {contenu}
                </button>
              ) : (
                <span className="paire fermee">{contenu}</span>
              )}
            </li>
          );
        })}
      </ul>
      {comptees.length > 0 && (
        <p className="pied">
          <Enumeration noms={comptees} />{" "}
          {comptees.length >= 2
            ? "sont comptées, pas parcourables\u00a0: leur lecture brute servirait les empreintes des mots de passe et des sessions."
            : "est comptée, pas parcourable\u00a0: sa lecture brute servirait des empreintes."}{" "}
          Les comptes se lisent dans l’onglet Comptes.
        </p>
      )}
      {inconnues.length > 0 && (
        <p className="pied">
          <Enumeration noms={inconnues} />{" "}
          {inconnues.length >= 2
            ? "existent en base, mais le serveur ne les connaît pas\u00a0: elles ne sont ni comptées ni parcourues."
            : "existe en base, mais le serveur ne la connaît pas\u00a0: elle n’est ni comptée ni parcourue."}
        </p>
      )}
    </Cadre>
  );
}

/** « a, b et c », chaque nom en police de code. */
function Enumeration({ noms }: { noms: string[] }) {
  return (
    <>
      {noms.map((n, i) => (
        <Fragment key={n}>
          {i > 0 && (i === noms.length - 1 ? " et " : ", ")}
          <code>{n}</code>
        </Fragment>
      ))}
    </>
  );
}

// -------------------------------------------------------------- parcours --
function Parcours({ nom, tables }: { nom: string | null; tables: VolumeTable[] }) {
  if (nom === null) {
    return (
      <Cadre titre="Parcours">
        <p className="muet">
          Choisissez une table dans la volumétrie&nbsp;: ses dernières lignes écrites
          s’affichent ici, sans mise en forme.
        </p>
      </Cadre>
    );
  }

  const table = tables.find((t) => t.nom === nom);
  if (!table) {
    return (
      <Cadre titre="Parcours">
        <p className="muet">
          Aucune table <code>{nom}</code> dans la base.
        </p>
      </Cadre>
    );
  }
  if (!table.parcourable) {
    return (
      <Cadre titre={nom}>
        <p className="muet">
          <code>{nom}</code> se compte mais ne se parcourt pas ici&nbsp;: sa lecture
          brute servirait des empreintes. Les comptes se lisent dans l’onglet Comptes.
        </p>
      </Cadre>
    );
  }
  return <Lignes nom={nom} />;
}

const LIMITES = [25, 50, 100, 200];

/**
 * Au-delà, une valeur texte passe à la ligne dans sa colonne : un résumé de
 * conversation tenu sur une seule ligne élargirait la table de mille pixels,
 * et on ouvre cette vue pour vérifier un chiffre, pas pour lire un résumé.
 */
const LONGUEUR_SUR_UNE_LIGNE = 48;

/**
 * Lecture brute d'une table : le dernier recours quand un chiffre paraît
 * faux. Côté serveur, le nom passe par une liste blanche — il n'est jamais
 * interpolé tel quel dans du SQL.
 *
 * Les nombres s'affichent tels que la base les stocke : un arrondi ou un
 * séparateur de milliers masquerait ici l'écart qu'on est venu chercher.
 */
function Lignes({ nom }: { nom: string }) {
  const [limite, setLimite] = useState(25);
  const { donnees, erreur, charge } = useChargement(() => api.table(nom, limite), [nom, limite]);

  return (
    <Cadre
      titre={nom}
      aide={
        donnees
          ? `${pluriel(donnees.colonnes.length, "colonne")} · dernières lignes écrites`
          : "dernières lignes écrites"
      }
      actions={
        <label className="limite">
          <span className="sr">Nombre de lignes</span>
          <select value={limite} onChange={(e) => setLimite(Number(e.target.value))}>
            {LIMITES.map((n) => (
              <option key={n} value={n}>
                {n} lignes
              </option>
            ))}
          </select>
        </label>
      }
      sansPadding
    >
      <Etat charge={charge} erreur={erreur} vide={donnees?.lignes.length === 0}>
        <div className="defile">
          <table className="brute">
            <thead>
              <tr>
                {donnees?.colonnes.map((c) => (
                  <th key={c} scope="col">
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
                    const texte = String(v);
                    return (
                      <td key={c} className={estNombre ? "num" : undefined}>
                        {v === null || v === undefined ? (
                          <span className="muet">null</span>
                        ) : estNombre ? (
                          texte
                        ) : texte.length > LONGUEUR_SUR_UNE_LIGNE ? (
                          <span className="long">{texte}</span>
                        ) : (
                          texte
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
  );
}
