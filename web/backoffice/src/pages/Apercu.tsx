import { api } from "../api";
import { Cadre, Etat, Puce, Tuile, horodatage, nombre } from "../components/Base";
import { useChargement } from "../hooks";

/**
 * Écran d'accueil : est-ce que la base contient ce qu'on croit ?
 *
 * C'est la première question à se poser quand un graphique paraît figé, et
 * la seule que la console médicale ne permet pas de poser.
 */
export function Apercu() {
  const { donnees, erreur, charge, relancer } = useChargement(() => api.apercu(), []);

  return (
    <div className="page">
      <h1 className="titre">Aperçu de la base</h1>
      <p className="sous">
        Ce que le serveur de bord a réellement en mémoire, table par table. Les
        quatre indicateurs de tête sont ceux de l’écran 02 de la console : s’ils
        diffèrent ici et là-bas, c’est l’interface qui ment, pas la base.
      </p>

      <Etat charge={charge} erreur={erreur}>
        {donnees && (
          <div className="grille" style={{ gap: 18 }}>
            <div className="grille g-4">
              <Tuile
                etiquette="Indice de bien-être"
                valeur={donnees.depistage?.indice_bienetre ?? "—"}
                unite="/100"
                note={`${nombre(donnees.depistage?.residents)} résidents évalués`}
              />
              <Tuile
                etiquette="PHQ-9 ≥ 10"
                valeur={donnees.depistage?.pct_phq9 ?? "—"}
                unite="%"
                note={`${nombre(donnees.depistage?.n_phq9)} résidents`}
              />
              <Tuile
                etiquette="GAD-7 ≥ 10"
                valeur={donnees.depistage?.pct_gad7 ?? "—"}
                unite="%"
                note={`${nombre(donnees.depistage?.n_gad7)} résidents`}
              />
              <Tuile
                etiquette="ISI ≥ 15"
                valeur={donnees.depistage?.pct_isi ?? "—"}
                unite="%"
                note={`${nombre(donnees.depistage?.n_isi)} résidents`}
              />
            </div>

            <div className="grille g-2">
              <Cadre
                titre="Volumétrie"
                aide={donnees.base.split(/[\\/]/).pop()}
                sansPadding
                actions={
                  <button className="bouton mini" onClick={relancer}>
                    Rafraîchir
                  </button>
                }
              >
                <div className="defile">
                  <table>
                    <thead>
                      <tr>
                        <th>Table</th>
                        <th className="num">Lignes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {donnees.tables.map((t) => (
                        <tr key={t.nom}>
                          <td className="code">{t.nom}</td>
                          <td className="num">{nombre(t.lignes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Cadre>

              <div className="grille" style={{ alignContent: "start" }}>
                <Cadre
                  titre="Fraîcheur des flux"
                  aide="dernière donnée reçue"
                  sansPadding
                >
                  <div className="defile">
                    <table>
                      <tbody>
                        {donnees.fraicheur.map((f) => (
                          <tr key={f.flux}>
                            <td className="code">{f.flux}</td>
                            <td className="num">{horodatage(f.dernier)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Cadre>

                <Cadre titre="Signaux" aide="par statut et gravité" sansPadding>
                  <div className="defile">
                    <table>
                      <tbody>
                        {donnees.signaux.map((s) => (
                          <tr key={`${s.statut}-${s.severite}`}>
                            <td>
                              <Puce niveau={s.severite} />
                            </td>
                            <td>
                              <Puce niveau={s.statut} />
                            </td>
                            <td className="num">{nombre(s.n)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Cadre>
              </div>
            </div>

            <div className="avert">
              Jour de vol&nbsp;: J+{nombre(donnees.jour_vol)}. Les dates du jeu de
              démonstration sont relatives à aujourd’hui — la base est régénérable
              par <code>npm&nbsp;run&nbsp;db:reset</code>, et le générateur est
              déterministe&nbsp;: deux exécutions donnent exactement les mêmes
              chiffres.
            </div>
          </div>
        )}
      </Etat>
    </div>
  );
}
