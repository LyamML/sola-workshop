/**
 * La voix de la borne.
 *
 * Deux moitiés du même appareil : ce qu'il entend (`SpeechRecognition`) et ce
 * qu'il dit (`speechSynthesis`). Elles tournent ensemble, pour qu'on puisse la
 * couper au milieu d'une phrase : devoir attendre qu'elle ait fini rend la
 * borne frustrante, surtout quand la question est déjà affichée à l'écran.
 *
 * Le prix à payer, c'est que le micro l'entend aussi, elle. `estEcho` sépare sa
 * propre voix de celle d'en face, et seule la seconde l'interrompt.
 *
 * La reconnaissance n'existe aujourd'hui que dans les navigateurs à moteur
 * Chromium, et elle demande une permission. Rien de tout cela n'est garanti :
 * `dispo` dit ce que ce navigateur sait faire, et la borne reste jouable au
 * clavier quand la réponse est non.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Ni SpeechRecognition ni son événement ne sont décrits par lib.dom (TS 5.9) —
// seuls les types de résultat le sont. On déclare le strict nécessaire.
interface EvenementReconnaissance extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface Reconnaissance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: EvenementReconnaissance) => void) | null;
  onerror: ((e: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => Reconnaissance;
    webkitSpeechRecognition?: new () => Reconnaissance;
  }
}

const Moteur =
  typeof window === "undefined"
    ? undefined
    : window.SpeechRecognition ?? window.webkitSpeechRecognition;

/** Minuscules, sans accent ni ponctuation : la reconnaissance rend « D'accord »
 *  ou « d accord » selon le moment, la comparaison ne peut pas être littérale. */
export function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Vrai si la phrase contient l'une des formes attendues, en mots entiers.
 * Les espaces de garde comptent : sans eux « Louis » vaudrait « oui » et
 * « personne » vaudrait « non ».
 */
export function correspond(phrase: string, mots: string[]): boolean {
  const p = ` ${normaliser(phrase)} `;
  return mots.some((mot) => p.includes(` ${normaliser(mot)} `));
}

/**
 * Vrai si ce qui est entendu n'est que l'écho de ce que Sola prononce.
 *
 * Le micro reste ouvert pendant qu'elle parle, et il l'entend. Il faut donc
 * séparer sa voix de celle d'en face, à partir du seul indice disponible : le
 * texte de la réplique en cours.
 *
 * On compare les mots, pas leur ordre. L'ordre paraissait plus sûr, mais la
 * reconnaissance écorche ce qu'elle réentend — « qu'on regarde ce qui » revient
 * en « quand on regarde se qui » — et la moindre syllabe ratée cassait la
 * comparaison : Sola se coupait toute seule au milieu de ses phrases.
 *
 * Les tokens d'une ou deux lettres ne comptent pas. Ils viennent surtout des
 * apostrophes découpées — « d'accord » donne « d » + « accord » — et le « d »
 * de « troisième nuit d'affilée » suffisait à faire passer un vrai « d'accord »
 * pour un écho.
 *
 * Ce filtre n'est pas une coquetterie : la réplique qui pose la première
 * question contient « regarde » et « laisse », qui sont les mots-clés de ses
 * deux réponses. Sans lui, Sola répond à sa propre question.
 */
export function estEcho(phrase: string, dit: string, seuil = 0.6): boolean {
  if (!dit) return false;
  const sien = ` ${normaliser(dit)} `;
  const mots = normaliser(phrase).split(" ").filter(Boolean);
  if (!mots.length) return true;

  // Reprise littérale d'un bout de sa phrase (ex. « Je suis là. » dans
  // « Salut. Je suis là. ») : toujours un écho, même avec peu de mots longs.
  const brut = ` ${mots.join(" ")} `;
  if (sien.includes(brut)) return true;

  const porteurs = mots.filter((m) => m.length >= 3);
  // Rien que des broutilles (« ok », « eh ») : seule une reprise littérale
  // compte, sans quoi un bruit de cabine lui couperait la parole.
  if (!porteurs.length) return sien.includes(brut);

  const siens = porteurs.filter((m) => sien.includes(` ${m} `)).length;
  return siens / porteurs.length >= seuil;
}

