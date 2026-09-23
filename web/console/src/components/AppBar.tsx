import { Link, useLocation } from "react-router-dom";
import { useCompte } from "../session";
import { Logo } from "./Icone";

/**
 * Deux entrées, pas quatre. « Résidents » et « Signaux » ouvraient la même
 * page sur deux onglets : c'est le registre. La fiche d'un résident reste
 * sous « Équipage », d'où on y arrive.
 */
const NAV = [
  { to: "/", libelle: "Équipage", actif: (p: string) => p === "/" || p.startsWith("/residents/") },
  { to: "/registre", libelle: "Registre", actif: (p: string) => p === "/registre" || p === "/signaux" },
];

export function AppBar() {
  const { compte, deconnecter } = useCompte();
  const { pathname } = useLocation();

  // Sans compte, la console tourne sur le jeu de démonstration : l'avatar le
  // dit au lieu d'afficher les initiales d'un soignant qui n'est pas là.
  const nom = compte
    ? `${compte.titre ? `${compte.titre} ` : ""}${compte.prenom} ${compte.nom}`
    : "Mode démonstration";
  const initiales = compte ? `${compte.prenom[0] ?? ""}${compte.nom[0] ?? ""}` : "··";

  return (
    <header className="appbar">
      <div className="app">
        <div className="appbar-in">
          <Link to="/" className="logo">
            <Logo />
            SOLA
          </Link>

          <nav className="navpills" aria-label="Écrans">
            {NAV.map((n) => {
              const actif = n.actif(pathname);
              return (
                <Link key={n.to} to={n.to} className={actif ? "on" : undefined} aria-current={actif ? "page" : undefined}>
                  {n.libelle}
                </Link>
              );
            })}
          </nav>

          <div className="qui">
            <div className="avatar" title={nom} aria-hidden="true">
              {initiales}
            </div>
            <div className="nom">
              <span>{nom}</span>
              {compte && (
                <button type="button" onClick={deconnecter}>
                  Se déconnecter
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
