import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ErreurApi, type Compte, api } from "./api";
import { Logo } from "./components/Icone";

/**
 * Qui est devant la console.
 *
 * Trois états, et le troisième est celui qui demande une explication :
 *
 *   · `dehors`  — personne n'est connecté, on affiche le formulaire ;
 *   · `dedans`  — un médecin ou un administrateur, on affiche les écrans ;
 *   · `demo`    — le serveur ne répond pas.
 *
 * Le mode démonstration n'est pas une porte dérobée : il n'existe que si le
 * serveur est injoignable, et dans ce cas il n'y a rien à protéger — les
 * écrans montrent le jeu de démonstration compilé dans la page, pas un
 * dossier. C'est la règle de la maison : une console médicale qui affiche une
 * page blanche parce qu'un service est tombé est pire qu'inutile. L'en-tête
 * dit lequel des deux est affiché, comme partout ailleurs.
 */
type Etat =
  | { phase: "chargement" }
  | { phase: "dehors"; horsLigne: boolean }
  | { phase: "dedans"; compte: Compte }
  | { phase: "demo" };

const Contexte = createContext<{ compte: Compte | null; deconnecter: () => void }>({
  compte: null,
  deconnecter: () => {},
});

export const useCompte = () => useContext(Contexte);

export function Session({ enfants }: { enfants: ReactNode }) {
  const [etat, setEtat] = useState<Etat>({ phase: "chargement" });

  const verifier = useCallback(() => {
    api
      .moi()
      .then((r) => setEtat({ phase: "dedans", compte: r.compte }))
      .catch((e: unknown) => {
        // Un 401 est une réponse, pas une panne : le serveur répond « personne ».
        // Tout le reste — abandon du délai, serveur éteint — est une panne, et
        // c'est elle seule qui ouvre le mode démonstration.
        setEtat({ phase: "dehors", horsLigne: !(e instanceof ErreurApi) });
      });
  }, []);

  useEffect(verifier, [verifier]);

  const deconnecter = useCallback(() => {
    api
      .deconnexion()
      .catch(() => {
        /* le cookie expire de toute façon ; on rend la main sans bloquer */
      })
      .finally(() => setEtat({ phase: "dehors", horsLigne: false }));
  }, []);

  if (etat.phase === "chargement") return <div className="chargement">Sola</div>;

  if (etat.phase === "dehors") {
    return (
      <Connexion
        horsLigne={etat.horsLigne}
        onEntre={(compte) => setEtat({ phase: "dedans", compte })}
        onDemo={() => setEtat({ phase: "demo" })}
      />
    );
  }

  return (
    <Contexte.Provider
      value={{ compte: etat.phase === "dedans" ? etat.compte : null, deconnecter }}
    >
      {enfants}
    </Contexte.Provider>
  );
}

function Connexion({
  horsLigne,
  onEntre,
  onDemo,
}: {
  horsLigne: boolean;
  onEntre: (compte: Compte) => void;
  onDemo: () => void;
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
      onEntre(compte);
    } catch (e) {
      // Le mot de passe est vidé, l'adresse reste : on se trompe de mot de
      // passe, rarement d'adresse.
      setMdp("");
      setErreur(
        e instanceof ErreurApi ? e.message : "Le serveur de bord ne répond pas.",
      );
      setEnvoi(false);
    }
  }

  return (
    <div className="connexion">
      <div className="logo">
        <Logo />
        SOLA
      </div>

      <h1>Console médicale</h1>
      <p className="sous">
        Projet Odyssée · J+4 128. Réservée aux soignants de bord : la fiche d'un résident
        n'est pas une page publique, et une note de dossier porte le nom de celui
        qui l'écrit.
      </p>

      <form onSubmit={envoyer}>
        <label>
          <span>Adresse de bord</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label>
          <span>Mot de passe</span>
          <input
            type="password"
            value={mdp}
            onChange={(e) => setMdp(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {erreur && <div className="message erreur">{erreur}</div>}

        <button type="submit" className="btn pri" disabled={envoi}>
          {envoi ? "Vérification…" : "Ouvrir la console"}
        </button>
      </form>

      {horsLigne && (
        <div className="hors-ligne">
          <p>
            <b>Le serveur de bord ne répond pas.</b> Impossible de vérifier un compte
            tant qu'il est injoignable. Les écrans restent consultables avec le jeu
            de démonstration&nbsp;: aucun dossier réel n'y figure, et chaque écran
            le signale.
          </p>
          <button type="button" className="btn mini" onClick={onDemo}>
            Entrer en démonstration
          </button>
        </div>
      )}
    </div>
  );
}
