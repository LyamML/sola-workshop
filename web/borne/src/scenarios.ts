/**
 * Scénarios de la borne.
 *
 * La borne n'a pas de commande à l'écran : on lui parle, elle répond à voix
 * haute, et l'écran ne sert qu'à laisser une trace lisible de l'échange. Un
 * scénario est donc une suite d'instants — ce que Sola dit, quand elle écoute,
 * quand elle pose une question, et ce qui quitte la cabine.
 *
 * Deux objets seulement portent du contenu :
 *   · `Sortie`   — ce qui vient de quitter la cabine : la pastille d'état le
 *                  dit au moment où ça part, pendant que Sola le dit à voix
 *                  haute ;
 *   · `Question` — une demande qui attend une réponse, à voix haute ou au doigt.
 *
 * Le récit suit la base de démonstration : le médecin de R-0448 et son
 * contact de confiance y sont tels qu'ils sont dits ici. Un chiffre qu'on
 * change dans une réplique se vérifie d'abord avec `npm run db:sql`. La
 * conversation libre, elle, n'a pas de réplique écrite : voir `ia.ts`.
 */

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";
export type SceneKey = "jour" | "calme" | "alerte";

export interface Personne {
  initiales: string;
  nom: string;
  meta: string;
}

/**
 * Ce qui vient de quitter la cabine. La pastille d'état dit la dernière :
 * elle remplace « Tout reste dans la cabine », que démentaient l'alerte partie
 * à l'infirmerie et le résumé qu'un échange envoie au serveur de bord.
 */
export interface Sortie {
  /** Une même sortie annoncée deux fois ne s'empile pas. */
  id: string;
  texte: string;
  /** `chaud` : un soignant est prévenu. `critique` : une alerte est partie. */
  ton?: "chaud" | "critique";
}

/** Une réponse possible. Le doigt lit `label`, la voix reconnaît `mots` — la
 *  première forme de `mots` est celle qu'on affiche sur le bouton, elle doit
 *  donc rester courte et facile à prononcer. */
export interface Option {
  label: string;
  mots: string[];
  /** Réponse de repli, sans engagement : rendu plus discret. */
  ghost?: boolean;
  /** Ce que Sola enchaîne une fois l'option choisie. */
  suite?: Beat[];
}

/** Ce que Sola demande : la feuille qui monte du bas, ou la carte de l'alerte. */
export interface Question {
  id: string;
  /** Au-dessus du titre ; « Sola te demande » quand rien n'est précisé. */
  surtitre?: string;
  /** Reprise écrite de ce que Sola vient de demander à voix haute. */
  titre: string;
  detail?: string;
  /**
   * Ce que Sola prononce en posant la question, quand la réplique qui l'amène
   * ne la pose pas déjà. Dit, pas écrit : la question est à l'écran, la
   * recopier dans la trace la ferait lire deux fois.
   */
  dit?: string;
  personne?: Personne;
  options: Option[];
}

/** Un instant du scénario, en millisecondes depuis le début de l'étape. */
export interface Beat {
  at: number;
  state?: VoiceState;
  /** Ce que Sola dit : prononcé à voix haute et écrit dans la trace. */
  dit?: string;
  /** Ligne d'état affichée en pied de borne. */
  hint?: string;
  sortie?: Sortie;
  question?: Question;
}

/** Un tour de parole : le résident dit quelque chose, Sola répond. */
export interface Echange {
  /** Ce que le résident dit — repli affiché quand le micro n'est pas
   *  disponible. Quand il l'est, ce sont ses vrais mots qui s'affichent. */
  resident: string;
  reponse: Beat[];
}

/** La carte d'arrivée de l'alerte : qui vient, dans combien de temps, et ce
 *  qui est déjà fait. */
export interface Arrivee {
  qui: string;
  minutes: number;
  trajet: string;
  faits: string[];
}

export interface Scene {
  key: SceneKey;
  label: string;
  /** Classe de modulation de l'ambiance lumineuse de l'écran. */
  mode?: "calme" | "alerte";
  /** État de départ, avant toute interaction. `sortie` : ce qui est parti
   *  avant même que Sola ne parle. */
  ouverture: { dit: string; hint: string; state: VoiceState; sortie?: Sortie };
  /** Tours de parole, joués l'un après l'autre. */
  echanges: Echange[];
  /** Instants joués dès l'entrée dans le scénario. */
  onEnter?: Beat[];
  /** Sola mène seule : la borne n'attend pas que le résident parle. */
  monologue?: boolean;
  /** Conversation libre : chaque phrase du résident part au modèle local, au
   *  lieu de dérouler `echanges`. */
  ia?: boolean;
  breathing?: boolean;
  arrivee?: Arrivee;
}

/** Ce que la borne affiche en pied quand elle a le micro ouvert sur quelqu'un. */
export const HINT_ECOUTE = "Je t’écoute…";

