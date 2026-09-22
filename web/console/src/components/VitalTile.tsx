import type { VitalSign } from "../types";
import { Sparkline } from "./Sparkline";

interface Props {
  vital: VitalSign;
  selected: boolean;
  onSelect: () => void;
  /** Valeur temps réel reçue du bracelet, si elle remplace la valeur figée. */
  liveValue?: string;
}

export function VitalTile({ vital, selected, onSelect, liveValue }: Props) {
  return (
    <button
      type="button"
      className={`card vital${vital.watch ? " w" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="vital-h">
        <span className="lbl">{vital.label}</span>
        <span className="stat">
          <span className="v">{liveValue ?? vital.value}</span>
          {vital.unit && <span className="u">{vital.unit}</span>}
        </span>
      </span>
      {/* La courbe est posée en fond, sous le chiffre : elle donne la forme
          des sept derniers jours d'un coup d'œil, sans prendre de ligne. */}
      <Sparkline values={vital.spark} tone={vital.watch ? "watch" : undefined} fond />
    </button>
  );
}
