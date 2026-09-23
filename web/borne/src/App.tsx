import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SolaAvatar } from "./components/SolaAvatar";
import { Wave } from "./components/Wave";
import {
  BREATH_PHASES,
  HINT_ECOUTE,
  SCENES,
  type Beat,
  type Option,
  type Question,
  type Scene,
  type SceneKey,
  type Sortie,
  type VoiceState,
} from "./scenarios";
import { connectBracelet, type BraceletReading } from "./bracelet";
import { libelleTransmission, useTransmission } from "./transmission";
import { correspond, motDEveil, useVoix } from "./voix";

interface Replique {
  id: number;
  texte: string;
}

/** Ce que l'écran garde de l'échange : la dernière phrase du résident et ce
 *  que Sola y répond. Pas de pile : ce qui a été dit plus tôt a été entendu,
 *  et une trace qui s'allonge finit par pousser le chat hors de l'écran. */
interface Trace {
  resident?: Replique;
  sola?: Replique;
}

/** Trois dispositions pour une même scène. Le chat porte la bascule : il
 *  rétrécit et glisse pendant que le reste s'efface et que le nouveau monte. */
type Ecran = "conversation" | "question" | "alerte";

/** Le carré où poser le chat, en pixels, dans le repère de la scène. */
interface Geo {
  x: number;
  y: number;
  t: number;
}

/** L'occupant de la cabine. Le serveur n'écrit ses trames que si le bracelet
 *  appairé lui est bien attribué. */
const RESIDENT = "R-0448";

/** Sous ce seuil la batterie s'affiche ; au-dessus, elle n'a rien à dire. */
const BATTERIE_BASSE = 20;

/** Lecture du bandeau tant qu'aucun bracelet n'est appairé : la FC de repos et
 *  le RMSSD de R-0448 la veille, dans le jeu de démonstration. */
const LECTURE_DEMO = "62 bpm · HRV 31 ms";

const RIEN_PARTI = "Rien n’a quitté la cabine";
/** Une minute de constantes écrite au serveur de bord suffit à rendre
 *  « rien » faux : la pastille ne ment pas pour rester courte. */
const CONSTANTES_PARTIES = "Seules tes constantes ont quitté la cabine";

const SCENE_ALERTE = SCENES.find((s) => s.mode === "alerte");

/** La question qu'une scène posera d'elle-même. La carte de l'alerte lui garde
 *  sa place avant qu'elle n'arrive, et après la réponse : rien ne saute. */
function questionPrevue(scene: Scene | undefined): Question | null {
  return scene?.onEnter?.find((b) => b.question)?.question ?? null;
}

/** Les espaces que la typographie française ne coupe pas : un « ? » seul en
 *  tête de ligne, ou « Dr » d'un côté et « Ferreira » de l'autre, se voient de
 *  loin sur une borne. À l'affichage seulement : la voix lit le texte d'origine,
 *  et c'est lui que le filtre d'écho compare à ce qu'elle entend. */
function insecable(texte: string): string {
  return texte
    .replace(/ ([?!:;»])/g, " $1")
    .replace(/« /g, "« ")
    .replace(/\bDr /g, "Dr ")
    .replace(/(\d) h\b/g, "$1 h")
    .replace(/\bh (\d)/g, "h $1");
}

function Icone({ nom, taille = 15 }: { nom: "micro" | "coche"; taille?: number }) {
  return (
    <svg className="ic" width={taille} height={taille} viewBox="0 0 24 24" aria-hidden="true">
      {nom === "micro" ? (
        <>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </>
      ) : (
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      )}
    </svg>
  );
}

/** Les paroles, rendues à l'identique dans chaque disposition : seule celle
 *  du mode affiché est visible, les autres attendent leur tour, déjà en place. */
function Paroles({ trace, partiel, mode }: { trace: Trace; partiel: string; mode: Ecran }) {
  const entendu = partiel || trace.resident?.texte;
  return (
    <div className="b-paroles" data-m={mode}>
      {entendu ? (
        <p className={`b-me${partiel ? " encours" : ""}`}>«&nbsp;{insecable(entendu)}&nbsp;»</p>
      ) : null}
      {/* La clé relance l'entrée à chaque réplique, pas à chaque rendu. */}
      {trace.sola ? (
        <p key={trace.sola.id} className={`b-say${partiel ? " estompe" : ""}`}>
          {insecable(trace.sola.texte)}
        </p>
      ) : null}
    </div>
  );
}

