/**
 * Le visage de Sola.
 *
 * Trois images en pixels, une par état, empilées au même endroit : au repos,
 * à l'écoute, en train de parler. Elles sont toutes montées et c'est
 * l'opacité qui bascule — changer le `src` relancerait chaque GIF à sa
 * première image, et le passage se verrait comme un saut. Le fondu, lui, ne se
 * voit pas.
 *
 * Elles partagent la même toile et le même ancrage : un seul recadrage les
 * couvre toutes, et la tête ne se déplace pas d'un état à l'autre.
 *
 * Le chat vectoriel d'origine (`SolaCat`, animé en CSS) n'est pas supprimé —
 * on bascule dessus en changeant la constante ci-dessous.
 */

import repos from "../assets/sola-repos.gif";
import ecoute from "../assets/sola-ecoute.png";
import parle from "../assets/sola-parle.gif";
import { SolaCat } from "./SolaCat";

type Incarnation = "pixels" | "vectoriel";

const INCARNATION: Incarnation = "pixels";

export function SolaAvatar() {
  if (INCARNATION === "vectoriel") return <SolaCat />;

  return (
    <div
      className="cat-pixels"
      role="img"
      aria-label="Sola, un compagnon en forme de chat qui écoute et répond"
    >
      <img className="etat repos" src={repos} alt="" draggable={false} />
      <img className="etat ecoute" src={ecoute} alt="" draggable={false} />
      <img className="etat parle" src={parle} alt="" draggable={false} />
    </div>
  );
}
