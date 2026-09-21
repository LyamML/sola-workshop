interface SegProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Sélecteur segmenté en pilule. `aria-pressed` porte l'état — la couleur seule
 *  ne suffirait pas pour un lecteur d'écran. */
export function Seg<T extends string>({ options, value, onChange, ariaLabel }: SegProps<T>) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
