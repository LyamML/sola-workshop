import { useState } from "react";
import { api } from "../api";
import type { Niveau } from "../api";

/**
 * Ajout d'une note de particularité par le médecin de bord.
 *
 * Trois champs, pas quatre : un titre, une description, une priorité. Une note
 * clinique qu'on renonce à écrire parce que le formulaire demande de choisir
 * entre « antécédent » et « contre-indication » est une note perdue — et dans
 * ce dossier, ce sont les notes manquantes qui coûtent cher, pas les notes mal
 * rangées.
 *
 * La note part sans auteur tant que la session médecin n'existe pas. C'est la
 * limite connue de cet écran : le dossier saura ce qui a été écrit, pas par
 * qui.
 */

const PRIORITES: { valeur: Niveau; label: string; classe: string; aide: string }[] = [
  { valeur: "critique", label: "Important", classe: "crit", aide: "à lire avant tout geste" },
  { valeur: "surveillance", label: "Vigilance", classe: "watch", aide: "à garder en tête" },
  { valeur: "info", label: "Info", classe: "info", aide: "contexte du dossier" },
];

export function AjoutNote({
  code,
  onAjout,
  onAnnule,
}: {
  code: string;
  onAjout: () => void;
  onAnnule: () => void;
}) {
  const [titre, setTitre] = useState("");
  const [detail, setDetail] = useState("");
  const [niveau, setNiveau] = useState<Niveau>("surveillance");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    if (!titre.trim() || !detail.trim()) {
      setErreur("Le titre et la description sont obligatoires.");
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await api.ajouterNote(code, { titre: titre.trim(), detail: detail.trim(), niveau });
      onAjout();
    } catch (e) {
      // La saisie reste à l'écran : une note refusée par le serveur ne doit
      // pas obliger à la réécrire.
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="note-form" onSubmit={envoyer}>
      <label className="note-champ">
        <span>Titre</span>
        <input
          id="note-titre"
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          placeholder="Pénicilline — allergie"
          maxLength={90}
          autoFocus
        />
      </label>

      <label className="note-champ">
        <span>Description</span>
        <textarea
          id="note-detail"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Éruption cutanée généralisée. Alternative : macrolides."
          rows={3}
          maxLength={400}
        />
      </label>

      <fieldset className="note-prio">
        <legend>Priorité</legend>
        <div>
          {PRIORITES.map((p) => (
            <button
              key={p.valeur}
              type="button"
              className={`prio ${p.classe}${niveau === p.valeur ? " on" : ""}`}
              aria-pressed={niveau === p.valeur}
              onClick={() => setNiveau(p.valeur)}
              title={p.aide}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="aide">{PRIORITES.find((p) => p.valeur === niveau)?.aide}</span>
      </fieldset>

      {erreur && <div className="note-erreur">{erreur}</div>}

      <div className="note-actions">
        <button type="button" className="btn mini" onClick={onAnnule} disabled={envoi}>
          Annuler
        </button>
        <button type="submit" className="btn mini primary" disabled={envoi}>
          {envoi ? "Enregistrement…" : "Enregistrer la note"}
        </button>
      </div>
    </form>
  );
}
