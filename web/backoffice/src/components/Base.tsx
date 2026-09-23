import type { ReactNode } from "react";

/** Cadre standard : un titre, une aide facultative, un corps. */
export function Cadre({
  titre,
  aide,
  actions,
  children,
  sansPadding,
}: {
  titre: string;
  aide?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  sansPadding?: boolean;
}) {
  return (
    <section className="cadre">
      <header>
        <h2>{titre}</h2>
        {aide && <span className="aide">{aide}</span>}
        {actions && <div className="actions">{actions}</div>}
      </header>
      {sansPadding ? children : <div className="corps">{children}</div>}
    </section>
  );
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
/**
 * 1240 -> « 1 240 ». `toLocaleString` separe les milliers par une espace fine
 * (U+202F) que les polices de bord ne dessinent pas : on la remplace par une
 * insecable ordinaire, comme la console et le serveur.
 */
export function nombre(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0");
}

/** « 1 table », « 17 tables ». Zero prend le singulier, comme en francais. */
export function pluriel(n: number, singulier: string, forme = `${singulier}s`): string {
  return `${nombre(n)} ${n >= 2 ? forme : singulier}`;
}

/** « 2026-09-22 14:31:00 » -> « 22/09 14:31 ». */
export function horodatage(v: string | null | undefined): string {
  if (!v) return "—";
  const [date, heure = ""] = v.split(/[ T]/);
  const [, mois, jour] = (date ?? "").split("-");
  if (!mois || !jour) return v;
  return `${jour}/${mois}${heure ? ` ${heure.slice(0, 5)}` : ""}`;
}
