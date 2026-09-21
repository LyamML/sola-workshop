import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SolaCat } from "./components/SolaCat";
import { Wave } from "./components/Wave";
import {
  BREATH_PHASES,
  SCENES,
  type Beat,
  type CardSpec,
  type SceneKey,
  type VoiceState,
} from "./scenarios";
import { connectBracelet, type BraceletReading } from "./bracelet";

interface Speech {
  who: string;
  line: string;
  user: boolean;
}

export default function App() {
  const [sceneKey, setSceneKey] = useState<SceneKey>("jour");
  const scene = useMemo(() => SCENES.find((s) => s.key === sceneKey)!, [sceneKey]);

  const [voice, setVoice] = useState<VoiceState>(scene.opening.state);
  const [speech, setSpeech] = useState<Speech>({
    who: scene.opening.who,
    line: scene.opening.line,
    user: false,
  });
  const [hint, setHint] = useState(scene.opening.hint);
  const [cards, setCards] = useState<CardSpec[]>([]);
  const [done, setDone] = useState<Record<string, true>>({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // --- minuterie du scénario ------------------------------------------------
  // Les instants sont programmés à l'avance ; on garde leurs identifiants pour
  // tout annuler dès qu'on change de scénario, sinon un pas de l'ancien vient
  // écrire par-dessus le nouveau.
  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const apply = useCallback((beat: Beat) => {
    if (beat.state) setVoice(beat.state);
    if (beat.hint !== undefined) setHint(beat.hint);
    if (beat.line !== undefined) {
      setSpeech({ who: beat.who ?? "Sola", line: beat.line, user: beat.user ?? false });
    }
    if (beat.card) {
      const card = beat.card;
      setCards((prev) => (prev.some((c) => c.id === card.id) ? prev : [...prev, card]));
    }
  }, []);

  const play = useCallback(
    (beats: Beat[]) => {
      const last = beats.reduce((max, b) => Math.max(max, b.at), 0);
      setBusy(true);
      beats.forEach((beat) => {
        timers.current.push(window.setTimeout(() => apply(beat), beat.at));
      });
      timers.current.push(window.setTimeout(() => setBusy(false), last));
    },
    [apply],
  );

  // Changement de scénario : la borne repart de son état d'ouverture.
  useEffect(() => {
    clearTimers();
    setVoice(scene.opening.state);
    setSpeech({ who: scene.opening.who, line: scene.opening.line, user: false });
    setHint(scene.opening.hint);
    setCards([]);
    setDone({});
    setStep(0);
    setBusy(false);
    if (scene.onEnter) play(scene.onEnter);
    return clearTimers;
  }, [scene, clearTimers, play]);

  // --- transition de la réplique -------------------------------------------
  // On repart de l'état « sortie » puis on le retire à la frame suivante, pour
  // que la transition CSS joue dans le sens de l'entrée.
  const [out, setOut] = useState(false);
  useEffect(() => {
    setOut(true);
    const id = requestAnimationFrame(() => setOut(false));
    return () => cancelAnimationFrame(id);
  }, [speech]);

  // --- respiration guidée ---------------------------------------------------
  const [breath, setBreath] = useState({ phase: 0, left: BREATH_PHASES[0].seconds });
  useEffect(() => {
    if (!scene.breathing) return;
    setBreath({ phase: 0, left: BREATH_PHASES[0].seconds });
    const id = window.setInterval(() => {
      setBreath((b) => {
        if (b.left > 1) return { ...b, left: b.left - 1 };
        const phase = (b.phase + 1) % BREATH_PHASES.length;
        return { phase, left: BREATH_PHASES[phase].seconds };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [scene]);

  // --- bracelet -------------------------------------------------------------
  const [reading, setReading] = useState<BraceletReading | null>(null);
  const [bleError, setBleError] = useState<string | null>(null);
  const disconnect = useRef<(() => void) | null>(null);

  const pair = useCallback(async () => {
    if (disconnect.current) {
      disconnect.current();
      disconnect.current = null;
      setReading(null);
      return;
    }
    setBleError(null);
    try {
      disconnect.current = await connectBracelet({
        onReading: setReading,
        onDisconnect: () => {
          disconnect.current = null;
          setReading(null);
        },
      });
    } catch (err) {
      setBleError(err instanceof Error ? err.message : "Appairage interrompu.");
    }
  }, []);

  useEffect(() => () => disconnect.current?.(), []);

  // Une carte qui apparaît sous la ligne de flottaison n'existe pas : on amène
  // la dernière à l'écran dès qu'elle est posée.
  useEffect(() => {
    if (cards.length === 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // Après la frame de peinture : la carte vient d'entrer dans le flux et sa
    // hauteur n'est connue qu'ensuite.
    const id = requestAnimationFrame(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(id);
  }, [cards.length]);

  const advance = () => {
    if (busy || step >= scene.steps.length) return;
    play(scene.steps[step]);
    setStep(step + 1);
  };

  const phase = BREATH_PHASES[breath.phase];
  const classes = ["borne", `is-${voice}`, scene.mode ? `mode-${scene.mode}` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="b-scenes" role="group" aria-label="Scénario de démonstration">
        {SCENES.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={s.key === sceneKey}
            onClick={() => setSceneKey(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="b-status">
        <span>
          <i className="d" />
          Cabine C-12 · Lyam Mafray
        </span>
        <span>J+4 128 · Méridien</span>
        {reading ? (
          <span>
            {reading.bpm} bpm
            {reading.rmssd !== undefined ? ` · HRV ${Math.round(reading.rmssd)} ms` : ""}
            {reading.batteryPercent !== undefined ? ` · ${reading.batteryPercent} %` : ""}
            {reading.contact ? "" : " · contact perdu"}
          </span>
        ) : (
          <span>Bracelet · 61 %</span>
        )}
        <span>Tout reste dans la cabine</span>
        {bleError ? <span className="warn">{bleError}</span> : null}
      </div>

      <div className="b-stage">
        <div
          className="sola-wrap"
          style={
            scene.breathing
              ? {
                  transform: `scale(${phase.scale})`,
                  transition: `transform ${phase.seconds}s ease-in-out`,
                }
              : undefined
          }
        >
          <div className="aura" />
          <div className="ring" />
          <div className="ring r2" />
          <SolaCat />
        </div>

        <Wave />

        <div className="b-speech">
          <p className="b-who">{speech.user ? speech.who : "Sola"}</p>
          <p className={`b-line${speech.user ? " user" : ""}${out ? " out" : ""}`}>
            {speech.line}
          </p>
          {scene.breathing ? (
            <div className="breath">
              <span className="num">{breath.left}</span>
              <span className="st">{phase.label}</span>
            </div>
          ) : hint ? (
            <p className="b-hint">{hint}</p>
          ) : null}
        </div>

        {scene.hideMic ? null : (
          <button
            type="button"
            className="b-mic"
            onClick={advance}
            aria-label={step >= scene.steps.length ? "Échange terminé" : "Parler à Sola"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
      </div>

      <div className="b-cards">
        {cards.map((card) => (
          <div key={card.id} className={`b-card${card.warm ? " warm" : ""}`}>
            <span className="tag">{card.tag}</span>

            {card.person ? (
              <div className="b-person">
                <span className="av">{card.person.initials}</span>
                <span>
                  <span className="nm">{card.person.name}</span>
                  <br />
                  <span className="mt">{card.person.meta}</span>
                </span>
              </div>
            ) : null}

            {card.text ? <p dangerouslySetInnerHTML={{ __html: card.text }} /> : null}

            {card.actions ? (
              <div className="b-acts">
                {card.actions.map((action, i) => {
                  const id = `${card.id}:${i}`;
                  const isDone = done[id] === true;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`${action.ghost ? "ghost" : ""}${isDone ? " done" : ""}`}
                      onClick={() =>
                        action.ghost
                          ? setCards((prev) => prev.filter((c) => c.id !== card.id))
                          : setDone((prev) => ({ ...prev, [id]: true }))
                      }
                    >
                      {isDone ? "C’est noté" : action.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="b-foot">
        <button type="button" onClick={pair}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 7l10 10-5 4V3l5 4L7 17" />
          </svg>
          {reading ? "Bracelet connecté" : "Appairer le bracelet"}
        </button>
        <button type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v18M4 8l8-5 8 5v8l-8 5-8-5z" />
          </svg>
          Mes données
        </button>
        <button type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="10" width="16" height="11" rx="3" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          Verrouiller
        </button>
      </div>
    </div>
  );
}
