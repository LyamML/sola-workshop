interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  tone?: "watch";
  /**
   * Courbe de fond : étirée sur toute la largeur disponible, le texte passe
   * par-dessus. Le tracé est alors posé en CSS, pas dimensionné ici.
   */
  fond?: boolean;
}

/** Courbe miniature, point final mis en évidence. Décorative : jamais seule
 *  porteuse d'une information, la valeur chiffrée est toujours à côté. */
export function Sparkline({ values, width = 78, height = 30, tone, fond = false }: SparklineProps) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  // En fond, la courbe touche les bords de sa boîte : c'est la boîte qui est
  // en retrait du bord de la carte, pas le tracé.
  const pad = fond ? 0 : 3;
  const color = tone === "watch" ? "var(--watch)" : "var(--accent)";

  const points = values.map((v, i) => {
    const x = pad + (i * (width - pad * 2)) / (values.length - 1);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = points[points.length - 1];

  if (fond) {
    // `preserveAspectRatio="none"` étire le dessin pour remplir la largeur, et
    // déforme donc tout ce qu'on trace : l'épaisseur du trait est figée en
    // pixels, et le point final disparaît — un cercle étiré devient un ovale.
    return (
      <svg
        className="spark-fond"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={color} opacity="0.09" />
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          opacity="0.55"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
      style={{ maxWidth: "100%" }}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="2.8" fill={color} />
    </svg>
  );
}
