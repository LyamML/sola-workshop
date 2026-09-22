import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type NouvelleParticularite, type Statut } from "../api";
import { Cadre, Etat, Puce, duree, horodatage, nombre } from "../components/Base";
import { useChargement } from "../hooks";

const CONSOLE_URL = import.meta.env.VITE_CONSOLE_URL ?? "http://localhost:5174";

/**
 * Fiche vue depuis le backoffice.
 *
 * Elle lit EXACTEMENT la même route que la console médicale
 * (`GET /api/residents/:code`), et affiche les champs bruts plutôt que mis en
 * forme. Mettre les deux écrans côte à côte est la façon la plus rapide de
 * voir si un chiffre de l'interface vient bien de la base.
 */
export function ResidentDetail() {
  const { code = "" } = useParams();
  const [message, setMessage] = useState<{ texte: string; ok: boolean } | null>(null);

  const { donnees, erreur, charge, relancer } = useChargement(() => api.fiche(code), [code]);

  async function changerStatut(statut: Statut) {
    try {
      await api.modifierResident(code, { statut });
      setMessage({ texte: `Statut passé à « ${statut} ».`, ok: true });
      relancer();
    } catch (e) {
      setMessage({ texte: e instanceof Error ? e.message : "Échec", ok: false });
    }
  }

  const r = donnees?.resident as
    | (Record<string, unknown> & {
        code: string;
        prenom: string;
        nom: string;
        poste: string;
        cabine: string;
        statut: Statut;
        age: number;
        groupe_sanguin: string;
      })
    | undefined;

  const derniere = donnees?.constantes.at(-1);
  const scores = donnees?.etat_mental[0];

  return (
    <div className="page">
      <Link to="/residents" style={{ color: "var(--ink-3)", fontSize: 13 }}>
        ← Équipage
      </Link>

      <Etat charge={charge} erreur={erreur}>
        {donnees && r && (
          <>
            <div className="entete-fiche" style={{ marginTop: 14 }}>
              <div className="pastille">
                {r.prenom[0]}
                {r.nom[0]}
              </div>
              <div>
                <h1 className="titre" style={{ marginBottom: 2 }}>
                  {r.prenom} {r.nom}
                </h1>
                <div style={{ color: "var(--ink-2)", fontSize: 13.5 }}>
                  <span className="mono">{r.code}</span> · {r.age} ans · {r.poste} ·
                  cabine {r.cabine} · groupe {r.groupe_sanguin}
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                <Puce niveau={r.statut} />
                <a
                  className="bouton mini"
                  href={`${CONSOLE_URL}/residents/${r.code}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Voir dans la console ↗
                </a>
              </div>
            </div>

            {message && (
              <div
                className={`message ${message.ok ? "succes" : "erreur"}`}
                style={{ marginBottom: 16 }}
              >
                {message.texte}
              </div>
            )}

            <div className="grille" style={{ gap: 16 }}>
              <Cadre
                titre="Statut du dossier"
                aide="ce que l’écran 02 affiche dans la file de triage"
              >
                <div className="filtres">
                  {(["ok", "surveillance", "critique"] as Statut[]).map((s) => (
                    <button
                      key={s}
                      className={`bouton ${r.statut === s ? "primaire" : ""}`}
                      disabled={r.statut === s}
                      onClick={() => changerStatut(s)}
                    >
                      {s === "ok" ? "Aucun signal" : s === "surveillance" ? "Surveillance" : "Critique"}
                    </button>
                  ))}
                </div>
              </Cadre>

              <div className="grille g-2">
                <Cadre
                  titre="Dernières constantes"
                  aide={derniere ? `J+${nombre(derniere.jour_vol)}` : undefined}
                  sansPadding
                >
                  <div className="defile">
                    <table>
                      <tbody>
                        {[
                          ["FC de repos", derniere?.fc_repos_bpm, "bpm"],
                          ["RMSSD", derniere?.rmssd_ms, "ms"],
                          ["SpO₂", derniere?.spo2_pct, "%"],
                          ["Respiration", derniere?.resp_min, "/min"],
                          ["Température", derniere?.temp_c, "°C"],
                          ["Électrodermale", derniere?.eda_us, "µS"],
                          ["Pas", derniere?.pas, ""],
                        ].map(([label, v, unite]) => (
                          <tr key={String(label)}>
                            <td>{label}</td>
                            <td className="num">
                              {v === null || v === undefined ? "—" : nombre(Number(v))}{" "}
                              <span style={{ color: "var(--ink-3)" }}>{unite}</span>
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td>Dernière nuit</td>
                          <td className="num">{duree(donnees.nuits.at(-1)?.sommeil_min)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Cadre>

                <Cadre
                  titre="Dépistage"
                  aide={scores ? `évalué le ${horodatage(scores.evalue_le)}` : undefined}
                  sansPadding
                >
                  <div className="defile">
                    <table>
                      <tbody>
                        {[
                          ["Moral", scores?.score_moral, "/100", null],
                          ["PHQ-9 · dépression", scores?.phq9, "/27", 10],
                          ["GAD-7 · anxiété", scores?.gad7, "/21", 10],
                          ["ISI · insomnie", scores?.isi, "/28", 15],
                        ].map(([label, v, sur, seuil]) => {
                          const valeur = v as number | null | undefined;
                          const alerte =
                            seuil !== null && valeur !== null && valeur !== undefined &&
                            valeur >= (seuil as number);
                          return (
                            <tr key={String(label)}>
                              <td>{String(label)}</td>
                              <td className="num" style={alerte ? { color: "var(--watch)" } : undefined}>
                                {valeur ?? "—"}
                                <span style={{ color: "var(--ink-3)" }}>{String(sur)}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Cadre>
              </div>

              <Cadre
                titre="Particularités médicales"
                aide={`${donnees.particularites.length} enregistrée${donnees.particularites.length > 1 ? "s" : ""}`}
                actions={<AjoutParticularite code={code} apresAjout={relancer} />}
              >
                {donnees.particularites.length === 0 ? (
                  <div className="vide">Aucune particularité enregistrée.</div>
                ) : (
                  <div className="liste-serree">
                    {donnees.particularites.map((p, i) => (
                      <div key={i}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <Puce niveau={p.niveau} />
                          <b>{p.titre}</b>
                          <span className="puce neutre">{p.type}</span>
                        </div>
                        <p className="resume" style={{ marginTop: 5 }}>
                          {p.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Cadre>

              <Cadre
                titre="Résumés de conversation"
                aide={`${nombre(donnees.conversations_total)} au total · les 20 derniers`}
              >
                <div className="avert" style={{ marginBottom: 14 }}>
                  Ces lignes ne contiennent <b>aucun verbatim</b>. Le modèle tourne
                  dans la borne, en cabine, et n’envoie ici que le résumé clinique
                  qu’il a produit. La table <code>conversations</code> n’a pas de
                  colonne de transcription, et la route d’ingestion rejette en 422
                  tout corps qui en contiendrait une.
                </div>
                <div className="liste-serree">
                  {donnees.conversations.slice(0, 6).map((c) => (
                    <div key={c.id}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Puce niveau={c.severite} />
                        <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                          J+{nombre(c.jour_vol)} · {horodatage(c.debut_at)} · {c.duree_min} min
                        </span>
                        {c.remontee_auto === 1 && (
                          <span className="puce neutre">remonté automatiquement</span>
                        )}
                      </div>
                      <p className="resume" style={{ marginTop: 6 }}>
                        {c.resume}
                      </p>
                      <div className="etiquettes">
                        {c.tags.map((t) => (
                          <span key={t} className="puce neutre">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Cadre>
            </div>
          </>
        )}
      </Etat>
    </div>
  );
}

/** Formulaire d'ajout, replié tant qu'on n'en a pas besoin. */
function AjoutParticularite({ code, apresAjout }: { code: string; apresAjout: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [champs, setChamps] = useState<NouvelleParticularite>({
    type: "allergie",
    niveau: "critique",
    titre: "",
    detail: "",
  });

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    try {
      await api.ajouterParticularite(code, champs);
      setChamps({ ...champs, titre: "", detail: "" });
      setOuvert(false);
      apresAjout();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Échec");
    }
  }

  if (!ouvert) {
    return (
      <button className="bouton mini" onClick={() => setOuvert(true)}>
        + Ajouter
      </button>
    );
  }

  return (
    <form
      onSubmit={envoyer}
      style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 320 }}
    >
      <div className="filtres">
        <select
          value={champs.type}
          onChange={(e) => setChamps({ ...champs, type: e.target.value as never })}
        >
          <option value="allergie">Allergie</option>
          <option value="contre_indication">Contre-indication</option>
          <option value="antecedent">Antécédent</option>
          <option value="info">Information</option>
        </select>
        <select
          value={champs.niveau}
          onChange={(e) => setChamps({ ...champs, niveau: e.target.value as never })}
        >
          <option value="critique">Critique</option>
          <option value="surveillance">Surveillance</option>
          <option value="info">Information</option>
        </select>
      </div>
      <input
        type="text"
        placeholder="Titre — ex. « Arachide, allergie sévère »"
        value={champs.titre}
        onChange={(e) => setChamps({ ...champs, titre: e.target.value })}
        required
      />
      <textarea
        placeholder="Détail : conduite à tenir, antécédent, alternative thérapeutique…"
        rows={3}
        value={champs.detail}
        onChange={(e) => setChamps({ ...champs, detail: e.target.value })}
        required
      />
      {erreur && <div className="message erreur">{erreur}</div>}
      <div className="filtres">
        <button type="submit" className="bouton primaire">
          Enregistrer
        </button>
        <button type="button" className="bouton" onClick={() => setOuvert(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}
