/**
 * Sola — le compagnon.
 *
 * Toute l'animation (respiration, clignement, queue, oreilles, bouche) est
 * portée par le CSS et pilotée par la classe d'état de la borne, pour que le
 * personnage reste une seule image cohérente plutôt qu'une pile d'effets.
 */
export function SolaCat() {
  return (
    <svg
      className="cat"
      viewBox="0 0 200 200"
      role="img"
      aria-label="Sola, un compagnon en forme de chat qui respire, cligne des yeux et remue la queue"
    >
      <defs>
        <radialGradient id="fur" cx="38%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#FBEEDC" />
          <stop offset="60%" stopColor="#F0DCBE" />
          <stop offset="100%" stopColor="#D9BE97" />
        </radialGradient>
      </defs>

      <path
        className="tail"
        d="M138 150c22 4 30-12 24-26-4-10-16-11-20-3"
        fill="none"
        stroke="#E4CDA8"
        strokeWidth="11"
        strokeLinecap="round"
      />

      <ellipse cx="100" cy="152" rx="46" ry="33" fill="#EADBBE" />
      <ellipse cx="80" cy="176" rx="14" ry="8" fill="#F6E8D1" />
      <ellipse cx="120" cy="176" rx="14" ry="8" fill="#F6E8D1" />

      <g className="ear-l">
        <path d="M58 76 L62 40 L90 58 Z" fill="#EBD6B4" />
        <path d="M64 70 L66 51 L82 61 Z" fill="#F0ADA6" />
      </g>
      <g className="ear-r">
        <path d="M142 76 L138 40 L110 58 Z" fill="#EBD6B4" />
        <path d="M136 70 L134 51 L118 61 Z" fill="#F0ADA6" />
      </g>

      <ellipse cx="100" cy="96" rx="52" ry="46" fill="url(#fur)" />

      <path
        d="M84 56c3 6 4 10 3 15M100 52c2 7 2 11 1 16M116 56c-3 6-4 10-3 15"
        stroke="#DFC49E"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />

      <g className="eyes">
        <ellipse cx="80" cy="96" rx="9" ry="11" fill="#22302E" />
        <ellipse cx="120" cy="96" rx="9" ry="11" fill="#22302E" />
        <circle cx="83.5" cy="91.5" r="3.3" fill="#FFFFFF" />
        <circle cx="123.5" cy="91.5" r="3.3" fill="#FFFFFF" />
        <circle cx="77.5" cy="100" r="1.6" fill="#FFFFFF" opacity="0.65" />
        <circle cx="117.5" cy="100" r="1.6" fill="#FFFFFF" opacity="0.65" />
      </g>

      <ellipse cx="64" cy="112" rx="10" ry="6" fill="#F0ADA6" opacity="0.5" />
      <ellipse cx="136" cy="112" rx="10" ry="6" fill="#F0ADA6" opacity="0.5" />

      <path d="M96 110h8l-4 5z" fill="#E08A85" />
      <path
        className="mouth-shut"
        d="M100 115c-2.5 4-8 4-10.5 1M100 115c2.5 4 8 4 10.5 1"
        stroke="#22302E"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse className="mouth-open" cx="100" cy="120" rx="7" ry="6" fill="#22302E" />

      <path
        d="M60 106l-18-4M60 112l-19 3M140 106l18-4M140 112l19 3"
        stroke="#D3B892"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
