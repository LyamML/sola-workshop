import type { ParticularityNote } from "../types";

/**
 * Notes de particularité. Les niveaux critiques portent un fond et une icône
 * distincts, et la liste n'est jamais repliable : un médecin qui fait défiler
 * la page doit forcément croiser une allergie sévère.
 */
export function FlagList({ notes }: { notes: ParticularityNote[] }) {
  return (
    <div className="flags">
      {notes.map((note) => (
        <div className={`flag${note.level ? ` ${note.level}` : ""}`} key={note.title}>
          <span className="k" aria-hidden="true">
            {note.icon}
          </span>
          <span className="t">{note.title}</span>
          <span className="d">{note.detail}</span>
          {/* La signature est la raison d'être de la table `medecins` : une
              note de dossier dit qui l'a écrite, ou dit qu'elle ne le sait
              pas. Les deux sont des informations, le silence n'en est pas. */}
          {note.signature && <span className="sig">{note.signature}</span>}
        </div>
      ))}
    </div>
  );
}
