import type { KeyboardEvent } from "react";

export interface Segment<T extends string> {
  cle: T;
  libelle: string;
  /** Un effectif, en chasse fixe après le libellé : « Signaux 101 ». */
  compte?: string;
}

/**
 * Un sélecteur à segments : période, onglet, vue d'un tableau.
 *
 * Deux usages, deux rôles. Des onglets (`onglets`) changent ce qui s'affiche
 * dessous, et se parcourent aux flèches comme des onglets ; un groupe de
 * boutons change la façon de tracer le même contenu, et chaque bouton dit
 * s'il est enfoncé. Le lecteur d'écran annonce l'un ou l'autre, l'écran les
 * dessine pareil.
 */
export function Segments<T extends string>({
  options,
  valeur,
  onChange,
  libelle,
  onglets = false,
  controle,
}: {
  options: Segment<T>[];
  valeur: T;
  onChange: (cle: T) => void;
  libelle: string;
  onglets?: boolean;
  /**
   * L'identifiant du panneau que ces onglets remplissent : chaque onglet le
   * désigne, et le panneau se nomme par l'onglet choisi (`${controle}-${cle}`).
   */
  controle?: string;
}) {
  function auClavier(e: KeyboardEvent<HTMLDivElement>) {
    if (!onglets || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.cle === valeur);
    const j = (i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    onChange(options[j]!.cle);
    (e.currentTarget.children[j] as HTMLElement | undefined)?.focus();
  }

  return (
    <div
      className="seg"
      role={onglets ? "tablist" : "group"}
      aria-label={libelle}
      onKeyDown={auClavier}
    >
      {options.map((o) => {
        const choisi = o.cle === valeur;
        return (
          <button
            key={o.cle}
            type="button"
            role={onglets ? "tab" : undefined}
            id={onglets && controle ? `${controle}-${o.cle}` : undefined}
            aria-controls={onglets ? controle : undefined}
            aria-selected={onglets ? choisi : undefined}
            aria-pressed={onglets ? undefined : choisi}
            tabIndex={onglets && !choisi ? -1 : undefined}
            onClick={() => onChange(o.cle)}
          >
            {o.libelle}
            {o.compte !== undefined && <span className="n">{o.compte}</span>}
          </button>
        );
      })}
    </div>
  );
}
