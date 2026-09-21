import { useId, useState } from "react";

export interface AreaChartProps {
  values: number[];
  min: number;
  max: number;
  ticks: number[];
  /** Ligne de repère : seuil d'attention ou base personnelle du résident. */
  refLine?: number;
  /** Une entrée par point ; `null` masque l'étiquette pour éviter les collisions. */
  labels: (string | null)[];
  /** Libellé complet de chaque point, affiché à la volée au survol. */
  tips: string[];
  color?: string;
  height?: number;
  note?: { index: number; text: string };
  format: (value: number) => string;
  ariaLabel: string;
}

const W = 720;
const L = 42;
const R = 16;
const T = 20;
const B = 32;

/**
 * Aire + ligne, une seule série, une seule échelle.
 * Jamais de second axe : deux mesures d'échelles différentes valent deux
 * graphes côte à côte, pas deux axes superposés.
 */
export function AreaChart({
  values,
  min,
  max,
  ticks,
  refLine,
  labels,
  tips,
  color = "var(--accent)",
  height = 240,
  note,
  format,
  ariaLabel,
}: AreaChartProps) {
  const gradientId = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const plotW = W - L - R;
  const plotH = height - T - B;
  const n = values.length;

  const x = (i: number) => L + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => T + plotH - ((v - min) / (max - min)) * plotH;

  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${T + plotH} L${x(0).toFixed(1)} ${T + plotH} Z`;
  const bandWidth = plotW / (n - 1 || 1);

  return (
    <div className="chart">
      <div
        className={`tip${hover !== null ? " on" : ""}`}
        style={
          hover !== null
            ? { left: `${(x(hover) / W) * 100}%`, top: `${(y(values[hover]) / height) * 100}%` }
            : undefined
        }
      >
        {hover !== null && (
          <>
            <b>{format(values[hover])}</b>
            <span>{tips[hover]}</span>
          </>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} y1={y(t).toFixed(1)} x2={W - R} y2={y(t).toFixed(1)} stroke="var(--line)" strokeWidth="1" />
            <text
              x={L - 9}
              y={(y(t) + 3.6).toFixed(1)}
              textAnchor="end"
              fontFamily="IBM Plex Mono, monospace"
              fontSize="10.5"
              fill="var(--ink-3)"
            >
              {t}
            </text>
          </g>
        ))}

        {refLine != null && (
          <line
            x1={L}
            y1={y(refLine).toFixed(1)}
            x2={W - R}
            y2={y(refLine).toFixed(1)}
            stroke="var(--line-2)"
            strokeWidth="1.5"
            strokeDasharray="5 5"
          />
        )}

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

        {labels.map((label, i) =>
          label ? (
            <text
              key={i}
              x={x(i).toFixed(1)}
              y={height - 10}
              textAnchor="middle"
              fontFamily="IBM Plex Mono, monospace"
              fontSize="10"
              fill="var(--ink-3)"
            >
              {label}
            </text>
          ) : null,
        )}

        {note && (
          <>
            <circle
              cx={x(note.index).toFixed(1)}
              cy={y(values[note.index]).toFixed(1)}
              r="4.6"
              fill={color}
              stroke="var(--card)"
              strokeWidth="2.4"
            />
            <text
              x={(x(note.index) > W * 0.6 ? x(note.index) - 12 : x(note.index) + 12).toFixed(1)}
              y={(y(values[note.index]) - 13).toFixed(1)}
              textAnchor={x(note.index) > W * 0.6 ? "end" : "start"}
              fontFamily="Manrope, sans-serif"
              fontSize="11"
              fill="var(--ink-2)"
            >
              {note.text}
            </text>
          </>
        )}

        {hover !== null && (
          <g>
            <line
              x1={x(hover)}
              y1={T}
              x2={x(hover)}
              y2={T + plotH}
              stroke="var(--ink-3)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hover)}
              cy={y(values[hover])}
              r="4.8"
              fill={color}
              stroke="var(--card)"
              strokeWidth="2.4"
            />
          </g>
        )}

        {values.map((_, i) => (
          <rect
            key={i}
            x={(x(i) - bandWidth / 2).toFixed(1)}
            y={T}
            width={bandWidth.toFixed(1)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
    </div>
  );
}
