import { Link, NavLink } from "react-router-dom";
import { useCompte } from "../session";

const NAV = [
  { to: "/", label: "Équipage", end: true },
  { to: "/registre", label: "Résidents", end: false },
  { to: "/signaux", label: "Signaux", end: false },
];

export function AppBar() {
  const { compte, deconnecter } = useCompte();

  // Sans compte, la console tourne sur le jeu de démonstration : l'avatar le
  // dit au lieu d'afficher les initiales d'un soignant qui n'est pas là.
  const nom = compte
    ? `${compte.titre ? `${compte.titre} ` : ""}${compte.prenom} ${compte.nom}`
    : "Mode démonstration";
  const initiales = compte
    ? `${compte.prenom[0] ?? ""}${compte.nom[0] ?? ""}`
    : "··";

  return (
    <header className="appbar">
      <div className="app">
        <div className="appbar-in">
          <div className="logo">
            <svg width="17" height="17" viewBox="0 0 26 26" aria-hidden="true">
              <circle cx="13" cy="13" r="4.4" fill="var(--accent)" />
              <path
                d="M13 1.4v3.2M13 21.4v3.2M1.4 13h3.2M21.4 13h3.2"
                stroke="var(--accent)"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
            SOLA
          </div>

          <nav className="navpills">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? "on" : undefined)}
              >
                {item.label}
              </NavLink>
            ))}
            <a href="#protocoles" onClick={(e) => e.preventDefault()}>
              Protocoles
            </a>
          </nav>

          <div className="right">
            <Link to="/registre" className="searchbox">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-4-4" />
              </svg>
              Rechercher un résident…
            </Link>
            <div className="qui">
              <div className="avatar" title={nom}>
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
      </div>
    </header>
  );
}
