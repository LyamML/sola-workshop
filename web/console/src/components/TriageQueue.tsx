import { useNavigate } from "react-router-dom";
import type { TriageSignal } from "../types";

/**
 * File de triage. Le tri est fait en amont (gravité, puis ancienneté) et la
 * colonne « assigné à » est la plus à droite : un signal critique sans médecin
 * affecté est une défaillance, et doit se lire comme telle.
 */
export function TriageQueue({ signals }: { signals: TriageSignal[] }) {
  const navigate = useNavigate();

  return (
    <div className="queue">
      {signals.map((signal) => (
        <button
          type="button"
          className="qrow"
          key={signal.residentId}
          onClick={() => navigate(`/residents/${signal.residentId}`)}
        >
          <span className={`chip ${signal.severity === "info" ? "" : signal.severity}`}>
            {signal.severityLabel}
          </span>
          <span className="who">
            <b>{signal.residentId}</b>
            <span>{signal.location}</span>
          </span>
          <span className="sig">{signal.trigger}</span>
          <span className="meta">
            <span className="t">{signal.openedAt}</span>
            <span className={`a${signal.unassigned ? " none" : ""}`}>{signal.assignee}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
