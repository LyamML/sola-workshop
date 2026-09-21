import type { ReactNode } from "react";

/** Bandeau de confidentialité. Il n'est jamais repliable : ce que le système
 *  s'interdit de lire doit rester visible à l'écran, pas dans une annexe. */
export function PrivacyNote({ children }: { children: ReactNode }) {
  return (
    <div className="privacy">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z" />
        <path d="M9.4 12.2l1.9 1.9 3.5-3.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p>{children}</p>
    </div>
  );
}
