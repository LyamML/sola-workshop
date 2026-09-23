import { useState } from "react";
import { api } from "../api";
import { Cadre, Etat, Puce, horodatage, nombre } from "../components/Base";
import { useChargement } from "../hooks";

/**
 * Les comptes de bord.
 *
 * On active et on désactive, on ne supprime pas : une note signée par un
 * soignant parti perdrait son auteur, et une note sans auteur est exactement
 * le problème que ces tables sont venues régler. La création passe par
 * `npm run compte`, au terminal — donc physiquement à bord.
 *
 * Aucune empreinte de mot de passe n'arrive jusqu'ici : le serveur choisit ses
 * colonnes et ne sert jamais `mdp_hash`.
 */
export function Comptes() {
  const [message, setMessage] = useState<string | null>(null);
  const { donnees, erreur, charge, relancer } = useChargement(() => api.comptes(), []);

  async function basculer(role: "medecin" | "admin", id: number, actif: boolean) {
    setMessage(null);
    try {
      await api.activerCompte(role, id, actif);
      relancer();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Échec");
    }
  }

  const lignes = donnees?.lignes ?? [];

  return (
    <div className="page">
      <h1 className="titre">Comptes</h1>
      <p className="sous">
        Qui peut ouvrir la console médicale, et qui peut ouvrir cet outil. Un
        médecin voit les dossiers&nbsp;; un administrateur voit en plus les tables
        et cette page. La borne de cabine, elle, reste accessible à tous&nbsp;:
        c'est une porte de couloir, pas un dossier.
      </p>

      {message && (
        <div className="message erreur" style={{ marginBottom: 16 }}>
          {message}
        </div>
      )}

      <Cadre
        titre={`${nombre(lignes.length)} comptes`}
        aide={`${nombre(donnees?.sessions_ouvertes ?? 0)} sessions ouvertes`}
        sansPadding
      >
        <Etat charge={charge} erreur={erreur} vide={lignes.length === 0}>
          <div className="defile">
            <table>
              <thead>
                <tr>
                  <th>Rôle</th>
                  <th>Matricule</th>
                  <th>Nom</th>
                  <th>Adresse de bord</th>
                  <th className="num">Notes signées</th>
                  <th className="num">Signaux ouverts</th>
                  <th className="num">Dernière connexion</th>
                  <th>État</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lignes.map((c) => (
                  <tr key={`${c.role}-${c.id}`} style={{ opacity: c.actif ? 1 : 0.55 }}>
                    <td>
                      <span className="puce neutre">
                        {c.role === "admin" ? "Administration" : "Soignant"}
                      </span>
                    </td>
                    <td className="code">{c.code ?? "—"}</td>
                    <td>
                      {c.titre ? `${c.titre} ` : ""}
                      {c.prenom} {c.nom}
                      <div style={{ color: "var(--ink-3)", fontSize: 12 }}>{c.poste}</div>
                    </td>
                    <td className="code">{c.email}</td>
                    <td className="num">{c.role === "medecin" ? nombre(c.notes_signees) : "—"}</td>
                    <td className="num">
                      {c.role === "medecin" ? nombre(c.signaux_ouverts) : "—"}
                    </td>
                    <td className="num">
                      {c.derniere_connexion ? horodatage(c.derniere_connexion) : "jamais"}
                    </td>
                    <td>
                      <Puce
                        niveau={c.actif ? "ok" : "info"}
                        texte={c.actif ? "actif" : "désactivé"}
                      />
                    </td>
                    <td>
                      <button
                        className="bouton mini"
                        onClick={() => basculer(c.role, c.id, !c.actif)}
                      >
                        {c.actif ? "Désactiver" : "Réactiver"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Etat>
      </Cadre>

      <div className="avert" style={{ marginTop: 18 }}>
        Créer un compte ou changer un mot de passe se fait au terminal, sur le
        serveur de bord&nbsp;: <code>npm run compte -- medecin</code>,{" "}
        <code>npm run compte -- admin</code>, <code>npm run compte -- mdp &lt;email&gt;</code>.
        Les mots de passe sont hachés en argon2id&nbsp;; la base ne contient
        aucune empreinte réversible, et changer un mot de passe ferme les
        sessions du compte.
      </div>
    </div>
  );
}
