import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Cadre, Etat, Puce, duree, nombre } from "../components/Base";
import { useChargement, useRetard } from "../hooks";

const MODULES = [
  ["", "Tous les modules"],
  ["A", "A · Commandement"],
  ["B", "B · Habitat 1"],
  ["C", "C · Hydroponie"],
  ["D", "D · Habitat 2"],
  ["E", "E · Maintenance"],
  ["F", "F · Recherche"],
];

const PAR_PAGE = 50;

/** Recherche dans l'équipage. Le point d'entrée de tout le reste. */
export function Residents() {
  const [q, setQ] = useState("");
  const [module, setModule] = useState("");
  const [statut, setStatut] = useState("");
  const [page, setPage] = useState(0);

  // La recherche part 250 ms après la dernière frappe, pas à chaque caractère.
  const qRetarde = useRetard(q);

  const { donnees, erreur, charge } = useChargement(
    () => api.residents({ q: qRetarde, module, statut, page, limite: PAR_PAGE }),
    [qRetarde, module, statut, page],
  );

  // Changer un filtre ramène en première page : rester page 7 d'une liste qui
  // n'en compte plus que 2 affiche un tableau vide sans rien expliquer.
  function filtrer(action: () => void) {
    action();
    setPage(0);
  }

  const total = donnees?.total ?? 0;
  const pages = Math.ceil(total / PAR_PAGE);

  return (
    <div className="page">
      <h1 className="titre">Équipage</h1>
      <p className="sous">
        Les 1 240 résidents du Méridien. Le tri place d’abord les statuts
        critiques&nbsp;: c’est l’ordre dans lequel on veut les voir en ouvrant
        l’écran.
      </p>

      <Cadre
        titre={`${nombre(total)} résident${total > 1 ? "s" : ""}`}
        aide={pages > 1 ? `page ${page + 1} sur ${pages}` : undefined}
        sansPadding
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <div className="filtres">
            <input
              type="text"
              className="recherche"
              placeholder="Code, nom, prénom ou cabine…"
              value={q}
              onChange={(e) => filtrer(() => setQ(e.target.value))}
            />
            <select value={module} onChange={(e) => filtrer(() => setModule(e.target.value))}>
              {MODULES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select value={statut} onChange={(e) => filtrer(() => setStatut(e.target.value))}>
              <option value="">Tous les statuts</option>
              <option value="critique">Critique</option>
              <option value="surveillance">Surveillance</option>
              <option value="ok">Aucun signal</option>
            </select>
          </div>
        </div>

        <Etat charge={charge} erreur={erreur} vide={donnees?.lignes.length === 0}>
          <div className="defile">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Nom</th>
                  <th>Poste</th>
                  <th>Cabine</th>
                  <th className="num">Âge</th>
                  <th>Statut</th>
                  <th className="num">Signaux</th>
                  <th className="num">Moral</th>
                  <th className="num">Dernière nuit</th>
                </tr>
              </thead>
              <tbody>
                {donnees?.lignes.map((r) => (
                  <tr key={r.code}>
                    <td className="code">
                      <Link to={`/residents/${r.code}`} style={{ color: "var(--accent-2)" }}>
                        {r.code}
                      </Link>
                    </td>
                    <td>
                      {r.prenom} {r.nom}
                    </td>
                    <td style={{ color: "var(--ink-2)" }}>{r.poste}</td>
                    <td className="code">{r.cabine}</td>
                    <td className="num">{r.age}</td>
                    <td>
                      <Puce niveau={r.statut} />
                    </td>
                    <td className="num">{r.signaux || "—"}</td>
                    <td className="num">{r.moral ?? "—"}</td>
                    <td className="num">{duree(r.sommeil_min)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Etat>

        {pages > 1 && (
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              padding: "12px 18px",
              borderTop: "1px solid var(--line)",
            }}
          >
            <button
              className="bouton mini"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Précédente
            </button>
            <button
              className="bouton mini"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivante →
            </button>
            <span style={{ color: "var(--ink-3)", fontSize: 12.5 }}>
              {nombre(page * PAR_PAGE + 1)}–
              {nombre(Math.min((page + 1) * PAR_PAGE, total))} sur {nombre(total)}
            </span>
          </div>
        )}
      </Cadre>
    </div>
  );
}
