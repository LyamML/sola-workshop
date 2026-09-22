import type { ReactNode } from "react";
import type { Severite, Statut } from "../api";

/** Cadre standard : un titre, une aide facultative, un corps. */
export function Cadre({
  titre,
  aide,
  actions,
  children,
  sansPadding,
}: {
  titre: string;
  aide?: string;
  actions?: ReactNode;
  children: ReactNode;
  sansPadding?: boolean;
}) {
  return (
    <section className="cadre">
      <header>
        <h2>{titre}</h2>
        {aide && <span className="aide">{aide}</span>}
        {actions && <div style={{ marginLeft: "auto" }}>{actions}</div>}
      </header>
      {sansPadding ? children : <div className="corps">{children}</div>}
    </section>
  );
}

export function Tuile({
  etiquette,
  valeur,
  unite,
  note,
}: {
  etiquette: string;
  valeur: ReactNode;
  unite?: string;
  note?: string;
}) {
  return (
    <div className="tuile">
      <div className="etiquette">{etiquette}</div>
      <div className="valeur">
        {valeur}
        {unite && <small>{unite}</small>}
      </div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

const LIBELLES: Record<string, string> = {
  ok: "Aucun signal",
  surveillance: "Surveillance",
  critique: "Critique",
  info: "Contexte",
  ouvert: "Ouvert",
  en_cours: "En cours",
  clos: "Clos",
};

export function Puce({ niveau, texte }: { niveau: Severite | Statut | string; texte?: string }) {
  const classe = ["ok", "surveillance", "critique", "info"].includes(niveau)
    ? niveau
    : "neutre";
  return <span className={`puce ${classe}`}>{texte ?? LIBELLES[niveau] ?? niveau}</span>;
}

/** Les trois etats d'un chargement, au meme endroit dans chaque page. */
export function Etat({
  charge,
  erreur,
  vide,
  children,
}: {
  charge: boolean;
  erreur: string | null;
  vide?: boolean;
  children: ReactNode;
}) {
  if (erreur) return <div className="message erreur">{erreur}</div>;
  if (!charge) return <div className="vide">Chargement…</div>;
  if (vide) return <div className="vide">Rien à afficher.</div>;
  return <>{children}</>;
}

// ------------------------------------------------------------- formatage --
/** 1240 -> « 1 240 ». Espace insécable fine, comme sur la console. */
export function nombre(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("fr-FR");
}

/** 412 minutes -> « 6 h 52 ». */
export function duree(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** « 2026-09-22 14:31:00 » -> « 22/09 14:31 ». */
export function horodatage(v: string | null | undefined): string {
  if (!v) return "—";
  const [date, heure = ""] = v.split(/[ T]/);
  const [, mois, jour] = (date ?? "").split("-");
  if (!mois || !jour) return v;
  return `${jour}/${mois}${heure ? ` ${heure.slice(0, 5)}` : ""}`;
}
