import { Link, NavLink } from "react-router-dom";

const NAV = [
  { to: "/", label: "Équipage", end: true },
  { to: "/registre", label: "Résidents", end: false },
  { to: "/signaux", label: "Signaux", end: false },
];

export function AppBar() {
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
            <div className="avatar" title="Dr. A. Ferreira">
              AF
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