function Choix({ question, onChoix }: { question: Question; onChoix: (o: Option) => void }) {
  return (
    <div className="b-opts">
      {question.options.map((option) => (
        <button
          key={option.label}
          type="button"
          className={`b-opt${option.ghost ? " ghost" : ""}`}
          onClick={() => onChoix(option)}
        >
          <span className="lb">{option.label}</span>
          <span className="say">dis «&nbsp;{option.mots[0]}&nbsp;»</span>
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [sceneKey, setSceneKey] = useState<SceneKey>("jour");
  const scene = useMemo(() => SCENES.find((s) => s.key === sceneKey)!, [sceneKey]);

  const [voice, setVoice] = useState<VoiceState>(scene.ouverture.state);
  const [hint, setHint] = useState(scene.ouverture.hint);
  const [trace, setTrace] = useState<Trace>({});
  const [sorties, setSorties] = useState<Sortie[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  // La dernière question posée survit à sa réponse le temps que la feuille
  // redescende : vidée d'un coup, elle s'effondrerait en partant.
  const [posee, setPosee] = useState<Question | null>(null);
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
  const dire = useCallback((qui: "sola" | "resident", texte: string) => {
    compteur.current += 1;
    const replique = { id: compteur.current, texte };
    // Une phrase du résident ouvre un tour : la réponse précédente part avec
    // l'ancien, sinon elle aurait l'air de répondre à la nouvelle.
    setTrace((t) => (qui === "resident" ? { resident: replique } : { ...t, sola: replique }));
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
      if (beat.veille) setEveille(false);
      if (beat.dit !== undefined) {
        dire("sola", beat.dit);
        parler(beat.dit);
      }
      if (beat.sortie) {
        const sortie = beat.sortie;
        setSorties((prev) => (prev.some((s) => s.id === sortie.id) ? prev : [...prev, sortie]));
      }
      if (beat.question) {
        const q = beat.question;
        setMalCompris(false);
        setQuestion(q);
        setPosee(q);
        // D'ordinaire la réplique qui amène la question la pose déjà. Sinon Sola
        // la prononce ici, sans la recopier dans la trace : elle est à l'écran.
        if (q.dit) parler(q.dit);
      }
    },
    [dire, parler],
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
    setTrace({ sola: { id: compteur.current, texte: scene.ouverture.dit } });
    setSorties(scene.ouverture.sortie ? [scene.ouverture.sortie] : []);
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

  // Une fois une minute écrite au serveur de bord, la pastille ne peut plus
  // dire que rien n'est sorti — même bracelet délié depuis.
  const [constantesParties, setConstantesParties] = useState(false);
  useEffect(() => {
    if (transmission.etat.etat === "a-jour") setConstantesParties(true);
  }, [transmission.etat]);

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
    dire("resident", texte?.trim() || echange.resident);
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
    // Le bouton touché disparaît avec la feuille ; resté actif, il prendrait la
    // prochaine barre d'espace pour lui.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    dire("resident", dit?.trim() || option.label);
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

  // --- disposition ------------------------------------------------------------
  // Le micro reste ouvert pendant une question : c'est justement le moment où
  // Sola attend qu'on lui parle, et le chat le montre.
  const enEcoute = actif && voix.ecoute && !voix.parle && !busy;
  const etat: VoiceState = voix.parle ? "speaking" : enEcoute ? "listening" : voice;
  const ecran: Ecran =
    scene.mode === "alerte" ? "alerte" : question ? "question" : "conversation";

  // Un seul chat, posé sur la place vide que la disposition du mode lui garde.
  // Le mesurer plutôt que calculer sa place : la mise en page reste au CSS,
  // et la même règle vaut à toutes les tailles d'écran.
  const sceneRef = useRef<HTMLElement>(null);
  const ecranRef = useRef(ecran);
  ecranRef.current = ecran;
  const [geo, setGeo] = useState<Geo | null>(null);
  const [pose, setPose] = useState(false);
  // La dernière place demandée. On compare à elle, pas dans une fonction de
  // mise à jour : quand une mise à jour moins urgente attend son tour — celle
  // d'un ResizeObserver —, React rejoue ces fonctions sur l'ancien état à
  // chaque rendu. Un objet neuf à chaque passage relançait alors le rendu sans
  // fin, jusqu'à « Maximum update depth exceeded » et un écran vide.
  const demandee = useRef<Geo | null>(null);

  const placer = useCallback(() => {
    const racine = sceneRef.current;
    const place = racine?.querySelector<HTMLElement>(`[data-place="${ecranRef.current}"]`);
    if (!racine || !place) return;
    const r = racine.getBoundingClientRect();
    const p = place.getBoundingClientRect();
    const t = Math.round(Math.min(p.width, p.height));
    const x = Math.round(p.left - r.left + (p.width - t) / 2);
    const y = Math.round(p.top - r.top + (p.height - t) / 2);
    const g = demandee.current;
    if (g && g.x === x && g.y === y && g.t === t) return;
    demandee.current = { x, y, t };
    setGeo(demandee.current);
  }, []);

  // Après chaque rendu : une réplique plus longue ou une feuille plus haute
  // déplacent la place sans changer sa taille, ce qu'aucun observateur ne dit.
  useLayoutEffect(() => placer());

  useEffect(() => {
    const racine = sceneRef.current;
    if (!racine) return;
    const obs = new ResizeObserver(() => placer());
    obs.observe(racine);
    racine.querySelectorAll("[data-place]").forEach((el) => obs.observe(el));
    // Les répliques changent de hauteur quand leur police arrive.
    document.fonts.ready.then(() => placer()).catch(() => {});
    return () => obs.disconnect();
  }, [placer]);

  // Le chat arrive à sa place sans y glisser depuis le coin de l'écran : le
  // mouvement ne s'arme qu'une fois la première position peinte.
  useEffect(() => {
    if (!geo || pose) return;
    const id = requestAnimationFrame(() => setPose(true));
    return () => cancelAnimationFrame(id);
  }, [geo, pose]);

  // --- rendu ------------------------------------------------------------------
  const phase = BREATH_PHASES[breath.phase];
  const classes = [
    "borne",
    `is-${etat}`,
    `ecran-${ecran}`,
    scene.mode ? `mode-${scene.mode}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const piedTexte = enEcoute ? (eveille ? HINT_ECOUTE : hint || HINT_ECOUTE) : hint;

  // La pastille dit la dernière sortie : c'est celle que Sola vient d'annoncer
  // à voix haute. Un compte sans détail inquiéterait sans rien apprendre.
  const sortie = sorties.length > 0 ? sorties[sorties.length - 1] : null;
  const pastille = sortie?.texte ?? (constantesParties ? CONSTANTES_PARTIES : RIEN_PARTI);
  const ton = sortie?.ton === "critique" ? " crit" : sortie?.ton === "chaud" ? " warm" : "";

  // Ce qui n'a sa place que quand il y a quelque chose à dire.
  const annexes: { cle: string; texte: string; alerte: boolean }[] = [];
  if (envoi) annexes.push({ cle: "envoi", texte: envoi.texte, alerte: envoi.alerte });
  if (reading?.batteryPercent !== undefined && reading.batteryPercent < BATTERIE_BASSE) {
    annexes.push({ cle: "batterie", texte: `Bracelet · ${reading.batteryPercent} %`, alerte: true });
  }
  if (bleError) annexes.push({ cle: "bracelet", texte: bleError, alerte: true });
  if (voix.erreur) annexes.push({ cle: "micro", texte: voix.erreur, alerte: true });
  else if (!voix.dispo && actif) {
    annexes.push({
      cle: "micro",
      texte: "Ce navigateur n’écoute pas · barre d’espace pour parler",
      alerte: true,
    });
  }

  const lecture = reading
    ? [
        `${reading.bpm} bpm`,
        reading.rmssd !== undefined ? `HRV ${Math.round(reading.rmssd)} ms` : null,
        reading.contact ? null : "contact perdu",
      ]
        .filter(Boolean)
        .join(" · ")
    : LECTURE_DEMO;

  const feuille = question && scene.mode !== "alerte" ? question : posee;
  const sceneAlerte = scene.mode === "alerte" ? scene : SCENE_ALERTE;
  const carte = (scene.mode === "alerte" ? question : null) ?? questionPrevue(sceneAlerte);
  const carteOuverte = scene.mode === "alerte" && question !== null;
  const arrivee = sceneAlerte?.arrivee;
  const aVoix = voix.dispo && !voix.erreur;

  return (
    <div className={classes}>
      <div className="b-teinte calme" aria-hidden="true" />
      <div className="b-teinte alerte" aria-hidden="true" />

      <header className="b-status">
        <span className={`b-pill${ton}`} role="status">
          <i className="d" aria-hidden="true" />
          <span key={pastille} className="t">
            {insecable(pastille)}
          </span>
        </span>
        {annexes.length > 0 ? (
          <span className="b-annexes">
            {annexes.map((a) => (
              <span key={a.cle} className={a.alerte ? "warn" : undefined}>
                {a.texte}
              </span>
            ))}
          </span>
        ) : null}
      </header>

      <main className="b-scene" ref={sceneRef}>
        <div
          className={`b-chat${pose ? " pose" : ""}`}
          style={
            geo
              ? { left: geo.x, top: geo.y, width: geo.t, height: geo.t }
              : { visibility: "hidden" }
          }
        >
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

        {/* Conversation : le chat au centre, les paroles dessous. */}
        <section className="b-couche b-conv" aria-hidden={ecran !== "conversation"}>
          <div className="b-place" data-place="conversation" />
          <Paroles trace={trace} partiel={voix.partiel} mode="conversation" />
          <div className="b-pied" data-m="conversation">
            <Wave />
            {scene.breathing ? (
              <div className="breath">
                <span className="num">{breath.left}</span>
                <span className="st">{phase.label}</span>
              </div>
            ) : null}
            <p className="b-hint">
              {enEcoute && piedTexte ? <Icone nom="micro" /> : null}
              {insecable(piedTexte)}
            </p>
          </div>
        </section>

        {/* Une question : le chat se range à gauche, la feuille monte du bas. */}
        <section className="b-couche b-quest" aria-hidden={ecran !== "question"}>
          <div className="b-zone">
            <div className="b-rang">
              <div className="b-place" data-place="question" />
              <Paroles trace={trace} partiel={voix.partiel} mode="question" />
            </div>
          </div>
          <div className="b-feuille" data-m="question" role="group" aria-label="Question de Sola">
            {feuille ? (
              <>
                <span className="tg">{feuille.surtitre ?? "Sola te demande"}</span>
                <h2>{insecable(feuille.titre)}</h2>
                {feuille.detail ? <p className="dt">{insecable(feuille.detail)}</p> : null}
                {feuille.personne ? (
                  <div className="b-person">
                    <span className="av">{feuille.personne.initiales}</span>
                    <span>
                      <span className="nm">{feuille.personne.nom}</span>
                      <br />
                      <span className="mt">{feuille.personne.meta}</span>
                    </span>
                  </div>
                ) : null}
                <Choix question={feuille} onChoix={(o) => repondre(o)} />
                <p className="b-aide">
                  {aVoix ? <Icone nom="micro" taille={13} /> : null}
                  {malCompris
                    ? "Je n’ai pas saisi — redis-le, ou touche un choix."
                    : aVoix
                      ? "Réponds à voix haute, ou touche un choix."
                      : "Touche un choix."}
                </p>
              </>
            ) : null}
          </div>
        </section>

        {/* Alerte : le chat dans le coin, l'arrivée des secours en grand. La
            question n'est pas une fenêtre : quelqu'un au sol ne la verra
            peut-être pas, Sola la pose à voix haute. */}
        <section className="b-couche b-alerte" aria-hidden={ecran !== "alerte"}>
          <div className="b-rang">
            <div className="b-place" data-place="alerte" />
            <Paroles trace={trace} partiel={voix.partiel} mode="alerte" />
          </div>
          {carte ? (
            <div
              className={`b-carte${carteOuverte ? " ouverte" : ""}`}
              data-m="alerte"
              role="group"
              aria-label="Question de Sola"
            >
              <span className="tg">{carte.surtitre ?? "Sola te demande"}</span>
              <h3>{insecable(carte.titre)}</h3>
              {carte.detail ? <p className="dt">{insecable(carte.detail)}</p> : null}
              <Choix question={carte} onChoix={(o) => repondre(o)} />
              {malCompris ? (
                <p className="b-aide">Je n’ai pas saisi — redis-le, ou touche un choix.</p>
              ) : null}
            </div>
          ) : null}
          {arrivee ? (
            <div className="b-arrivee" data-m="alerte">
              <span className="qui">{insecable(arrivee.qui)}</span>
              <span className="big">
                {arrivee.minutes}
                <small>min</small>
              </span>
              <span className="quand">{arrivee.trajet}</span>
              <ul className="b-faits">
                {arrivee.faits.map((fait) => (
                  <li key={fait}>
                    <i>
                      <Icone nom="coche" taille={14} />
                    </i>
                    {insecable(fait)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {/* Trois copies des paroles à l'écran, une seule annoncée. */}
        <p className="b-lu" aria-live="polite">
          {trace.sola?.texte}
        </p>
      </main>

      {/* Bandeau de démonstration : ce n'est pas l'interface de la borne, d'où
          l'effacement au repos. La borne, elle, n'a aucune commande. */}
      <nav className="b-demo" aria-label="Démonstration">
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
        <span className="live" title={reading ? "Bracelet appairé" : "Valeurs de démonstration"}>
          {lecture}
        </span>
        <button type="button" onClick={pair}>
          {reading ? "Bracelet lié" : "Appairer"}
        </button>
      </nav>

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
