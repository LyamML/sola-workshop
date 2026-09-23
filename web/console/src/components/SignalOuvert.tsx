import { useState } from "react";
import type { SignalFiche } from "../types";

/** Un signal clos pendant la visite : la fiche rechargée ne le sert plus, on le garde affiché. */
export interface SignalClos {
  signal: SignalFiche;
  motif: string;
}

/**
 * Le signal pour lequel on ouvre la fiche, en tête : son motif, depuis quand,
 * qui s'en occupe, et de quoi le clore.
 *
 * Clore demande un motif, parmi ceux que l'origine du signal propose : c'est
 * lui qui compte les faux positifs du moteur de règles, et « artefact de
 * mesure » n'a pas de sens pour un signal né d'une conversation.
 */
export function SignalOuvert({
  signal: s,
  moi,
  peutAgir,
  onPrendre,
  onClore,
}: {
  signal: SignalFiche;
  moi: number | null;
  peutAgir: boolean;
  onPrendre: (s: SignalFiche) => Promise<void>;
  onClore: (s: SignalFiche, motif: string) => Promise<void>;
}) {
  const [cloture, setCloture] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  const moiAussi = moi !== null && s.assigneId === moi;
  const par = !s.assigne
    ? "Sans personne pour l'instant"
    : s.statut === "en_cours"
      ? `Pris en charge par ${moiAussi ? "vous" : s.assigne} · en cours`
      : `Assigné à ${moiAussi ? "vous" : s.assigne} · ouvert`;

  async function geste(action: () => Promise<void>) {
    setEnvoi(true);
    try {
      await action();
    } finally {
      setEnvoi(false);
    }
  }

  const panneau = `clore-${s.id}`;

  return (
    <div className={`sigb ${s.gravite.ton}`}>
      <div>
        <div className="sg-t">
          <span className={`chip ${s.gravite.ton}`}>Signal ouvert</span>
          <span>{s.entete}</span>
        </div>
        <div className="sg-m">{s.motif}</div>
        <div className="sg-b">{par}</div>
      </div>

      {peutAgir && (
        <div className="acts">
          {!s.assigne && (
            <button type="button" className="btn" disabled={envoi} onClick={() => geste(() => onPrendre(s))}>
              Je prends
            </button>
          )}
          <button
            type="button"
            className="btn pri"
            aria-expanded={cloture}
            aria-controls={panneau}
            onClick={() => setCloture((o) => !o)}
          >
            {cloture ? "Ne pas clore" : "Clore le signal"}
          </button>
        </div>
      )}

      {peutAgir && cloture && (
        <div className="clore" id={panneau}>
          <div className="q">
            Pourquoi le clore ? <span>Le motif sert à mesurer les faux positifs du moteur de règles.</span>
          </div>
          <div className="opts">
            {s.motifsCloture.map((m) => (
              <button
                key={m}
                type="button"
                className="btn"
                disabled={envoi}
                onClick={() => geste(() => onClore(s, m))}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Le même bandeau, une fois le signal clos : on voit que le geste a porté. */
export function SignalFerme({ clos }: { clos: SignalClos }) {
  return (
    <div className="sigb closed">
      <div>
        <div className="sg-t">
          <span className="chip ok">Signal clos</span>
          <span>{clos.signal.entete}</span>
        </div>
        <div className="sg-m">{clos.signal.motif}</div>
        <div className="sg-b">Clos par vous · « {clos.motif} »</div>
      </div>
    </div>
  );
}
