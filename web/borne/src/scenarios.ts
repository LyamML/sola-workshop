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
      dit: "Salut Lyam. Tu as dormi 5 h 12 cette nuit — je me disais qu’on pouvait en parler.",
      hint: APPEL,
      state: "idle",
    },
    echanges: [
      {
        resident: "Sola, j’ai encore super mal dormi.",
        reponse: [
          { at: 0, state: "thinking", hint: "" },
          {
            at: 1100,
            state: "speaking",
            dit: "Cinq heures douze. C’est ta troisième nuit courte d’affilée. Tu veux qu’on regarde ce qui se passe, ou je te laisse tranquille ?",
          },
          {
            at: 6400,
            state: "idle",
            hint: "Réponds à voix haute, ou touche l’écran",
            question: {
              id: "regarder",
              titre: "On regarde ensemble ce qui t’empêche de dormir ?",
              detail:
                "Rien ne sort de la cabine tant que tu ne l’as pas décidé — je te dirai à chaque fois.",
              options: [
                {
                  label: "Oui, on regarde",
                  mots: ["oui", "d’accord", "ok", "vas-y", "regarde"],
                  suite: [
                    { at: 0, state: "speaking", dit: "D’accord. Raconte-moi ta nuit." },
                    { at: 2400, state: "idle", hint: "Parle quand tu veux" },
                  ],
                },
                {
                  label: "Pas maintenant",
                  mots: ["non", "plus tard", "pas maintenant", "laisse"],
                  ghost: true,
                  suite: [
                    {
                      at: 0,
                      state: "speaking",
                      dit: "Comme tu veux. Je reste là si tu changes d’avis.",
                    },
                    { at: 3000, state: "idle", hint: APPEL },
                  ],
                },
              ],
            },
          },
        ],
      },
      {
        resident: "C’est la ventilation du module C, elle claque toute la nuit.",
        reponse: [
          { at: 0, state: "thinking", hint: "" },
          {
            at: 1100,
            state: "speaking",
            dit: "Je préviens la maintenance — c’est fait, tu n’as rien à faire. Je peux aussi baisser la lumière de la cabine à 19 h ce soir, pour t’aider à recaler ton cycle.",
          },
          {
            at: 3000,
            carte: {
              id: "maintenance",
              tag: "Action lancée",
              texte:
                "Demande de contrôle acoustique transmise à la maintenance — module C, conduit 4.",
            },
          },
          {
            at: 8200,
            state: "idle",
            hint: "Réponds à voix haute, ou touche l’écran",
            question: {
              id: "lumiere",
              titre: "Je baisse la lumière de la cabine à 19 h ce soir ?",
              detail: "Ce soir seulement. Tu me le redis si tu veux que ça devienne l’habitude.",
              options: [
                {
                  label: "Oui, baisse-la",
                  mots: ["oui", "baisse", "d’accord", "ok"],
                  suite: [
                    {
                      at: 0,
                      state: "speaking",
                      dit: "C’est réglé. Dix-neuf heures, lumière basse.",
                    },
                    {
                      at: 1200,
                      carte: {
                        id: "lumiere-ok",
                        tag: "Réglé pour ce soir",
                        texte: "Lumière de cabine <b>C-12</b> avancée à 19:00, pour cette nuit.",
                      },
                    },
                    { at: 3600, state: "idle", hint: "Parle quand tu veux" },
                  ],
                },
                {
                  label: "Laisse comme ça",
                  mots: ["non", "laisse", "pas la peine"],
                  ghost: true,
                  suite: [
                    { at: 0, state: "speaking", dit: "Entendu, je ne touche à rien." },
                    { at: 2600, state: "idle", hint: "Parle quand tu veux" },
                  ],
                },
              ],
            },
          },
        ],
      },
      {
        resident: "Merci. J’aimerais bien que ça s’arrête, c’est tout.",
        reponse: [
          { at: 0, state: "thinking", hint: "" },
          {
            at: 1000,
            state: "speaking",
            dit: "Je sais. Une dernière chose : Yuki, du C-14, a eu exactement le même souci le mois dernier. Elle est au jardin 2 à 18 h. Je lui dis que tu passes ?",
          },
          {
            at: 7200,
            state: "idle",
            hint: "Réponds à voix haute, ou touche l’écran",
            question: {
              id: "yuki",
              titre: "Je préviens Yuki que tu passes au jardin 2 ?",
              personne: {
                initiales: "YK",
                nom: "Yuki Tanabe · C-14",
                meta: "Hydroponie, musique · disponible à 18 h",
              },
              options: [
                {
                  label: "Dis-lui que je passe",
                  mots: ["oui", "dis lui", "je passe", "d’accord"],
                  suite: [
                    { at: 0, state: "speaking", dit: "C’est envoyé. Elle t’attend à 18 h." },
                    {
                      at: 2600,
                      state: "speaking",
                      dit: "Et j’ai signalé ta fatigue au Dr Ferreira. Rien d’inquiétant — c’est un point de vigilance, il te contactera peut-être cette semaine.",
                    },
                    {
                      at: 4200,
                      carte: {
                        id: "escalade",
                        tag: "Je t’en informe",
                        warm: true,
                        texte:
                          "Trois nuits sous 5 h 30 et une variabilité cardiaque sous ton seuil depuis 4 jours. Je n’ai transmis <b>qu’un résumé</b> — pas notre conversation.",
                      },
                    },
                    { at: 9000, state: "idle", hint: APPEL },
                  ],
                },
                {
                  label: "Une autre fois",
                  mots: ["non", "une autre fois", "plus tard"],
                  ghost: true,
                  suite: [
                    {
                      at: 0,
                      state: "speaking",
                      dit: "Pas de souci. J’ai quand même signalé ta fatigue au Dr Ferreira — un point de vigilance, rien de plus.",
                    },
                    {
                      at: 4000,
                      carte: {
                        id: "escalade",
                        tag: "Je t’en informe",
                        warm: true,
                        texte:
                          "Trois nuits sous 5 h 30 et une variabilité cardiaque sous ton seuil depuis 4 jours. Je n’ai transmis <b>qu’un résumé</b> — pas notre conversation.",
                      },
                    },
                    { at: 7000, state: "idle", hint: APPEL },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  },

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
