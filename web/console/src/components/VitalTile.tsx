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
      <span className="lbl">{vital.label}</span>
      <span>
        <span className="v">{liveValue ?? vital.value}</span>
        {vital.unit && <span className="u">{vital.unit}</span>}
      </span>
      <span className="ref">{vital.reference}</span>
      <span className={`sim${liveValue ? " live" : ""}`}>
        {liveValue ? "bracelet · direct" : vital.measured ? "bracelet" : "simulé"}
      </span>
      <Sparkline values={vital.spark} width={120} tone={vital.watch ? "watch" : undefined} />
    </button>
  );
}