/**
 * Ce qui suit son écho dans une phrase entendue : la réponse du résident, quand
 * Chrome l'a collée derrière sa voix à elle dans un même résultat.
 *
 * On remonte depuis la fin tant que les mots ne sont pas les siens. Les
 * broutilles d'une ou deux lettres suivent le mot d'après : le « d » de
 * « d'accord » est aussi celui de « d'affilée », et sans cela « d'accord »
 * perdrait sa première moitié.
 */
export function apresEcho(phrase: string, dit: string): string {
  const siens = new Set(normaliser(dit).split(" "));
  const mots = normaliser(phrase).split(" ").filter(Boolean);
  let debut = mots.length;
  while (debut > 0 && !siens.has(mots[debut - 1])) debut--;
  if (debut === mots.length) return "";
  while (debut > 0 && mots[debut - 1].length <= 2) debut--;
  return mots.slice(debut).join(" ");
}

/**
 * Combien de temps une réplique reste comparable après qu'elle s'est tue.
 * Chrome rend ce qu'il entend avec retard et ne ferme un résultat qu'après un
 * silence : l'écho de sa voix arrive quand elle a fini. La voix Google, distante,
 * décale encore. 3,5 s : marge pour ne pas se répondre à elle-même.
 */
const TRAINE_ECHO = 3500;

interface Replique {
  texte: string;
  /** Instant où elle s'est tue, `Infinity` tant qu'elle la dit. */
  fin: number;
}

/** Date la fin de ce qui était encore en cours de diction. */
function clore(repliques: Replique[]) {
  const maintenant = performance.now();
  for (const r of repliques) if (r.fin === Infinity) r.fin = maintenant;
}

/**
 * Les formes sous lesquelles la reconnaissance rend « Sola ».
 *
 * Ce n'est pas un mot français : le moteur de Chrome le rapproche de ce qu'il
 * connaît, et rend « Zola », « solaire », « Sonia » aussi souvent que « Sola ».
 * N'attendre que l'orthographe exacte, c'est une borne qui reste sourde.
 * Sont écartées les formes trop courantes — « cela », « voilà » — qui la
 * réveilleraient sur une conversation qui ne la concerne pas.
 */
const EVEIL = [
  "sola",
  "solla",
  "sol a",
  "sol la",
  "zola",
  "solar",
  "solaire",
  "sonia",
  "soula",
  "solo",
];

/**
 * Cherche le mot d'éveil dans une phrase.
 * Rend ce qui suit le nom (chaîne vide si la phrase s'arrête là), ou `null`
 * si le nom n'y est pas.
 */
export function motDEveil(phrase: string): string | null {
  const p = ` ${normaliser(phrase)} `;
  for (const mot of EVEIL) {
    const i = p.indexOf(` ${mot} `);
    if (i !== -1) return p.slice(i + mot.length + 1).trim();
  }
  return null;
}

/**
 * Les voix françaises, de la plus humaine à la plus mécanique.
 *
 * Les voix de Windows — Hortense, Julie, Paul — sont locales et toujours là,
 * mais elles sonnent comme un répondeur, et la borne les prenait d'office.
 * Chrome fournit « Google français », Edge ses voix « Natural » : distantes,
 * elles demandent le réseau, mais sonnent nettement moins mécaniques.
 */
function rang(v: SpeechSynthesisVoice): number {
  if (/natural/i.test(v.name)) return 0;
  if (/^google/i.test(v.name)) return 1;
  return v.localService ? 3 : 2;
}

export interface VoixChoisies {
  /** Celle qui parle d'ordinaire. */
  principale: SpeechSynthesisVoice | null;
  /** Une voix locale, quand la principale ne l'est pas : elle prend le relais
   *  si le service distant ne répond pas. */
  reserve: SpeechSynthesisVoice | null;
}

/** Le français de France d'abord : une voix d'ailleurs ne sert qu'à défaut. */
export function choisirVoix(toutes: readonly SpeechSynthesisVoice[]): VoixChoisies {
  const fr = toutes.filter((v) => v.lang.toLowerCase().startsWith("fr"));
  const france = fr.filter((v) => /^fr[-_]fr$/i.test(v.lang));
  // `sort` est stable : à rang égal, l'ordre du navigateur départage.
  const liste = [...(france.length ? france : fr)].sort((a, b) => rang(a) - rang(b));
  const principale = liste[0] ?? null;
  const reserve =
    principale && !principale.localService ? (liste.find((v) => v.localService) ?? null) : null;
  return { principale, reserve };
}

