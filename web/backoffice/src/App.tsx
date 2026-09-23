import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ErreurApi, type Compte, api } from "./api";
import { Apercu } from "./pages/Apercu";
import { Comptes } from "./pages/Comptes";
import { Ecrans } from "./pages/Ecrans";
import { ResidentDetail } from "./pages/ResidentDetail";
import { Residents } from "./pages/Residents";
import { Signaux } from "./pages/Signaux";
import { Tables } from "./pages/Tables";

const ONGLETS = [
  ["/", "Aperçu"],
  ["/residents", "Équipage"],
  ["/signaux", "Signaux"],
  ["/comptes", "Comptes"],
  ["/ecrans", "Écrans et sources"],
  ["/tables", "Tables"],
];

type Etat =
  | { phase: "chargement" }
  | { phase: "dehors"; horsLigne: boolean }
  | { phase: "dedans"; compte: Compte };

export default function App() {
  const [etat, setEtat] = useState<Etat>({ phase: "chargement" });

  useEffect(() => {
    api
      .moi()
      .then((r) => setEtat({ phase: "dedans", compte: r.compte }))
      // Un 401 est une réponse — « personne » — et tout le reste une panne.
      .catch((e: unknown) =>
        setEtat({ phase: "dehors", horsLigne: !(e instanceof ErreurApi) }),
      );
  }, []);

  const sortir = useCallback(() => {
    api
      .deconnexion()
      .catch(() => {
        /* le cookie expire de toute façon ; on rend la main sans bloquer */
      })
      .finally(() => setEtat({ phase: "dehors", horsLigne: false }));
  }, []);

  if (etat.phase === "chargement") return <div className="connexion">Sola…</div>;

  if (etat.phase === "dehors") {
    return (
      <Connexion
        horsLigne={etat.horsLigne}
        onEntre={(compte) => setEtat({ phase: "dedans", compte })}
      />
    );
  }

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
            <span>
              {etat.compte.prenom} {etat.compte.nom} · J+4 128
            </span>
            <button className="bouton mini" onClick={sortir}>
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
        <Route path="/comptes" element={<Comptes />} />
        <Route path="/ecrans" element={<Ecrans />} />
        <Route path="/tables" element={<Tables />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

/**
 * Connexion d'un administrateur.
 *
 * Le jeton partagé a disparu : il prouvait qu'on connaissait une clé, jamais
 * qu'on était quelqu'un, et le backoffice écrit dans des dossiers médicaux.
 * À sa place, un compte de la table `admins`, un mot de passe haché en
 * argon2id et une session dans un cookie `httpOnly`. Les médecins ne passent
 * pas cette porte : le serveur réserve `/admin` au rôle administrateur.
 */
function Connexion({
  horsLigne,
  onEntre,
}: {
  horsLigne: boolean;
  onEntre: (compte: Compte) => void;
}) {
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      const { compte } = await api.connexion(email.trim(), mdp);
      if (compte.role !== "admin") {
        // Le serveur le refuserait de toute façon sur chaque route ; le dire
        // ici évite un backoffice ouvert sur six pages toutes en erreur.
        await api.deconnexion().catch(() => {});
        setMdp("");
        setErreur("Ce compte est un compte soignant : il ouvre la console, pas le backoffice.");
        setEnvoi(false);
        return;
      }
      onEntre(compte);
    } catch (e) {
      // Le mot de passe est vidé, l'adresse reste : on se trompe de mot de
      // passe, rarement d'adresse.
      setMdp("");
      setErreur(e instanceof ErreurApi ? e.message : "Le serveur de bord ne répond pas.");
      setEnvoi(false);
    }
  }

  return (
    <div className="connexion">
      <div className="marque" style={{ fontSize: 19 }}>
        Sola <span>Backoffice</span>
      </div>
      <p className="sous" style={{ marginTop: 10 }}>
        Outil d’exploitation du serveur de bord, réservé aux administrateurs. Le
        premier compte se crée au terminal&nbsp;: <code>npm run compte -- admin</code>.
      </p>
      <form onSubmit={envoyer}>
        <input
          type="email"
          placeholder="Adresse de bord"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
        <input
          type="password"
          placeholder="Mot de passe"
          value={mdp}
          onChange={(e) => setMdp(e.target.value)}
          autoComplete="current-password"
          required
        />
        {erreur && <div className="message erreur">{erreur}</div>}
        <button type="submit" className="bouton primaire" disabled={envoi}>
          {envoi ? "Vérification…" : "Entrer"}
        </button>
      </form>
      <div className="avert" style={{ marginTop: 18 }}>
        {horsLigne ? (
          <>
            Le serveur de bord ne répond pas. Le backoffice lit la base en direct&nbsp;:
            sans serveur il n’a rien à montrer, et il ne prétendra pas le contraire.
          </>
        ) : (
          <>
            La session tient douze heures et vit dans un cookie qu’aucun script de la
            page ne peut lire. Elle est distincte du jeton des bornes de cabine&nbsp;:
            une borne écrit des mesures, elle ne doit pas pouvoir modifier un dossier.
          </>
        )}
      </div>
    </div>
  );
}
