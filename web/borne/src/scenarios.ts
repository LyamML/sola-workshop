/**
 * Scénarios de la borne.
 *
 * La borne n'a plus de commande à l'écran : on lui parle, elle répond à voix
 * haute, et l'écran ne sert qu'à laisser une trace lisible de l'échange. Un
 * scénario est donc une suite d'instants — ce que Sola dit, quand elle écoute,
 * quand elle pose une question, quand elle affiche ce qu'elle vient de faire.
 *
 * Deux objets seulement portent du contenu :
 *   · `Carte`    — ce que Sola a fait, pour information, sans réponse attendue ;
 *   · `Question` — une demande qui attend une réponse, à voix haute ou au doigt.
 */

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";
export type SceneKey = "jour" | "calme" | "alerte";

export interface Personne {
  initiales: string;
  nom: string;
  meta: string;
}

/** Une trace de ce que Sola vient de faire. Aucune action : depuis qu'il n'y a
 *  plus de bouton sur la borne, tout ce qui appelle une réponse est une
 *  `Question`. */
export interface Carte {
  id: string;
  tag: string;
  /** Teinte chaude : ce qui sort de la cabine (transmission à un soignant). */
  warm?: boolean;
  /** Peut contenir un balisage léger (<b>, <br>). */
  texte?: string;
  personne?: Personne;
}

/** Une réponse possible. Le doigt lit `label`, la voix reconnaît `mots` — la
 *  première forme de `mots` est celle qu'on affiche sous le bouton, elle doit
 *  donc rester courte et facile à prononcer. */
export interface Option {
  label: string;
  mots: string[];
  /** Réponse de repli, sans engagement : rendu plus discret. */
  ghost?: boolean;
  /** Ce que Sola enchaîne une fois l'option choisie. */
  suite?: Beat[];
}

/** La fenêtre qui s'ouvre quand Sola pose une question. */
export interface Question {
  id: string;
  /** Reprise écrite de ce que Sola vient de demander à voix haute. */
  titre: string;
  detail?: string;
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
  carte?: Carte;
  question?: Question;
}

/** Un tour de parole : le résident dit quelque chose, Sola répond. */
export interface Echange {
  /** Ce que le résident dit — repli affiché quand le micro n'est pas
   *  disponible. Quand il l'est, ce sont ses vrais mots qui s'affichent. */
  resident: string;
  reponse: Beat[];
}

export interface Scene {
  key: SceneKey;
  label: string;
  /** Classe de modulation de l'ambiance lumineuse de l'écran. */
  mode?: "calme" | "alerte";
  /** État de départ, avant toute interaction. */
  ouverture: { dit: string; hint: string; state: VoiceState };
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
      dit: "Salut Lyam. Je suis là.",
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
        hint: "Réponds à voix haute, ou touche l’écran",
        question: {
          id: "apaisement",
          titre: "Ça descend un peu ?",
          detail: "Ton rythme cardiaque est passé de 94 à 81 depuis le début du cycle.",
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
      dit: "J’ai prévenu le Dr Ferreira. Il arrive dans 4 minutes. Reste assis, je reste avec toi.",
      hint: "",
      state: "speaking",
    },
    echanges: [],
    onEnter: [
      {
        at: 1200,
        carte: {
          id: "secours",
          tag: "Services médicaux en route",
          texte:
            "<b>Dr A. Ferreira</b> — parti de l’infirmerie B à 14:31, arrivée estimée 14:35.<br>Ta porte a été déverrouillée pour l’équipe. Ton contact de confiance, Amara (C-15), a été prévenue.",
        },
      },
      // Répondre à la voix compte double ici : quelqu'un au sol n'atteint pas
      // l'écran. Le bouton reste, pour celui qui est debout devant la borne.
      {
        at: 5000,
        state: "idle",
        hint: "Réponds à voix haute, ou touche l’écran",
        question: {
          id: "presence",
          titre: "Tu m’entends ?",
          detail: "Dis-le-moi seulement si tu peux. Sinon je garde l’appel tel quel.",
          options: [
            {
              label: "Oui, je t’entends",
              mots: ["oui", "je t’entends", "ca va"],
              suite: [
                {
                  at: 0,
                  state: "speaking",
                  dit: "Bien. Je préviens l’équipe que tu es conscient. Respire doucement, il arrive.",
                },
                { at: 5000, state: "idle", hint: "Dr Ferreira · arrivée 14:35" },
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
                { at: 5500, state: "idle", hint: "Passage de contrôle maintenu" },
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