/**
 * Chrome coupe une voix distante au bout d'une quinzaine de secondes de parole
 * (bogue Chromium 679437), sans toujours le signaler : Sola resterait « en
 * train de parler », la phrase à moitié dite. Elle dit donc ses répliques
 * phrase par phrase, et une phrase trop longue se recoupe à sa dernière
 * virgule. 150 caractères sont une marge choisie, pas une mesure.
 */
const MORCEAU_MAX = 150;

/** Découpe une réplique en morceaux qu'une voix Google dira jusqu'au bout. */
export function morceaux(texte: string): string[] {
  return texte
    .split(/(?<=[.!?…])\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap(recouper);
}

function recouper(phrase: string): string[] {
  const parts: string[] = [];
  let reste = phrase;
  while (reste.length > MORCEAU_MAX) {
    let coupe = 0;
    for (const m of reste.slice(0, MORCEAU_MAX).matchAll(/[,;:]\s/g)) coupe = m.index + 1;
    // Sans pause où couper, la phrase part entière : mieux vaut risquer une
    // voix coupée qu'un mot coupé.
    if (!coupe) break;
    parts.push(reste.slice(0, coupe).trim());
    reste = reste.slice(coupe).trim();
  }
  parts.push(reste);
  return parts;
}

/**
 * Le temps qu'a une voix distante pour se mettre à parler. Quand son service
 * ne répond pas, Chrome ne dit rien — ni `start`, ni `error` — et attend : le
 * morceau repart alors avec la voix locale. Deux secondes et demie sont une
 * marge choisie, pas une mesure — à revoir après l'essai dans Chrome.
 */
const DEMARRAGE_MAX = 2500;

/**
 * Après une panne de la voix distante, la voix locale parle seule une minute :
 * sans ce répit, chaque réplique attendrait `DEMARRAGE_MAX` en silence avant
 * de partir.
 */
const REPIT_PANNE = 60_000;

/**
 * La réplique en cours de diction. Son identité suffit à reconnaître les
 * événements qui lui appartiennent ; `mot` retient l'énoncé qui se dit, que
 * Chrome oublierait sinon, et ses événements avec.
 */
interface Diction {
  mot?: SpeechSynthesisUtterance;
}

export interface Voix {
  /** Ce navigateur sait écouter. */
  dispo: boolean;
  /** Le micro est ouvert maintenant. */
  ecoute: boolean;
  /** La phrase en cours, telle qu'entendue — elle change à chaque mot. */
  partiel: string;
  /** Sola est en train de prononcer une réplique. */
  parle: boolean;
  erreur: string | null;
  /** À appeler après le geste d'éveil : ouvre le micro. */
  demarrer: () => void;
  /** Prononce une réplique. Le micro reste ouvert : on peut la couper. */
  parler: (texte: string) => void;
  /** Coupe tout — changement de scénario. */
  taire: () => void;
}

export function useVoix(
  onPhrase: (texte: string) => void,
  onAuVol: (texte: string) => boolean = () => false,
): Voix {
  const [ecoute, setEcoute] = useState(false);
  const [partiel, setPartiel] = useState("");
  const [parle, setParle] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // La reconnaissance appelle ses gestionnaires longtemps après le rendu qui
  // les a posés : tout ce qu'ils lisent passe par une référence, jamais par
  // une variable capturée.
  const moteur = useRef<Reconnaissance | null>(null);
  const voulue = useRef(false); // on veut écouter (≠ le micro est ouvert)
  const enParole = useRef(false);
  const enCours = useRef<Diction | null>(null);
  // Instant de la dernière panne de la voix distante.
  const panne = useRef(-Infinity);
  const rappel = useRef(onPhrase);
  rappel.current = onPhrase;
  const auVol = useRef(onAuVol);
  auVol.current = onAuVol;

  // Ce qu'elle a dit et qui peut encore revenir par le micro. Juger l'écho
  // contre la seule phrase en cours ne suffisait pas : son écho définitif
  // arrivait une fois la phrase finie, et répondait à la question qu'elle
  // venait de poser ; celui d'une réplique arrivé pendant la suivante la
  // coupait.
  const recentes = useRef<Replique[]>([]);

  // Les résultats déjà reconnus comme son écho, avec ce qu'ils reprenaient :
  // leur version définitive se juge contre le même texte, même arrivée tard.
  const echos = useRef(new Map<number, string>());

  // Index du dernier résultat pris au vol. Chrome le refermera plus tard en
  // résultat définitif : sans cette marque, la phrase compterait deux fois.
  const consomme = useRef(-1);

  const ouvrir = useCallback(() => {
    const rec = moteur.current;
    if (!rec || !voulue.current) return;
    try {
      rec.start();
    } catch {
      // `start()` sur un moteur déjà démarré jette : c'est exactement l'état
      // qu'on voulait, il n'y a rien à faire.
    }
  }, []);

  // Elle se tait, qu'on la coupe ou qu'on change de scène.
  const taire = useCallback(() => {
    enCours.current = null;
    window.speechSynthesis?.cancel();
    enParole.current = false;
    clore(recentes.current);
    setParle(false);
  }, []);

  useEffect(() => {
    if (!Moteur) return;
    const rec = new Moteur();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    // Tout ce qui peut encore résonner, plus ce que ce résultat reprenait déjà.
    const reference = (i: number): string => {
      const seuil = performance.now() - TRAINE_ECHO;
      const textes = recentes.current.filter((r) => r.fin > seuil).map((r) => r.texte);
      const deja = echos.current.get(i);
      if (deja) textes.push(deja);
      return textes.join(" ");
    };

    rec.onresult = (e) => {
      let encours = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (i <= consomme.current) continue;
        const res = e.results[i];
        const phrase = (res[0]?.transcript ?? "").trim();
        if (!phrase) continue;

        const sienne = reference(i);
        // Pendant qu'elle parle, seuil plus bas : la voix Google déforme le
        // texte, et 60 % laissait passer son propre écho comme une interruption.
        const seuilEcho = enParole.current ? 0.45 : 0.6;
        if (sienne && estEcho(phrase, sienne, seuilEcho)) {
          echos.current.set(i, sienne);
          const reste = apresEcho(phrase, sienne);
          // Écho pur : on ignore. Un reste après l'écho = barge-in collé par Chrome.
          if (!reste) {
            if (res.isFinal) consomme.current = i;
            continue;
          }
          const dite = enCours.current;
          if (auVol.current(reste)) {
            // Répondre relance le scénario : on ne coupe que la réplique qui
            // était dite, pas celle qui vient peut-être de partir.
            if (enParole.current && enCours.current === dite) taire();
            consomme.current = i;
          }
          continue;
        }

        // Quelqu'un parle par-dessus elle : elle se tait, et la phrase suit
        // son cours normal. Pas sur un écho (déjà filtré plus haut).
        if (enParole.current) taire();

        if (res.isFinal) {
          rappel.current(phrase);
        } else if (auVol.current(phrase)) {
          // Chrome attend un silence franc avant de déclarer une phrase
          // terminée — souvent plus d'une seconde. « Oui » n'a pas besoin de ce
          // verdict : dès que ce qui est entendu suffit à répondre, on répond.
          consomme.current = i;
        } else {
          encours += `${phrase} `;
        }
      }
      setPartiel(encours.trim());
    };

    rec.onerror = (e) => {
      // Un silence n'est pas une panne : Chrome coupe après quelques secondes
      // sans parole et `onend` se charge de rouvrir.
      if (e.error === "no-speech" || e.error === "aborted") return;
      voulue.current = e.error !== "not-allowed" && e.error !== "service-not-allowed";
      setErreur(
        voulue.current
          ? "Micro indisponible"
          : "Micro refusé · barre d’espace pour parler",
      );
    };

    rec.onend = () => {
      setEcoute(false);
      setPartiel("");
      // Les index repartent de zéro à la prochaine écoute.
      consomme.current = -1;
      echos.current.clear();
      // Chrome ferme le micro tout seul après un silence. Un délai court évite
      // la boucle serrée quand la fermeture est immédiate et répétée.
      // On rouvre même pendant qu'elle parle : c'est justement là qu'il faut
      // pouvoir la couper, et ses longues répliques dépassent ce silence.
      if (voulue.current) window.setTimeout(ouvrir, 220);
    };

    moteur.current = rec;
    return () => {
      voulue.current = false;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.abort();
      moteur.current = null;
      window.speechSynthesis?.cancel();
    };
  }, [ouvrir, taire]);

  const demarrer = useCallback(() => {
    if (!Moteur) return;
    voulue.current = true;
    setEcoute(true);
    ouvrir();
  }, [ouvrir]);

  // La liste des voix arrive de façon asynchrone au premier chargement : on la
  // relit à `voiceschanged` plutôt que de figer un choix trop tôt.
  const voixFr = useRef<VoixChoisies>({ principale: null, reserve: null });
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const choisir = () => {
      voixFr.current = choisirVoix(synth.getVoices());
    };
    choisir();
    synth.addEventListener("voiceschanged", choisir);
    return () => synth.removeEventListener("voiceschanged", choisir);
  }, []);

  const parler = useCallback(
    (texte: string) => {
      const synth = window.speechSynthesis;
      if (!synth) return;
      // La réplique précédente cède sa place avant d'être annulée : ce qu'elle
      // émettra encore en s'arrêtant ne doit plus rien relancer.
      enCours.current = null;
      synth.cancel();
      // La réplique interrompue par celle-ci ne finira jamais d'elle-même : on
      // la date ici, et on oublie ce qui ne peut plus résonner.
      clore(recentes.current);
      const seuil = performance.now() - TRAINE_ECHO;
      recentes.current = [
        ...recentes.current.filter((r) => r.fin > seuil),
        { texte, fin: Infinity },
      ];
      enParole.current = true;
      setParle(true);

      const diction: Diction = {};
      enCours.current = diction;
      const fini = () => {
        // Une réplique coupée par la suivante termine quand même, en retard.
        // Sans ce garde-fou elle déclarerait Sola muette pendant qu'elle dit
        // la suivante : plus d'interruption possible, et deux secondes plus
        // tard l'écho de la nouvelle réplique ne serait plus reconnu.
        if (enCours.current !== diction) return;
        enParole.current = false;
        clore(recentes.current);
        setParle(false);
        if (voulue.current) {
          setEcoute(true);
          window.setTimeout(ouvrir, 160);
        }
      };

      const parts = morceaux(texte);
      const { principale, reserve } = voixFr.current;

      // Un morceau après l'autre, plutôt que tous dans la file de Chrome : si
      // la voix distante lâche, la suite de la réplique change de voix.
      const dire = (i: number, voix: SpeechSynthesisVoice | null) => {
        if (enCours.current !== diction) return;
        if (i >= parts.length) {
          fini();
          return;
        }
        const mot = new SpeechSynthesisUtterance(parts[i]);
        mot.lang = "fr-FR";
        if (voix) mot.voice = voix;
        mot.rate = 0.98;
        diction.mot = mot;

        const lacher = () => {
          if (enCours.current !== diction) return;
          mot.onstart = mot.onend = mot.onerror = null;
          synth.cancel();
          panne.current = performance.now();
          if (reserve) dire(i, reserve);
          else fini();
        };
        const distante = voix !== null && !voix.localService;
        const garde = distante ? window.setTimeout(lacher, DEMARRAGE_MAX) : undefined;
        mot.onstart = () => window.clearTimeout(garde);
        mot.onend = () => {
          window.clearTimeout(garde);
          dire(i + 1, voix);
        };
        mot.onerror = (e) => {
          window.clearTimeout(garde);
          // Annulé par `taire` ou par la réplique suivante : rien à reprendre.
          if (e.error === "interrupted" || e.error === "canceled") return;
          if (distante) lacher();
          else fini();
        };
        synth.speak(mot);
      };

      const enPanne = performance.now() - panne.current < REPIT_PANNE;
      dire(0, enPanne && reserve ? reserve : principale);
    },
    [ouvrir],
  );

  return {
    dispo: Boolean(Moteur),
    ecoute,
    partiel,
    parle,
    erreur,
    demarrer,
    parler,
    taire,
  };
}
