const MAX_HOURS = 9;
const LOW_THRESHOLD = 6;

/**
 * Durées de sommeil. La ligne d'objectif est posée en CSS à 7/9 de la hauteur
 * traçable, de sorte qu'elle reste alignée sur la base des barres.
 */
export function SleepChart({ nights }: { nights: number[] }) {
  return (
    <div className="sleep">
      <div className="target">
        <span>objectif 7 h</span>
      </div>
      {nights.map((hours, i) => {
        const label =
          i === 0 ? "J−13" : i === nights.length - 1 ? "J" : i === 6 ? "J−7" : "";
        return (
          <div className="col" key={i} title={`${hours.toFixed(1).replace(".", ",")} h`}>
            <div
              className={`stick${hours < LOW_THRESHOLD ? " low" : ""}`}
              style={{ height: `${((hours / MAX_HOURS) * 100).toFixed(1)}%` }}
            />
            <span className="cl">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
