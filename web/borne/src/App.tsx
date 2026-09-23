import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SolaAvatar } from "./components/SolaAvatar";
import { Wave } from "./components/Wave";
import {
  BREATH_PHASES,
  HINT_ECOUTE,
  SCENES,
  type Beat,
  type Carte,
  type Option,
  type Question,
  type SceneKey,
  type VoiceState,
} from "./scenarios";
import { connectBracelet, type BraceletReading } from "./bracelet";
import { libelleTransmission, useTransmission } from "./transmission";
import { correspond, motDEveil, useVoix } from "./voix";

interface Ligne {
  id: number;
  qui: "sola" | "resident";
  texte: string;
}

/** La borne ne défile pas : la trace garde les derniers tours de parole et
 *  laisse partir les autres par le haut. Quatre lignes tiennent sur l'écran le
 *  plus court sans jamais réclamer d'ascenseur. */
const TRACE_MAX = 4;

/** Deux cartes au plus : au-delà elles se marchent dessus dans le coin. */
const CARTES_MAX = 2;

/** L'occupant de la cabine C-12. Le serveur n'écrit ses trames que si le
 *  bracelet appairé lui est bien attribué. */
const RESIDENT = "R-0448";

export default function App() {
  const [sceneKey, setSceneKey] = useState<SceneKey>("jour");
  const scene = useMemo(() => SCENES.find((s) => s.key === sceneKey)!, [sceneKey]);

  const [voice, setVoice] = useState<VoiceState>(scene.ouverture.state);
  const [hint, setHint] = useState(scene.ouverture.hint);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [cartes, setCartes] = useState<Carte[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [malCompris, setMalCompris] = useState(false);
  const [etape, setEtape] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actif, setActif] = useState(false);
  const [eveille, setEveille] = useState(false);

  // --- la voix ---------------------------------------------------------------
  // Le gestionnaire de phrase dépend de presque tout l'état de l'écran, et la
  // reconnaissance vit plus longtemps qu'un rendu : on lui passe une référence
  // réassignée à chaque passage, jamais la fermeture d'un rendu précis.
  const gestionnaire = useRef<(phrase: string) => void>(() => {});
  // Ce que la borne peut trancher sans attendre la fin de la phrase.
  const auVol = useRef<(phrase: string) => boolean>(() => false);
  const voix = useVoix(
    (phrase) => gestionnaire.current(phrase),
    (phrase) => auVol.current(phrase),
  );
  const { parler, taire, demarrer } = voix;

  const compteur = useRef(0);
  const ajouterLigne = useCallback((qui: Ligne["qui"], texte: string) => {
    compteur.current += 1;
    const ligne = { id: compteur.current, qui, texte };
    setLignes((prev) => [...prev, ligne].slice(-TRACE_MAX));
  }, []);

  // --- minuterie du scénario -------------------------------------------------
  // Les instants sont programmés à l'avance ; on garde leurs identifiants pour
  // tout annuler dès qu'on change de scénario, sinon un pas de l'ancien vient
  // écrire par-dessus le nouveau.
  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const apply = useCallback(
    (beat: Beat) => {
      if (beat.state) setVoice(beat.state);
      if (beat.hint !== undefined) setHint(beat.hint);
      if (beat.dit !== undefined) {
        ajouterLigne("sola", beat.dit);
        parler(beat.dit);
      }
      if (beat.carte) {
        const carte = beat.carte;
        setCartes((prev) =>
          prev.some((c) => c.id === carte.id) ? prev : [...prev, carte].slice(-CARTES_MAX),
        );
      }
      if (beat.question) {
        setMalCompris(false);
        setQuestion(beat.question);
      }
    },
    [ajouterLigne, parler],
  );

  const jouer = useCallback(
    (beats: Beat[]) => {
      const fin = beats.reduce((max, b) => Math.max(max, b.at), 0);
      setBusy(true);
      beats.forEach((beat) => {
        timers.current.push(window.setTimeout(() => apply(beat), beat.at));
      });
      timers.current.push(window.setTimeout(() => setBusy(false), fin));
    },
    [apply],
  );

  // Changement de scénario — ou réveil de la borne : on repart de l'ouverture.
  // `actif` en dépendance n'est pas un accident : le premier geste est ce qui
  // autorise le navigateur à faire parler la borne, c'est donc là que Sola
  // prononce sa phrase d'accueil.
  useEffect(() => {
    clearTimers();
    taire();
    setVoice(scene.ouverture.state);
    setHint(scene.ouverture.hint);
    compteur.current += 1;
    setLignes([{ id: compteur.current, qui: "sola", texte: scene.ouverture.dit }]);
    setCartes([]);
    setQuestion(null);
    setMalCompris(false);
    setEtape(0);
    setEveille(false);
    setBusy(false);
    if (actif) parler(scene.ouverture.dit);
    if (scene.onEnter) jouer(scene.onEnter);
    return clearTimers;
  }, [scene, actif, clearTimers, jouer, parler, taire]);

  // --- respiration guidée -----------------------------------------------------
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

  // --- bracelet ---------------------------------------------------------------
  const [reading, setReading] = useState<BraceletReading | null>(null);
  const [bleError, setBleError] = useState<string | null>(null);
  const disconnect = useRef<(() => void) | null>(null);
  const transmission = useTransmission(RESIDENT);
  const { recevoir, terminer } = transmission;
  const envoi = libelleTransmission(transmission.etat);
  const transmet = envoi !== null && transmission.etat.etat !== "non-reconnu";

  const pair = useCallback(async () => {
    if (disconnect.current) {
      disconnect.current();
      disconnect.current = null;
      setReading(null);
      terminer();
      return;
    }
    setBleError(null);
    try {
      disconnect.current = await connectBracelet({
        onReading: setReading,
        onTrame: recevoir,
        onDisconnect: () => {
          disconnect.current = null;
          setReading(null);
          terminer();
        },
      });
    } catch (err) {
      setBleError(err instanceof Error ? err.message : "Appairage interrompu.");
    }
  }, [recevoir, terminer]);

  useEffect(() => () => disconnect.current?.(), []);

  // --- conduite de l'échange --------------------------------------------------
  const avancer = (texte?: string) => {
    if (question || busy || etape >= scene.echanges.length) return;
    const echange = scene.echanges[etape];
    ajouterLigne("resident", texte?.trim() || echange.resident);
    setEtape(etape + 1);
    jouer(echange.reponse);
  };

  const repondre = (option: Option, dit?: string) => {
    clearTimers();
    setQuestion(null);
    setMalCompris(false);
    // La question emportait sa consigne en pied de borne : elle part avec elle,
    // sinon la borne réclame une réponse à une question déjà close.
    setHint("");
    ajouterLigne("resident", dit?.trim() || option.label);
    if (option.suite) jouer(option.suite);
  };

  // Une réponse à une question se prend dès qu'elle est entendue, sans attendre
  // que le moteur ferme la phrase : entre « oui » et le choix, la borne doit
  // paraître immédiate. Rien d'autre ne se décide au vol — un mot d'éveil pris
  // trop tôt emporterait la suite de la phrase avec lui.
  auVol.current = (phrase) => {
    if (!question) return false;
    const choix = question.options.find((o) => correspond(phrase, o.mots));
    if (!choix) return false;
    repondre(choix, phrase);
    return true;
  };

  gestionnaire.current = (phrase) => {
    // Une question ouverte capte toute la parole : on ne repart pas dans le
    // scénario tant qu'on n'a pas la réponse.
    if (question) {
      const choix = question.options.find((o) => correspond(phrase, o.mots));
      if (choix) repondre(choix, phrase);
      else setMalCompris(true);
      return;
    }
    if (!eveille) {
      const suite = motDEveil(phrase);
      if (suite === null) {
        // Entendue, mais pas appelée. Le montrer : une borne qui reçoit la
        // parole sans rien en faire passe pour sourde, et on cherche la panne
        // là où il n'y en a pas.
        const bout = phrase.length > 52 ? `${phrase.slice(0, 52)}…` : phrase;
        setHint(`« ${bout} » — dis mon nom et je réponds`);
        return;
      }
      setEveille(true);
      if (suite) avancer(phrase);
      else setHint(HINT_ECOUTE);
      return;
    }
    avancer(phrase);
  };

  // Le geste de réveil. `demarrer` supporte d'être rappelé : un micro déjà
  // ouvert reste ouvert, on n'a donc pas à savoir si c'est le premier geste.
  const eveiller = useCallback(() => {
    setActif(true);
    demarrer();
  }, [demarrer]);

  // Le clavier double la voix de bout en bout : c'est ce qui sauve la
  // démonstration quand le micro est refusé ou la salle trop bruyante.
  const touche = useRef<(e: KeyboardEvent) => void>(() => {});
  touche.current = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!actif) {
      e.preventDefault();
      eveiller();
      return;
    }
    if (question) {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= question.options.length) {
        e.preventDefault();
        repondre(question.options[n - 1]);
      }
      return;
    }
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      if (!eveille) setEveille(true);
      avancer();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => touche.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // --- rendu ------------------------------------------------------------------
  const enEcoute = actif && voix.ecoute && !voix.parle && !busy && !question;
  const etat: VoiceState = voix.parle ? "speaking" : enEcoute ? "listening" : voice;
  const phase = BREATH_PHASES[breath.phase];
  const classes = ["borne", `is-${etat}`, scene.mode ? `mode-${scene.mode}` : ""]
    .filter(Boolean)
    .join(" ");

  // La dernière ligne est la grande — sauf quand une phrase est en cours d'être
  // entendue : c'est elle qui prend la place, la précédente redescend.
  const vive = voix.partiel ? -1 : lignes.length - 1;
  const piedTexte = enEcoute
    ? eveille
      ? HINT_ECOUTE
      : hint || HINT_ECOUTE
    : hint;

  return (
    <div className={classes}>
      {/* Bandeau de démonstration : ce n'est pas l'interface de la borne, d'où
          l'effacement au repos. La borne, elle, n'a aucune commande. */}
      <div className="b-demo">
        <span className="lb">démo</span>
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
        <span className="sep" />
        <button type="button" onClick={pair}>
          {reading ? "Bracelet lié" : "Appairer"}
        </button>
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
        {envoi ? <span className={envoi.alerte ? "warn" : undefined}>{envoi.texte}</span> : null}
        {/* Les constantes partent au serveur de bord ; la parole, jamais. */}
        <span>{transmet ? "Les paroles restent dans la cabine" : "Tout reste dans la cabine"}</span>
        {bleError ? <span className="warn">{bleError}</span> : null}
        {voix.erreur ? <span className="warn">{voix.erreur}</span> : null}
      </div>

      <div className="b-scene">
        <div className="b-centre">
          <div className="b-avatar">
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
              <SolaAvatar />
            </div>
          </div>

          <div className="b-trace" aria-live="polite">
            {lignes.map((ligne, i) => (
              <p
                key={ligne.id}
                className={`b-ligne ${ligne.qui}${i === vive ? " vive" : ""}`}
              >
                <span className="qui">{ligne.qui === "sola" ? "Sola" : "Lyam"}</span>
                {ligne.texte}
              </p>
            ))}
            {voix.partiel ? (
              <p className="b-ligne resident vive encours">
                <span className="qui">Lyam</span>
                {voix.partiel}
              </p>
            ) : null}
          </div>
        </div>

        <div className="b-notes">
          {cartes.map((carte) => (
            <div key={carte.id} className={`b-card${carte.warm ? " warm" : ""}`}>
              <span className="tag">{carte.tag}</span>
              {carte.personne ? (
                <div className="b-person">
                  <span className="av">{carte.personne.initiales}</span>
                  <span>
                    <span className="nm">{carte.personne.nom}</span>
                    <br />
                    <span className="mt">{carte.personne.meta}</span>
                  </span>
                </div>
              ) : null}
              {carte.texte ? <p dangerouslySetInnerHTML={{ __html: carte.texte }} /> : null}
            </div>
          ))}
        </div>

        {question ? (
          <div className="b-pop-fond">
            <div className="b-pop" role="dialog" aria-modal="true" aria-label={question.titre}>
              <span className="tag">Sola te demande</span>
              <h2>{question.titre}</h2>
              {question.detail ? <p className="dt">{question.detail}</p> : null}

              {question.personne ? (
                <div className="b-person">
                  <span className="av">{question.personne.initiales}</span>
                  <span>
                    <span className="nm">{question.personne.nom}</span>
                    <br />
                    <span className="mt">{question.personne.meta}</span>
                  </span>
                </div>
              ) : null}

              <div className="b-opts">
                {question.options.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={option.ghost ? "ghost" : ""}
                    onClick={() => repondre(option)}
                  >
                    <span className="lb">{option.label}</span>
                    <span className="vx">« {option.mots[0]} »</span>
                  </button>
                ))}
              </div>

              <p className="b-pop-pied">
                {malCompris
                  ? "Je n’ai pas saisi — redis-le, ou touche un choix."
                  : "Réponds à voix haute, ou touche un choix si tu es devant la borne."}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="b-pied">
        <Wave />
        {scene.breathing ? (
          <div className="breath">
            <span className="num">{breath.left}</span>
            <span className="st">{phase.label}</span>
          </div>
        ) : null}
        <p className="b-hint">{piedTexte}</p>
      </div>

      {actif ? null : (
        <button type="button" className="b-eveil" onClick={eveiller}>
          <span className="t">Sola est en veille</span>
          <span className="s">
            {voix.dispo
              ? "Touche l’écran ou appuie sur une touche pour ouvrir la voix"
              : "Ce navigateur n’écoute pas — touche l’écran, la barre d’espace fera parler le résident"}
          </span>
        </button>
      )}
    </div>
  );
}
