import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Signal } from "../api";
import { Cadre, Etat, Puce, horodatage, nombre } from "../components/Base";
import { useChargement } from "../hooks";

/**
 * La seule assignation qui ne soit pas une personne. Elle reste du texte
 * libre : il n'y a pas de compte « équipe », et en inventer un ferait signer
 * des notes par personne.
 */
const EQUIPE = "Équipe d’intervention";

/**
 * La file de triage, en version travail.
 *
 * La console médicale l'affiche ; ici on agit dessus : assigner, prendre en
 * charge, clore. Clore exige un motif — c'est la seule information qui
 * permettra plus tard de mesurer les faux positifs du moteur de règles.
 */
export function Signaux() {
  const [filtre, setFiltre] = useState("ouverts");
  const [message, setMessage] = useState<string | null>(null);

  const { donnees, erreur, charge, relancer } = useChargement(
    () => api.signaux(filtre),
    [filtre],
  );

  // Les soignants viennent des comptes, plus d'une liste écrite en dur :
  // assigner un signal à quelqu'un qui n'a pas de compte, c'est l'assigner à
  // personne.
  const { donnees: comptes } = useChargement(() => api.comptes(), []);
  const medecins = (comptes?.lignes ?? []).filter((c) => c.role === "medecin" && c.actif);

  async function agir(id: number, champs: Parameters<typeof api.modifierSignal>[1]) {
    setMessage(null);
    try {
      await api.modifierSignal(id, champs);
      relancer();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Échec");
    }
  }

  function clore(s: Signal) {
    const motif = window.prompt(
      `Clore le signal de ${s.resident} — pourquoi ?\n\n` +
        "Cette phrase sert à mesurer les faux positifs du moteur de règles.",
      "Entretien réalisé, retour à la normale",
    );
    if (motif) void agir(s.id, { statut: "clos", clos_motif: motif });
  }

  const lignes = donnees?.lignes ?? [];

  return (
    <div className="page">
      <h1 className="titre">Signaux</h1>
      <p className="sous">
        Ce que la console affiche en file de triage, avec de quoi agir dessus.
        L’ordre est celui de l’écran&nbsp;02&nbsp;: gravité d’abord, puis
        ancienneté — le signal critique le plus ancien est celui qui attend
        depuis le plus longtemps.
      </p>

      {message && (
        <div className="message erreur" style={{ marginBottom: 16 }}>
          {message}
        </div>
      )}

      <Cadre titre={`${nombre(lignes.length)} signaux`} sansPadding>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <div className="filtres">
            {[
              ["ouverts", "Ouverts et en cours"],
              ["ouvert", "Ouverts seulement"],
              ["en_cours", "En cours"],
              ["clos", "Clos"],
              ["tous", "Tous"],
            ].map(([v, l]) => (
              <button
                key={v}
                className={`bouton mini ${filtre === v ? "primaire" : ""}`}
                onClick={() => setFiltre(v)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <Etat charge={charge} erreur={erreur} vide={lignes.length === 0}>
          <div className="defile">
            <table>
              <thead>
                <tr>
                  <th>Gravité</th>
                  <th>Résident</th>
                  <th>Motif</th>
                  <th>Origine</th>
                  <th className="num">Ouvert</th>
                  <th>Assigné à</th>
                  <th>Statut</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lignes.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Puce niveau={s.severite} />
                    </td>
                    <td className="code">
                      <Link to={`/residents/${s.resident}`} style={{ color: "var(--accent-2)" }}>
                        {s.resident}
                      </Link>
                      <div style={{ color: "var(--ink-3)", fontSize: 12 }}>
                        {s.cabine} · {s.age} ans
                      </div>
                    </td>
                    <td style={{ maxWidth: 330 }}>{s.motif}</td>
                    <td>
                      <span className="puce neutre">{s.origine}</span>
                    </td>
                    <td className="num">{horodatage(s.ouvert_at)}</td>
                    <td>
                      {s.statut === "clos" ? (
                        <span style={{ color: "var(--ink-3)" }}>{s.assigne_a ?? "—"}</span>
                      ) : (
                        <select
                          value={s.assigne_id ? `m:${s.assigne_id}` : s.assigne_a ? "equipe" : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            // Trois cas, un seul champ : un compte, l'équipe,
                            // ou rien. Le serveur vide l'autre colonne.
                            agir(
                              s.id,
                              v.startsWith("m:")
                                ? { assigne_id: Number(v.slice(2)), statut: "en_cours" }
                                : v === "equipe"
                                  ? { assigne_a: EQUIPE, statut: "en_cours" }
                                  : { assigne_a: null, statut: "ouvert" },
                            );
                          }}
                        >
                          <option value="">Non assigné</option>
                          {medecins.map((m) => (
                            <option key={m.id} value={`m:${m.id}`}>
                              {m.titre ? `${m.titre} ` : ""}
                              {m.nom}
                            </option>
                          ))}
                          <option value="equipe">{EQUIPE}</option>
                        </select>
                      )}
                    </td>
                    <td>
                      <Puce niveau={s.statut} />
                      {s.clos_motif && (
                        <div style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 3 }}>
                          {s.clos_motif}
                        </div>
                      )}
                    </td>
                    <td>
                      {s.statut !== "clos" && (
                        <button className="bouton mini" onClick={() => clore(s)}>
                          Clore
                        </button>
                      )}
                    </td>
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
