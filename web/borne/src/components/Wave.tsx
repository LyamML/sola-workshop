import { useMemo } from "react";

const BAR_COUNT = 34;

/** Onde vocale affichée pendant l'écoute. Les hauteurs sont figées au montage :
 *  une forme stable se lit comme un indicateur, pas comme du bruit. */
export function Wave() {
  const bars = useMemo(
    () =>
      Array.from({ length: BAR_COUNT }, (_, i) => ({
        height: 8 + Math.round(Math.sin(i * 1.7) * 6 + Math.random() * 16),
        delay: i * 0.045,
      })),
    [],
  );

  return (
    <div className="wave" aria-hidden="true">
      {bars.map((bar, i) => (
        <i
          key={i}
          style={
            {
              "--h": `${bar.height}px`,
              animationDelay: `${bar.delay.toFixed(2)}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
