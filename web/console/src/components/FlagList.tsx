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
        </div>
      ))}
    </div>
  );
}