const APPEL = "Dis « Sola » pour commencer";

export const SCENES: Scene[] = [
  {
    key: "jour",
    label: "Échange",
    ouverture: {
      // Seul texte figé du mode libre : le bonjour. Le reste est le modèle.
      // Sans le prénom : la ligne reste à l'écran tant que personne ne parle,
      // et la borne n'affiche pas qui habite la cabine.
      dit: "Salut. Je suis là.",
      hint: APPEL,
      state: "idle",
    },
    // Pas de tours écrits : c'est le modèle local qui répond (voir `ia.ts`).
    ia: true,
    echanges: [],
  },

  // Démos temporaires : à terme, apaisement / alerte seront déclenchés par
  // de vraies situations (bracelet, chute), plus par ces scénarios écrits.
  {
    key: "calme",
    label: "Apaisement",
    mode: "calme",
    monologue: true,
    breathing: true,
    ouverture: {
      dit: "On respire un coup ensemble ? Suis le rythme, je compte avec toi.",
      hint: "Mode apaisement · déclenché par une hausse de stress",
      state: "speaking",
    },
    echanges: [],
    // Un cycle 4-7-8 dure dix-neuf secondes : la question arrive quand le
    // premier est terminé, pas au milieu d'une expiration.
    onEnter: [
      {
        at: 19000,
        state: "idle",
        question: {
          id: "apaisement",
          titre: "Ça descend un peu ?",
          detail: "Ton rythme cardiaque est passé de 94 à 81 depuis le début du cycle.",
          dit: "Ça descend un peu ?",
          options: [
            {
              label: "Oui, ça va mieux",
              mots: ["oui", "ca va mieux", "mieux"],
              suite: [
                {
                  at: 0,
                  state: "speaking",
                  dit: "Tant mieux. Je te laisse, je reste à portée de voix.",
                },
                { at: 3400, state: "idle", hint: "Mode apaisement · terminé" },
              ],
            },
            {
              label: "Pas encore",
              mots: ["non", "pas encore", "toujours pareil"],
              ghost: true,
              suite: [
                { at: 0, state: "speaking", dit: "On en refait un. Inspire avec moi." },
                { at: 3000, state: "speaking", hint: "Deuxième cycle" },
              ],
            },
          ],
        },
      },
    ],
  },

  {
    key: "alerte",
    label: "Alerte",
    mode: "alerte",
    monologue: true,
    ouverture: {
      dit: "J’ai prévenu le Dr Ferreira. Ne te lève pas, je reste avec toi.",
      hint: "",
      state: "speaking",
      sortie: { id: "alerte", texte: "Alerte transmise · infirmerie B", ton: "critique" },
    },
    echanges: [],
    arrivee: {
      qui: "Dr Ferreira arrive",
      minutes: 4,
      trajet: "parti de l’infirmerie B à 14:31 · arrivée 14:35",
      faits: ["Porte déverrouillée pour l’équipe", "Contact de confiance prévenu : Amara, C-15"],
    },
    onEnter: [
      // Répondre à la voix compte double ici : quelqu'un au sol n'atteint pas
      // l'écran, et ne le voit peut-être pas — d'où la question prononcée. Les
      // boutons restent, pour qui est debout devant la borne.
      {
        at: 5600,
        state: "idle",
        question: {
          id: "presence",
          surtitre: "Si tu peux",
          titre: "Tu m’entends ?",
          detail: "Dis-le-moi seulement si tu peux. Sinon je garde l’appel tel quel.",
          dit: "Tu m’entends ? Dis-le-moi seulement si tu peux.",
          options: [
            {
              label: "Oui, je t’entends",
              mots: ["oui", "je t’entends", "ca va"],
              suite: [
                {
                  at: 0,
                  state: "speaking",
                  dit: "Je préviens l’équipe que tu m’entends. Respire doucement, le Dr Ferreira arrive.",
                },
                { at: 5000, state: "idle" },
              ],
            },
            {
              label: "Je vais bien, annule",
              mots: ["annule", "je vais bien", "faux appel"],
              ghost: true,
              suite: [
                {
                  at: 0,
                  state: "speaking",
                  dit: "Je transmets, mais le Dr Ferreira passera quand même te voir. C’est la règle après une chute.",
                },
                { at: 5500, state: "idle" },
              ],
            },
          ],
        },
      },
    ],
  },
];

/** Cycle de respiration guidée 4-7-8, en secondes par phase. */
export const BREATH_PHASES: { label: string; seconds: number; scale: number }[] = [
  { label: "Inspire par le nez", seconds: 4, scale: 1.12 },
  { label: "Retiens", seconds: 7, scale: 1.12 },
  { label: "Souffle doucement", seconds: 8, scale: 0.9 },
];
