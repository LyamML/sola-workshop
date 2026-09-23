import { useLayoutEffect, useRef, useState } from "react";
import { fr, jv } from "../format";
import type { Courbe as ConfigCourbe } from "../types";

/**
 * Une série datée, ses seuils et sa base personnelle.
 *
 * Le dessin se refait à la largeur de sa carte plutôt que de s'étirer : un
 * SVG mis à l'échelle rapetisse ses graduations avec lui, et sur un écran
 * étroit les chiffres deviennent illisibles avant la courbe.
 */
const H = 220;
const DROITE = 10;
const HAUT = 14;
const BAS = 24;

interface Boite {
  xa: number;
  xb: number;
  ya: number;
  yb: number;
}

interface Place extends Boite {
  ancre: "start" | "middle" | "end";
  x: number;
  y: number;
}

/** Des graduations de 1, 2 ou 5 fois une puissance de dix. */
function echelle(lo: number, hi: number, n: number) {
  const brut = (hi - lo) / n || 1;
  const ordre = 10 ** Math.floor(Math.log10(brut));
  const norme = brut / ordre;
  const pas = (norme < 1.5 ? 1 : norme < 3 ? 2 : norme < 7 ? 5 : 10) * ordre;
  const a = Math.floor(lo / pas + 1e-9) * pas;
  const b = Math.ceil(hi / pas - 1e-9) * pas;
  const graduations: number[] = [];
  for (let v = a; v <= b + pas / 2; v += pas) graduations.push(Math.round(v / pas) * pas);
  return { a, b, pas, graduations };
}

/** L'ordonnée de la courbe à une abscisse donnée, par interpolation. */
function yA(px: number[], py: number[], x: number) {
  for (let i = 1; i < px.length; i++) {
    if (x <= px[i]!) {
      const t = (x - px[i - 1]!) / (px[i]! - px[i - 1]! || 1);
      return py[i - 1]! + t * (py[i]! - py[i - 1]!);
    }
  }
  return py[py.length - 1]!;
}

/** Ce que la courbe occupe en hauteur entre deux abscisses. */
function etendue(px: number[], py: number[], xa: number, xb: number): [number, number] {
  const a = Math.max(xa, px[0]!);
  const b = Math.min(xb, px[px.length - 1]!);
  if (a > b) return [Infinity, -Infinity];
  const ya = yA(px, py, a);
  const yb = yA(px, py, b);
  let lo = Math.min(ya, yb);
  let hi = Math.max(ya, yb);
  px.forEach((x, i) => {
    if (x >= a && x <= b) {
      lo = Math.min(lo, py[i]!);
      hi = Math.max(hi, py[i]!);
    }
  });
  return [lo, hi];
}

/**
 * Pose le libellé d'un seuil là où la courbe ne passe pas : au-dessus ou
 * au-dessous du trait, à droite, à gauche ou au milieu. Un libellé barré par
 * la série qu'il commente ne se lit plus.
 */
function placer(
  texte: string,
  y0: number,
  px: number[],
  py: number[],
  boites: Boite[],
  g: { xl: number; xr: number; yt: number; yb: number },
): Place {
  const w = texte.length * 6.3;
  const milieu = (g.xl + g.xr) / 2;
  const candidats: { ancre: Place["ancre"]; x: number; y: number }[] = [];
  for (const y of [y0 - 5, y0 + 13]) {
    candidats.push({ ancre: "end", x: g.xr - 2, y }, { ancre: "start", x: g.xl + 6, y }, { ancre: "middle", x: milieu, y });
  }

  let meilleur: Place | null = null;
  let score = Infinity;
  for (let k = 0; k < candidats.length; k++) {
    const c = candidats[k]!;
    const xa = c.ancre === "end" ? c.x - w : c.ancre === "middle" ? c.x - w / 2 : c.x;
    const xb = xa + w;
    const ya = c.y - 10;
    const yb = c.y + 3;
    if (ya < g.yt - 8 || yb > g.yb + 2) continue;
    const [lo, hi] = etendue(px, py, xa - 4, xb + 4);
    const croise = Math.max(0, Math.min(hi, yb + 3) - Math.max(lo, ya - 3));
    const touche = hi >= ya - 3 && lo <= yb + 3 ? 20 + croise : 0;
    const heurte = boites.some((o) => xa < o.xb && xb > o.xa && ya < o.yb && yb > o.ya) ? 1000 : 0;
    const s = touche + heurte + k * 0.01;
    if (s < score) {
      score = s;
      meilleur = { ...c, xa, xb, ya, yb };
    }
  }

  const c = candidats[0]!;
  const choisi = meilleur ?? { ...c, xa: c.x - w, xb: c.x, ya: c.y - 10, yb: c.y + 3 };
  boites.push(choisi);
  return choisi;
}

