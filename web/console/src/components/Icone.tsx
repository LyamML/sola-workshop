/** Les pictogrammes de la console : un tracé, dans la couleur du texte qui l'entoure. */
const TRACES = {
  pulse: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  left: <path d="M19 12H5M11 6l-6 6 6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </>
  ),
  pill: <path d="M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7zM7 7l7 7" />,
  cal: (
    <>
      <rect x="4" y="5" width="16" height="15.5" rx="2.5" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.4-3.8 4.2-5.7 7.5-5.7s6.1 1.9 7.5 5.7" />
    </>
  ),
  alert: <path d="M12 4l9 16H3zM12 10v4.2M12 17.4v.2" />,
};

export type NomIcone = keyof typeof TRACES;

export function Icone({ nom, taille = 14 }: { nom: NomIcone; taille?: number }) {
  return (
    <svg className="ic" width={taille} height={taille} viewBox="0 0 24 24" aria-hidden="true">
      {TRACES[nom]}
    </svg>
  );
}

/** Le logo de Sola : un soleil réduit à son cœur et à quatre rayons. */
export function Logo({ taille = 17 }: { taille?: number }) {
  return (
    <svg className="logo-ic" width={taille} height={taille} viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="4.4" />
      <path d="M13 1.4v3.2M13 21.4v3.2M1.4 13h3.2M21.4 13h3.2" />
    </svg>
  );
}
