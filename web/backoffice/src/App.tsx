import { useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { jeton, oublierJeton, poserJeton } from "./api";
import { Apercu } from "./pages/Apercu";
import { Ecrans } from "./pages/Ecrans";
import { ResidentDetail } from "./pages/ResidentDetail";
import { Residents } from "./pages/Residents";
import { Signaux } from "./pages/Signaux";
import { Tables } from "./pages/Tables";

const ONGLETS = [
  ["/", "Aperçu"],
  ["/residents", "Équipage"],
  ["/signaux", "Signaux"],
  ["/ecrans", "Écrans et sources"],
  ["/tables", "Tables"],
];

export default function App() {
  const [connecte, setConnecte] = useState(() => jeton().length > 0);

  if (!connecte) return <Connexion onEntre={() => setConnecte(true)} />;

  return (
    <>
      <header className="barre">
        <div className="barre-in">
          <div className="marque">
            Sola <span>Backoffice</span>
          </div>
          <nav className="onglets">
            {ONGLETS.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) => (isActive ? "actif" : "")}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="fin">
            <span>Méridien · J+4 128</span>
            <button
              className="bouton mini"
              onClick={() => {
                oublierJeton();
                setConnecte(false);
              }}
            >
              Quitter
            </button>
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Apercu />} />
        <Route path="/residents" element={<Residents />} />
        <Route path="/residents/:code" element={<ResidentDetail />} />
        <Route path="/signaux" element={<Signaux />} />
        <Route path="/ecrans" element={<Ecrans />} />
        <Route path="/tables" element={<Tables />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

/**
 * Saisie du jeton d'administration.
 *
 * Ce n'est pas une authentification : il n'y a pas de compte, pas de mot de
 * passe, pas de trace de qui agit. Le jeton vit dans `sessionStorage` et
 * disparaît à la fermeture de l'onglet. C'est assumé pour un prototype, et
 * c'est la première chose à remplacer avant tout usage réel — un vaisseau où
 * l'on ne sait pas qui a modifié un dossier médical n'est pas un vaisseau où
 * l'on peut se soigner.
 */
function Connexion({ onEntre }: { onEntre: () => void }) {
  const [valeur, setValeur] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  function envoyer(e: React.FormEvent) {
    e.preventDefault();
    if (valeur.trim().length < 32) {
      setErreur("Le jeton d’administration fait au moins 32 caractères.");
      return;
    }
    poserJeton(valeur.trim());
    onEntre();
  }

  return (
    <div className="connexion">
      <div className="marque" style={{ fontSize: 19 }}>
        Sola <span>Backoffice</span>
      </div>
      <p className="sous" style={{ marginTop: 10 }}>
        Outil d’exploitation du serveur de bord. Le jeton est celui de{" "}
        <code>ADMIN_TOKEN</code>, dans <code>server/.env</code>.
      </p>
      <form onSubmit={envoyer}>
        <input
          type="password"
          placeholder="Jeton d’administration"
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          autoFocus
        />
        {erreur && <div className="message erreur">{erreur}</div>}
        <button type="submit" className="bouton primaire">
          Entrer
        </button>
      </form>
      <div className="avert" style={{ marginTop: 18 }}>
        Le jeton est conservé le temps de l’onglet uniquement. Il est distinct de
        celui des bornes de cabine&nbsp;: une borne écrit des mesures, elle ne
        doit pas pouvoir modifier un dossier.
      </div>
    </div>
  );
}
