import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { LigneFile } from "../types";

/** Ce que la fiche affiche en fil d'Ariane quand on y arrive depuis la file. */
export const RETOUR_EQUIPAGE = { chemin: "/", libelle: "Santé de l'équipage" };

/**
 * La file de triage : gravité, qui, quoi, quand, et qui s'en occupe.
 *
 * L'assigné est à droite, en bout de ligne : c'est là que l'œil finit, et un
 * signal critique sans personne s'y lit comme une défaillance. Sur un signal
 * que personne n'a pris, un médecin connecté voit « Je prends » à cet endroit.
 *
 * La ligne entière ouvre la fiche, à la souris ; le nom est un vrai lien, qui
 * porte le clavier et l'ouverture dans un autre onglet.
 */
export function FileTriage({
  lignes,
  moi,
  peutAgir,
  enCours,
  onPrendre,
}: {
  lignes: LigneFile[];
  /** L'identifiant du médecin connecté, pour écrire « vous ». */
  moi: number | null;
  peutAgir: boolean;
  /** Le signal dont la prise est partie au serveur. */
  enCours: number | null;
  onPrendre: (ligne: LigneFile) => void;
}) {
  const aller = useNavigate();

  if (!lignes.length) return <p className="vide">Aucun signal ouvert : personne n'attend.</p>;

  const ouvrir = (l: LigneFile) =>
    aller(`/residents/${encodeURIComponent(l.resident)}`, { state: { retour: RETOUR_EQUIPAGE } });

  return (
    <div className="tq">
      {lignes.map((l) => {
        const moiAussi = moi !== null && l.assigneId === moi;
        return (
          <div
            key={l.id}
            className="tq-row go"
            onClick={() => ouvrir(l)}
          >
            <span>
              <span className={`chip ${l.gravite.ton}`}>{l.gravite.libelle}</span>
            </span>
            <span className="tq-who">
              <Link
                to={`/residents/${encodeURIComponent(l.resident)}`}
                state={{ retour: RETOUR_EQUIPAGE }}
                onClick={(e: MouseEvent) => e.stopPropagation()}
              >
                <b>{l.nom}</b>
              </Link>
              <span>{l.details}</span>
            </span>
            <span className="tq-sig">
              {l.motif}
              <small>{l.origine}</small>
            </span>
            <span className="tq-h">
              {l.jour && <small>{l.jour}</small>}
              {l.heure}
            </span>
            <span className="tq-as">
              {l.assigne ? (
                moiAussi ? (
                  <span className="me">{l.assigne} · vous</span>
                ) : (
                  l.assigne
                )
              ) : peutAgir ? (
                <button
                  type="button"
                  className="btn mini pri"
                  disabled={enCours === l.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPrendre(l);
                  }}
                >
                  {enCours === l.id ? "Envoi…" : "Je prends"}
                </button>
              ) : (
                <span className="personne">sans personne</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
