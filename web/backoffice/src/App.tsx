import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ErreurApi, type Compte, api } from "./api";
import { Base } from "./pages/Base";
import { Comptes } from "./pages/Comptes";
import { Ecrans } from "./pages/Ecrans";

// Dans l'ordre des questions de l'administrateur de bord : ce que la console
// affiche vient-il de la base, la base reçoit-elle ses flux, qui peut l'ouvrir.
// Les gestes cliniques — statut d'un dossier, signal, note — n'ont pas
// d'onglet ici : ils se font dans la console, sous la session du soignant.
const ONGLETS = [
  ["/", "Écrans et sources"],
  ["/base", "Base"],
  ["/comptes", "Comptes"],
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
          <nav className="onglets" aria-label="Onglets du backoffice">
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
              {etat.compte.prenom} {etat.compte.nom} · administrateur
            </span>
            <button type="button" className="bouton mini" onClick={sortir}>
              Quitter
            </button>
          </div>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Ecrans />} />
          <Route path="/base" element={<Base />} />
          <Route path="/comptes" element={<Comptes moi={etat.compte} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

/**
 * Connexion d'un administrateur.
 *
 * Le jeton partagé a disparu : il prouvait qu'on connaissait une clé, jamais
 * qu'on était quelqu'un, et le backoffice ouvre la base entière et les
 * comptes. À sa place, un compte de la table `admins`, un mot de passe haché
 * en argon2id et une session dans un cookie `httpOnly`. Les médecins ne
 * passent pas cette porte : le serveur réserve `/admin` au rôle
 * administrateur.
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
        // ici évite un backoffice ouvert sur trois onglets tous en erreur.
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
    <main className="connexion">
      <h1 className="marque" style={{ fontSize: 19 }}>
        Sola <span>Backoffice</span>
      </h1>
      <p className="sous" style={{ marginTop: 10 }}>
        Outil de l’administrateur de bord&nbsp;: les flux arrivent-ils, et qui a
        accès&nbsp;? Le premier compte se crée au terminal&nbsp;:{" "}
        <code>npm run compte -- admin</code>.
      </p>
      <form onSubmit={envoyer}>
        <input
          type="email"
          placeholder="Adresse de bord"
          aria-label="Adresse de bord"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
        <input
          type="password"
          placeholder="Mot de passe"
          aria-label="Mot de passe"
          value={mdp}
          onChange={(e) => setMdp(e.target.value)}
          autoComplete="current-password"
          required
        />
        {erreur && (
          <div className="message erreur" role="alert">
            {erreur}
          </div>
        )}
        <button type="submit" className="bouton primaire" disabled={envoi}>
          {envoi ? "Vérification…" : "Se connecter"}
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
            une borne écrit des mesures, elle ne doit pas pouvoir ouvrir la base ni
            les comptes.
          </>
        )}
      </div>
    </main>
  );
}
