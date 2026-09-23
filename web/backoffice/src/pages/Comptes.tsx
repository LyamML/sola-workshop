import { useState } from "react";
import { type Compte, api } from "../api";
import { Cadre, Etat, horodatage, nombre, pluriel } from "../components/Base";
import { useChargement } from "../hooks";

type Role = "medecin" | "admin";

// Un refus de principe n'est ni une réussite ni une panne : il a son ton.
type Ton = "succes" | "erreur" | "neutre";

const SOI_MEME =
  "Votre propre compte ne se désactive pas d’ici\u00a0: un autre administrateur peut le faire.";

/**
 * Les comptes de bord : qui a accès, et qui ne s'est jamais connecté.
 *
 * On active et on désactive, on ne supprime pas : une note signée par un
 * soignant parti perdrait son auteur, et une note sans auteur est exactement
 * le problème que ces tables sont venues régler. La création passe par
 * `npm run compte`, au terminal — donc physiquement à bord.
 *
 * Ni empreinte ni adresse n'arrivent jusqu'ici : le serveur choisit ses
 * colonnes, et le matricule suffit à reconnaître un compte.
 */
export function Comptes({ moi }: { moi: Compte }) {
  const { donnees, erreur, charge, relancer } = useChargement(() => api.comptes(), []);
  const [message, setMessage] = useState<{ texte: string; ton: Ton } | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  async function basculer(role: Role, id: number, actif: boolean, qui: string) {
    setMessage(null);
    setEnCours(`${role}-${id}`);
    try {
      await api.activerCompte(role, id, actif);
      setMessage({
        texte: actif
          ? `${qui}\u00a0: compte réactivé.`
          : `${qui}\u00a0: compte désactivé, ses sessions ouvertes sont fermées.`,
        ton: "succes",
      });
      relancer();
    } catch (e) {
      setMessage({ texte: e instanceof Error ? e.message : "Échec de l’écriture.", ton: "erreur" });
    } finally {
      setEnCours(null);
    }
  }

  const soignants = donnees?.soignants ?? [];
  const administrateurs = donnees?.administrateurs ?? [];

  return (
    <div className="page">
      <h1 className="titre">Comptes</h1>
      <p className="sous">
        Qui a accès, et qui ne s’est jamais connecté. Un compte se désactive sans
        être supprimé.
      </p>

      {/* Toujours dans la page, vide ou non : un lecteur d'écran n'annonce que
          ce qui change dans une zone qu'il connaît déjà. */}
      <div role="status" className="annonce">
        {message && (
          <div className={`message ${message.ton}`}>{message.texte}</div>
        )}
      </div>

      {/* Les données déjà lues restent affichées pendant la relecture qui suit
          un basculement : un tableau qui disparaît une demi-seconde fait
          perdre sa ligne à celui qui vient de cliquer. */}
      <Etat charge={charge || donnees !== null} erreur={erreur}>
        <div className="grille">
          <Cadre titre="Soignants" aide={`${pluriel(soignants.length, "compte")} · console`} sansPadding>
            <div className="defile">
              <table className="comptes">
                <thead>
                  <tr>
                    <th scope="col">Matricule</th>
                    <th scope="col">Nom</th>
                    <th scope="col">Poste</th>
                    <th scope="col" className="num">
                      Signaux ouverts
                    </th>
                    <th scope="col" className="num">
                      Notes signées
                    </th>
                    <th scope="col" className="num">
                      Dernière connexion
                    </th>
                    <th scope="col">Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {soignants.map((s) => {
                    const qui = `${s.titre} ${s.prenom} ${s.nom}`;
                    return (
                      <tr key={s.id} className={s.actif ? undefined : "inactif"}>
                        <td className="code">{s.code}</td>
                        <th scope="row">{qui}</th>
                        <td>{s.poste}</td>
                        <td className="num">{nombre(s.signaux_ouverts)}</td>
                        <td className="num">{nombre(s.notes_signees)}</td>
                        <td className="num">
                          <DerniereConnexion le={s.derniere_connexion} />
                        </td>
                        <td>
                          <Interrupteur
                            qui={qui}
                            actif={s.actif === 1}
                            occupe={enCours === `medecin-${s.id}`}
                            onBascule={() => basculer("medecin", s.id, s.actif !== 1, qui)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Cadre>

          <Cadre
            titre="Administrateurs"
            aide={`${pluriel(administrateurs.length, "compte")} · backoffice`}
            sansPadding
          >
            <div className="defile">
              <table className="comptes">
                <thead>
                  <tr>
                    <th scope="col">Nom</th>
                    <th scope="col" className="num">
                      Dernière connexion
                    </th>
                    <th scope="col">Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {administrateurs.map((a) => {
                    const qui = `${a.prenom} ${a.nom}`;
                    const soi = moi.role === "admin" && moi.id === a.id;
                    return (
                      <tr key={a.id} className={a.actif ? undefined : "inactif"}>
                        <th scope="row">
                          {qui}
                          {soi && <span className="vous">vous</span>}
                        </th>
                        <td className="num">
                          <DerniereConnexion le={a.derniere_connexion} />
                        </td>
                        <td>
                          <Interrupteur
                            qui={qui}
                            actif={a.actif === 1}
                            occupe={enCours === `admin-${a.id}`}
                            verrouille={soi}
                            onBascule={() =>
                              soi
                                ? setMessage({ texte: SOI_MEME, ton: "neutre" })
                                : basculer("admin", a.id, a.actif !== 1, qui)
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Cadre>
        </div>
      </Etat>

      <div className="avert" style={{ marginTop: 18 }}>
        Créer un compte ou changer un mot de passe se fait au terminal, sur le
        serveur de bord&nbsp;: <code>npm run compte -- medecin</code>,{" "}
        <code>npm run compte -- admin</code>, <code>npm run compte -- mdp &lt;email&gt;</code>.
        Les mots de passe sont hachés en argon2id, et changer un mot de passe ferme
        les sessions du compte.
      </div>
    </div>
  );
}

/** « jamais » se lit à part : c'est souvent un compte créé pour rien, ou oublié. */
function DerniereConnexion({ le }: { le: string | null }) {
  return le ? <>{horodatage(le)}</> : <span className="muet">jamais</span>;
}

/**
 * Un interrupteur plutôt qu'un bouton « Désactiver » : l'état se lit sans
 * cliquer, et le même geste le remet.
 *
 * Jamais `disabled`, ni pendant l'écriture ni pour son propre compte : un
 * bouton qui se désactive sous le focus le perd, et le clavier repart du haut
 * de la page. `aria-disabled` le garde atteignable, et un clic sur son propre
 * compte dit pourquoi rien ne se passe au lieu de ne rien dire.
 */
function Interrupteur({
  qui,
  actif,
  occupe,
  verrouille = false,
  onBascule,
}: {
  qui: string;
  actif: boolean;
  occupe: boolean;
  verrouille?: boolean;
  onBascule: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="interrupteur"
      aria-checked={actif}
      aria-label={`Compte actif : ${qui}`}
      aria-disabled={verrouille || undefined}
      aria-busy={occupe || undefined}
      onClick={() => {
        if (!occupe) onBascule();
      }}
    />
  );
}
