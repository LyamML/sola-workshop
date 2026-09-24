import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { correspond, useVoix } from "./voix";
import {
  chargerContexteResident,
  discuter,
  EchecIA,
  evaluerGravite,
  estMenaceSante,
  estViolence,
  prechauffer,
  resumer,
  type EtatAlerte,
  type Tour,
} from "./ia";
import { envoyerResume, envoyerSignal, JOUR_VOL } from "./remontee";

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

/** Ce qu'un échange libre laisse partir quand on le quitte : un résumé, jamais
 *  le verbatim. `remontee_auto` le met sous les yeux du médecin. */
const RESUME: Sortie = { id: "resume", texte: "Résumé de l’échange transmis" };
const RESUME_REMONTE: Sortie = {
  id: "resume",
  texte: "Résumé remonté à ton médecin",
  ton: "chaud",
};

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
    .replace(/ ([?!:;»])/g, " $1")
    .replace(/« /g, "« ")
    .replace(/\bDr /g, "Dr ")
    .replace(/(\d) h\b/g, "$1 h")
    .replace(/\bh (\d)/g, "h $1");
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

  const [iaErreur, setIaErreur] = useState<string | null>(null);
  // Le résumé en route, ou ce qui l'a empêché de partir. Une fois parti, c'est
  // la pastille qui le dit, comme toute sortie — et d'une scène à l'autre.
  const [remontee, setRemontee] = useState<{ texte: string; alerte: boolean } | null>(null);
  const [resumeParti, setResumeParti] = useState<Sortie | null>(null);

  // L'échange avec le modèle ne vit qu'ici, dans la mémoire de la page.
  // À la sortie de « Échange », un résumé part ; le verbatim, lui, disparaît.
  const historique = useRef<Tour[]>([]);
  const debutEchange = useRef<string | null>(null);
  const requete = useRef<AbortController | null>(null);

  // Contexte de santé enrichi : chargé une seule fois au démarrage de la
  // scène « Échange » (sola.db via le serveur).
  // Null si le serveur ne répond pas — Sola fonctionne sans contexte.
  const contexteRef = useRef<string | null>(null);

  // Score de gravité le plus haut déjà traité dans la conversation en cours.
  // Empêche d'envoyer plusieurs signaux au même palier pour la même séance.
  // Remis à 0 à chaque changement de scène.
  const scoreMax = useRef(0);
  // Une alerte « surveillance » ou plus enregistrée par le serveur pendant
  // l'échange : Sola peut dire que l'équipe médicale est prévenue.
  const alerteTransmise = useRef(false);

  // Basculement automatique de scène depuis le bracelet.
  // prevFalls : dernier compteur de chutes connu (null = pas encore de lecture).
  const prevFalls = useRef<number | null>(null);

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
  const { parler, enchainer, taire, demarrer } = voix;

  const compteur = useRef(0);
  const dire = useCallback((qui: "sola" | "resident", texte: string) => {
    compteur.current += 1;
    const replique = { id: compteur.current, texte };
    // Une phrase du résident ouvre un tour : la réponse précédente part avec
    // l'ancien, sinon elle aurait l'air de répondre à la nouvelle.
    setTrace((t) => (qui === "resident" ? { resident: replique } : { ...t, sola: replique }));
    return replique.id;
  }, []);

  // La réponse du modèle arrive mot à mot : elle réécrit sa réplique au lieu
  // d'en ouvrir une par morceau, et n'entre donc qu'une fois à l'écran.
  const reecrire = useCallback((id: number, texte: string) => {
    setTrace((t) => (t.sola?.id === id ? { ...t, sola: { id, texte } } : t));
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
      // setSceneKey est un setter React stable : pas besoin de l'ajouter aux dépendances.
      if (beat.gotoScene) setSceneKey(beat.gotoScene);
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
    // Une réponse encore en route appartient à la scène qu'on quitte.
    requete.current?.abort();
    requete.current = null;
    historique.current = [{ role: "assistant", content: scene.ouverture.dit }];
    debutEchange.current = scene.ia ? new Date().toISOString() : null;
    setIaErreur(null);
    if (scene.ia && actif) prechauffer();

    // Score de gravité et compteur de chutes remis à zéro à chaque scène.
    scoreMax.current = 0;
    alerteTransmise.current = false;
    prevFalls.current = null;

    // Chargement du profil de santé depuis sola.db au démarrage de la scène
    // « Échange ». Silencieux en cas d'échec : Sola fonctionne sans contexte.
    if (scene.ia) {
      contexteRef.current = null;
      void chargerContexteResident(RESIDENT).then((profil) => {
        contexteRef.current = profil;
      });
    } else {
      contexteRef.current = null;
    }
    setVoice(scene.ouverture.state);
    setHint(scene.ouverture.hint);
    compteur.current += 1;
    setTrace({ sola: { id: compteur.current, texte: scene.ouverture.dit } });
    setSorties(scene.ouverture.sortie ? [scene.ouverture.sortie] : []);
    setQuestion(null);
    setMalCompris(false);
    setEtape(0);
    setBusy(false);
    if (actif) parler(scene.ouverture.dit);
    if (scene.onEnter) jouer(scene.onEnter);
    return clearTimers;
  }, [scene, actif, clearTimers, jouer, parler, taire]);

  // Résumé clinique : uniquement quand on quitte la scène « Échange »
  // (changement de scénario ou démontage), pas quand `actif` bascule.
  // Déclaré après l'effet d'ouverture pour que ce cleanup lise l'historique
  // avant que le suivant ne le réinitialise.
  useEffect(() => {
    const etaitIa = scene.ia;
    return () => {
      if (!etaitIa) return;
      const tours = historique.current;
      const debut = debutEchange.current;
      if (!debut || !tours.some((t) => t.role === "user")) return;

      historique.current = [];
      debutEchange.current = null;
      // Une alerte ouverte pendant l'échange (y compris info, score ≥ 3) exige
      // un résumé remonté : sinon le médecin voit un signal sans conversation.
      const alerteOuverte = alerteTransmise.current;

      void (async () => {
        setRemontee({ texte: "Résumé en cours…", alerte: false });
        const produit = await resumer(tours);
        if (!produit) {
          setRemontee({ texte: "Résumé non produit", alerte: true });
          return;
        }
        const clinique = alerteOuverte ? { ...produit, remontee_auto: true } : produit;
        const ecoule = Date.now() - Date.parse(debut);
        const duree_min = Number.isFinite(ecoule)
          ? Math.max(0, Math.min(600, Math.round(ecoule / 60_000)))
          : 0;
        const resultat = await envoyerResume({ debut_at: debut, duree_min, clinique });
        if (!resultat.ok) {
          setRemontee({
            texte:
              resultat.raison === "serveur" ? "Serveur de bord injoignable" : "Résumé non produit",
            alerte: true,
          });
          return;
        }
        setRemontee(null);
        setResumeParti(resultat.remontee_auto ? RESUME_REMONTE : RESUME);
      })();
    };
  }, [scene.key, scene.ia]);

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

  // Basculement automatique de scène depuis le bracelet.
  // Évalué à chaque nouvelle lecture ; n'agit que depuis la scène « Échange ».
  useEffect(() => {
    if (!reading) return;

    // Chute → Alerte (depuis Échange uniquement, une seule fois par chute).
    const nowFalls = reading.falls ?? 0;
    if (sceneKey === "jour" && prevFalls.current !== null && nowFalls > prevFalls.current) {
      prevFalls.current = nowFalls;
      setSceneKey("alerte");
      return;
    }
    prevFalls.current = nowFalls;
  }, [reading, sceneKey]);

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

  // --- conversation avec le modèle local ------------------------------------

  /** Construit un motif générique pour le signal médecin (jamais du verbatim). */
  const construireMotif = (score: number, texte: string): string => {
    const j = `J+${JOUR_VOL}`;
    if (estViolence(texte)) return `Violence ou menace mentionnée en conversation (${j})`;
    if (score >= 10) return `Détresse émotionnelle signalée en conversation (${j})`;
    if (score >= 9) return `Urgence physique signalée en conversation (${j})`;
    if (estMenaceSante(texte) || score === 5)
      return `Menace pour la santé mentionnée en conversation (${j})`;
    if (score >= 7) return `Symptôme préoccupant mentionné en conversation (${j})`;
    if (score >= 6) return `Demande d’aide médicale formulée en conversation (${j})`;
    return `Symptôme léger mentionné en conversation (${j})`;
  };

  const converser = async (texte: string) => {
    // Horodaté dès la parole, avant l’appel au modèle : le signal
    // médecin doit marquer l’instant où le résident a dit quelque chose,
    // pas celui où Sola a fini de répondre (décalage possible de 5-60 s).
    const survenu_at = new Date().toISOString();
    // Écrire par-dessus elle la coupe, comme lui parler par-dessus.
    taire();
    dire("resident", texte);

    // ---- scoring de gravité -------------------------------------------------
    // Évalué sur la phrase du résident, et avant l'appel au modèle : un Ollama
    // éteint, ou un résident qui coupe Sola en reparlant, ne doit pas faire
    // perdre l'alerte. Seuil 3 (stade info) : toute alerte ouverte exige un
    // résumé remonté en fin d'échange (`remontee_auto`).
    const score = evaluerGravite(texte);
    const nouvelleAlerte = score >= 3 && score > scoreMax.current;
    let envoi: Promise<boolean> | null = null;
    if (nouvelleAlerte) {
      const precedent = scoreMax.current;
      scoreMax.current = score;
      const severite: "critique" | "surveillance" | "info" =
        score >= 9 ? "critique" : score >= 5 ? "surveillance" : "info";
      envoi = envoyerSignal({
        motif: construireMotif(score, texte),
        severite,
        survenu_at,
      }).then((ok) => {
        if (!ok) {
          // Non transmise : la phrase suivante du même niveau doit pouvoir la renvoyer.
          if (scoreMax.current === score) scoreMax.current = precedent;
          setRemontee({ texte: "Alerte non transmise · serveur de bord injoignable", alerte: true });
          return false;
        }
        alerteTransmise.current = true;
        // « Médecin informé » pour surveillance (5-8) ; critique bascule en Alerte ;
        // info (3-4) ouvre le signal sans pastille ni annonce orale.
        if (score >= 5 && score <= 8) {
          setSorties((prev) =>
            prev.some((s) => s.id === "alerte-medecin")
              ? prev
              : [...prev, { id: "alerte-medecin", texte: "Médecin informé", ton: "chaud" as const }],
          );
        }
        return true;
      });
    }

    historique.current = [...historique.current, { role: "user", content: texte }];
    const controle = new AbortController();
    requete.current = controle;
    setBusy(true);
    setVoice("thinking");
    setHint("Sola réfléchit…");
    setIaErreur(null);

    let replique: number | null = null;
    const ecrire = (t: string) => {
      if (replique === null) replique = dire("sola", t);
      else reecrire(replique, t);
    };

    // La voix démarre dès la première phrase complète du flux — sans attendre
    // la fin du modèle, sinon « Sola réfléchit » dure toute la génération.
    let parleJusqua = 0;
    let voixLancee = false;
    const pousserVoix = (t: string) => {
      const zone = t.slice(parleJusqua);
      const re = /[.!?…]+(?:\s+|$)/g;
      let m: RegExpExecArray | null;
      let avance = 0;
      while ((m = re.exec(zone)) !== null) {
        const fin = m.index + m[0].length;
        const phrase = zone.slice(avance, fin).trim();
        avance = fin;
        if (phrase.length < 8) continue;
        if (!voixLancee) {
          parler(phrase);
          voixLancee = true;
        } else {
          enchainer(phrase);
        }
      }
      parleJusqua += avance;
    };
    const finirVoix = (t: string) => {
      pousserVoix(t);
      const reste = t.slice(parleJusqua).trim();
      if (reste) {
        if (!voixLancee) parler(reste);
        else enchainer(reste);
      } else if (!voixLancee && t.trim()) {
        parler(t);
      }
    };

    let dit: string;
    let alerte: EtatAlerte = alerteTransmise.current ? "transmise" : "aucune";
    try {
      // Sola ne dit que l'équipe médicale est prévenue qu'une fois le serveur
      // de bord l'a enregistré : quelques dizaines de millisecondes en local.
      const envoyee = envoi ? await envoi : null;
      if (controle.signal.aborted) return;
      if (envoyee === false) alerte = "echec";
      else if (alerteTransmise.current) alerte = "transmise";

      const reponse = await discuter(historique.current, {
        signal: controle.signal,
        onMorceau: (t) => {
          if (!t) return;
          ecrire(t);
          pousserVoix(t);
        },
        contexte: contexteRef.current,
        alerte,
        annoncer: envoyee === true && score >= 5 && score <= 8,
      });
      dit = reponse || "Je n’ai pas trouvé mes mots. Tu peux répéter ?";
      historique.current = [...historique.current, { role: "assistant", content: dit }];
      // Basculement de scène depuis Échange uniquement : Critique → Alerte.
      // Pas sur un échec : la scène Alerte dit le médecin prévenu, et Sola
      // vient de dire d'appeler l'infirmerie.
      if (nouvelleAlerte && sceneKey === "jour" && score >= 9 && alerte === "transmise") {
        setSceneKey("alerte");
      }
    } catch (erreur) {
      const raison = erreur instanceof EchecIA ? erreur.raison : "injoignable";
      if (raison === "annule") return;
      setIaErreur(
        raison === "modele" && erreur instanceof EchecIA ? erreur.message : "IA locale injoignable",
      );
      // Même en panne, Sola ne laisse pas une question sans réponse. Elle ne
      // renvoie vers l'infirmerie que si une alerte nécessaire n'a pas pu partir.
      const debut =
        raison === "delai"
          ? "Je mets trop de temps à te répondre."
          : "Je n’arrive pas à réfléchir pour l’instant.";
      dit =
        alerte === "transmise"
          ? `${debut} Mais l’équipe médicale est prévenue.`
          : alerte === "echec"
            ? `${debut} Je n’arrive pas non plus à joindre l’équipe médicale : si c’est urgent, appelle l’infirmerie B.`
            : `${debut} Tu peux me le redire dans un moment ?`;
    } finally {
      if (requete.current === controle) {
        requete.current = null;
        setBusy(false);
      }
    }
    ecrire(dit);
    setVoice("idle");
    setHint("");
    finirVoix(dit);
  };

  // --- conduite de l'échange --------------------------------------------------
  const avancer = (texte?: string) => {
    if (scene.ia) {
      const phrase = texte?.trim();
      if (phrase && !question && !busy) void converser(phrase);
      return;
    }
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
  // paraître immédiate. Rien d'autre ne se décide au vol — une phrase coupée
  // à son premier mot partirait incomplète.
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
    // On écrit à Sola : l'espace est une espace, pas un tour de parole.
    if (e.target instanceof HTMLInputElement) return;
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
      if (!scene.ia) avancer();
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

  const piedTexte = enEcoute ? HINT_ECOUTE : hint;

  // La pastille dit la dernière sortie : celle que la scène vient d'annoncer,
  // sinon le résumé du dernier échange libre, vrai d'une scène à l'autre. Un
  // compte sans détail inquiéterait sans rien apprendre.
  const sortie = sorties.length > 0 ? sorties[sorties.length - 1] : resumeParti;
  const pastille = sortie?.texte ?? (constantesParties ? CONSTANTES_PARTIES : RIEN_PARTI);
  const ton = sortie?.ton === "critique" ? " crit" : sortie?.ton === "chaud" ? " warm" : "";

  // Ce qui n'a sa place que quand il y a quelque chose à dire.
  const annexes: { cle: string; texte: string; alerte: boolean }[] = [];
  if (envoi) annexes.push({ cle: "envoi", texte: envoi.texte, alerte: envoi.alerte });
  if (remontee) annexes.push({ cle: "remontee", ...remontee });
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
  if (iaErreur) annexes.push({ cle: "ia", texte: iaErreur, alerte: true });

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
