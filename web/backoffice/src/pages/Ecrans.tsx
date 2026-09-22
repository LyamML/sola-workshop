import { api } from "../api";
import { Cadre, Etat, nombre } from "../components/Base";
import { useChargement } from "../hooks";

const CONSOLE_URL = import.meta.env.VITE_CONSOLE_URL ?? "http://localhost:5174";

/**
 * Correspondance entre ce qui s'affiche et ce qui le produit.
 *
 * Cette page existe pour une raison précise : pendant le workshop, les trois
 * écrans ont été dessinés avant la base. Tant que les chiffres restent écrits
 * en dur dans un fichier TypeScript, rien ne prouve que le schéma sait les
 * produire. Ici chaque bloc d'interface est affiché en face de la requête qui
 * le remplit, et de la valeur que cette requête renvoie à l'instant.
 *
 * Si une colonne « valeur » est vide, le bloc correspondant de la console est
 * du décor.
 */
export function Ecrans() {
  const { donnees, erreur, charge } = useChargement(() => api.ecrans(), []);

  return (
    <div className="page">
      <h1 className="titre">Écrans et sources</h1>
      <p className="sous">
        Chaque bloc des trois écrans, en face de la requête qui le remplit. Les
        valeurs ci-dessous sont lues dans la base à l’instant&nbsp;: elles
        doivent correspondre, au chiffre près, à ce qu’affiche la console.
      </p>

      <Etat charge={charge} erreur={erreur}>
        {donnees && (
          <div className="grille" style={{ gap: 16 }}>
            <div className="grille g-2">
              <Cadre titre="Dépistage" aide="v_depistage_jour" sansPadding>
                <div className="corps">
                  {[
                    ["Indice de bien-être", donnees.valeurs.depistage?.indice_bienetre, "/100"],
                    ["PHQ-9 ≥ 10", donnees.valeurs.depistage?.pct_phq9, "%"],
                    ["GAD-7 ≥ 10", donnees.valeurs.depistage?.pct_gad7, "%"],
                    ["ISI ≥ 15", donnees.valeurs.depistage?.pct_isi, "%"],
                  ].map(([l, v, u]) => (
                    <div className="paire" key={String(l)}>
                      <span>{String(l)}</span>
                      <span className="v">
                        {v ?? "—"} {String(u)}
                      </span>
                    </div>
                  ))}
                </div>
              </Cadre>

              <Cadre titre="Alertes physiologiques" aide="v_alertes_physio" sansPadding>
                <div className="corps">
                  {donnees.valeurs.physio.map((p) => (
                    <div className="paire" key={p.ordre}>
                      <span>{p.libelle}</span>
                      <span className="v">{p.pct} %</span>
                    </div>
                  ))}
                </div>
              </Cadre>

              <Cadre titre="Signaux par module" aide="v_signaux_module" sansPadding>
                <div className="corps">
                  {donnees.valeurs.modules.map((m) => (
                    <div className="paire" key={m.module}>
                      <span>Module {m.module}</span>
                      <span className="v">
                        {m.pct_residents} % · {nombre(m.signaux)}
                      </span>
                    </div>
                  ))}
                </div>
              </Cadre>

              <Cadre titre="Motifs de conversation" aide="v_motifs_30j · 30 jours" sansPadding>
                <div className="corps">
                  {donnees.valeurs.motifs.map((m) => (
                    <div className="paire" key={m.motif}>
                      <span>{m.motif}</span>
                      <span className="v">{nombre(m.conversations)}</span>
                    </div>
                  ))}
                </div>
              </Cadre>
            </div>

            <Cadre
              titre="Courbe de bien-être"
              aide="v_bienetre_jour · 12 derniers points"
              sansPadding
            >
              <div className="defile">
                <table>
                  <thead>
                    <tr>
                      <th>Jour</th>
                      <th className="num">Jour de vol</th>
                      <th className="num">Indice</th>
                      <th className="num">Résidents évalués</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.valeurs.bienetre.map((b) => (
                      <tr key={b.jour}>
                        <td className="code">{b.jour}</td>
                        <td className="num">J+{nombre(b.jour_vol)}</td>
                        <td className="num">{b.indice}</td>
                        <td className="num">{nombre(b.residents_evalues)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Cadre>

            {donnees.ecrans.map((e) => (
              <Cadre
                key={e.ecran}
                titre={e.ecran}
                aide={`${e.blocs.length} bloc${e.blocs.length > 1 ? "s" : ""}`}
                sansPadding
                actions={
                  e.ecran.startsWith("02") ? (
                    <a className="bouton mini" href={CONSOLE_URL} target="_blank" rel="noreferrer">
                      Ouvrir l’écran ↗
                    </a>
                  ) : undefined
                }
              >
                <div>
                  {e.blocs.map((b) => (
                    <div className="bloc-ecran" key={b.bloc}>
                      <b>{b.bloc}</b>
                      <code>{b.source}</code>
                      <code style={{ color: "var(--accent-2)" }}>{b.route}</code>
                    </div>
                  ))}
                </div>
              </Cadre>
            ))}

            <div className="avert">
              L’écran 01 n’a volontairement aucune source ici. La borne de cabine
              écrit dans <b>une autre base</b>, restée dans la cabine, et n’envoie
              au serveur de bord que le résumé clinique produit sur place. C’est
              une frontière de données, pas une règle d’usage&nbsp;: le verbatim
              n’existe nulle part dans ce schéma, donc personne ne peut le lire —
              ni un médecin, ni un administrateur, ni quelqu’un qui volerait le
              fichier.
            </div>
          </div>
        )}
      </Etat>
    </div>
  );
}