function useLargeur(depart: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(depart);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mesurer = () => setLargeur(Math.round(el.clientWidth) || depart);
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(el);
    return () => observateur.disconnect();
  }, [depart]);
  return [ref, largeur] as const;
}

export function Courbe({ courbe }: { courbe: ConfigCourbe }) {
  const [ref, W] = useLargeur(courbe.largeur);
  // Le jour visé, et non son rang : la fiche se relit à chaque minute du
  // bracelet, et la série refaite ne doit pas faire sauter la bulle d'un jour.
  const [vise, setVise] = useState<number | null>(null);
  const pts = courbe.points;
  const classe = `ch${courbe.alerte ? " alerte" : ""}`;

  if (!pts.length) {
    return (
      <div className={classe} ref={ref}>
        <p className="vide">Aucune mesure sur la période.</p>
      </div>
    );
  }

  const L = courbe.marge ?? 34;
  const pw = W - L - DROITE;
  const ph = H - HAUT - BAS;
  const xs = pts.map((p) => p.x);
  const [x0, x1] = courbe.domaineX ?? [Math.min(...xs), Math.max(...xs)];

  const reperes = [
    ...courbe.seuils.map((s) => ({ ...s, classe: "ch-thr" })),
    ...(courbe.base ? [{ ...courbe.base, classe: "ch-base" }] : []),
  ];
  const valeurs = [...pts.map((p) => p.y), ...reperes.map((r) => r.valeur)];
  const lo = Math.min(...valeurs);
  const hi = Math.max(...valeurs);
  const marge = (hi - lo) * 0.08 || 1;
  const sc = echelle(lo - marge, hi + marge, 4);

  const X = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * pw;
  const Y = (v: number) => HAUT + ((sc.b - v) / (sc.b - sc.a)) * ph;
  const formatY = courbe.formatY ?? ((v: number) => fr(v, sc.pas < 1 ? 1 : 0));

  const px = pts.map((p) => X(p.x));
  const py = pts.map((p) => Y(p.y));
  const trace = px.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${py[i]!.toFixed(1)}`).join(" ");
  const fond = `${trace} L${px[px.length - 1]!.toFixed(1)} ${HAUT + ph} L${px[0]!.toFixed(1)} ${HAUT + ph} Z`;

  const g = { xl: L, xr: W - DROITE, yt: HAUT, yb: HAUT + ph };
  const boites: Boite[] = [];
  const lignes = reperes.map((r) => {
    const y = Y(r.valeur);
    return { ...r, y, place: placer(r.libelle, y, px, py, boites, g) };
  });

  // Une graduation sur deux quand les dates se toucheraient.
  let gradX = courbe.graduationsX.filter((v) => v >= x0 && v <= x1);
  const place = Math.max(0, ...gradX.map((v) => jv(v).length * 6.4)) + 12;
  while (gradX.length > 2 && pw / (gradX.length - 1) < place) {
    const n = gradX.length;
    gradX = gradX.filter((_, i) => (n - 1 - i) % 2 === 0);
  }

  const dernier = pts[pts.length - 1]!;
  const titre = `${courbe.nom}, du ${jv(x0)} au ${jv(x1)}`;

  // Sans jour visé, la lecture part du dernier : c'est lui qu'on vient voir,
  // les précédents se remontent un à un.
  const rang = vise === null ? -1 : pts.findIndex((p) => p.x === vise);
  const lu = pts[rang < 0 ? pts.length - 1 : rang]!;

  function viser(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) * W) / (r.width || W);
    let j = 0;
    for (let k = 1; k < px.length; k++) if (Math.abs(px[k]! - x) < Math.abs(px[j]! - x)) j = k;
    setVise(pts[j]!.x);
  }

  function parcourir(e: React.KeyboardEvent<SVGSVGElement>) {
    if (e.key === "Escape") {
      setVise(null);
      return;
    }
    const n = pts.length;
    const cible: Record<string, number> = {
      ArrowLeft: rang < 0 ? n - 1 : Math.max(0, rang - 1),
      ArrowRight: rang < 0 ? n - 1 : Math.min(n - 1, rang + 1),
      Home: 0,
      End: n - 1,
    };
    const j: number | undefined = cible[e.key];
    if (j === undefined) return;
    e.preventDefault();
    setVise(pts[j]!.x);
  }

  return (
    <>
      <div className={classe} ref={ref}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          // Un curseur plutôt qu'une image : les flèches parcourent les jours,
          // et un lecteur d'écran annonce le jour et la valeur de chacun.
          role="slider"
          tabIndex={0}
          aria-label={titre}
          aria-valuemin={pts[0]!.x}
          aria-valuemax={dernier.x}
          aria-valuenow={lu.x}
          aria-valuetext={`${jv(lu.x)} : ${courbe.bulle(lu.y)}`}
          onPointerMove={viser}
          onPointerDown={viser}
          onPointerLeave={() => setVise(null)}
          onPointerCancel={() => setVise(null)}
          onKeyDown={parcourir}
          // Au clavier seulement : un clic ou un doigt ont déjà visé leur jour,
          // et le focus qui les suit ne doit pas le remplacer par le dernier.
          onFocus={(e) => {
            if (e.currentTarget.matches(":focus-visible")) setVise((v) => v ?? dernier.x);
          }}
          onBlur={() => setVise(null)}
        >
          {sc.graduations.map((v) => (
            <g key={`y${v}`}>
              <line className="ch-grid" x1={L} x2={W - DROITE} y1={Y(v)} y2={Y(v)} />
              <text className="ch-tick" x={L - 7} y={Y(v)} dy=".32em" textAnchor="end">
                {formatY(v)}
              </text>
            </g>
          ))}
          {gradX.map((v) => {
            const x = X(v);
            const texte = jv(v);
            const demi = texte.length * 3.2;
            const ancre = x + demi > W ? "end" : x - demi < 0 ? "start" : "middle";
            return (
              <text
                key={`x${v}`}
                className="ch-tick"
                x={ancre === "end" ? W : ancre === "start" ? 0 : x}
                y={H - 5}
                textAnchor={ancre}
              >
                {texte}
              </text>
            );
          })}
          <path className="ch-area" d={fond} />
          {lignes.map((r) => (
            <g key={`${r.classe}${r.valeur}`}>
              <line className={r.classe} x1={L} x2={W - DROITE} y1={r.y} y2={r.y} />
              <text className={`${r.classe}-l`} x={r.place.x} y={r.place.y} textAnchor={r.place.ancre}>
                {r.libelle}
              </text>
            </g>
          ))}
          <path className="ch-line" d={trace} />
          <circle className="ch-dot" cx={px[px.length - 1]} cy={py[py.length - 1]} r={4.5} />
          {rang >= 0 && (
            <g>
              <line className="ch-guide" x1={px[rang]} x2={px[rang]} y1={HAUT} y2={HAUT + ph} />
              <circle className="ch-halo" cx={px[rang]} cy={py[rang]} r={11} />
              <circle className="ch-dot" cx={px[rang]} cy={py[rang]} r={5.5} />
            </g>
          )}
        </svg>
        {rang >= 0 && (
          <div
            className="ch-bulle"
            aria-hidden="true"
            // Ancrée en proportion de sa place : au bord gauche la bulle part
            // vers la droite, au bord droit vers la gauche. Elle ne sort jamais
            // de la carte, sans qu'on ait à la mesurer.
            style={{
              left: px[rang],
              top: py[rang],
              transform: `translate(${(-100 * px[rang]!) / W}%, ${py[rang]! < 64 ? "14px" : "calc(-100% - 14px)"})`,
            }}
          >
            <span>{jv(pts[rang]!.x)}</span>
            <b>{courbe.bulle(pts[rang]!.y)}</b>
          </div>
        )}
      </div>
      <div className="legend">
        <span>
          <i />
          {courbe.nom}
        </span>
        {courbe.seuils.length > 0 && (
          <span>
            <i className="th" />
            {courbe.legendeSeuil ?? courbe.seuils[0]!.libelle}
          </span>
        )}
        {courbe.base && (
          <span>
            <i className="bs" />
            {courbe.base.libelle}
          </span>
        )}
      </div>
    </>
  );
}
