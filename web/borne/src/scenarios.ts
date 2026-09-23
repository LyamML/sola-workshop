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
 * Le récit suit la base de démonstration : les nuits et la variabilité
 * cardiaque de R-0448, son médecin, sa sœur et le résident que Sola lui
 * propose de voir y sont tels qu'ils sont dits ici. Un chiffre qu'on change
 * dans une réplique se vérifie d'abord avec `npm run db:sql`.
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
 * elle remplace « Tout reste dans la cabine », que la scène démentait deux
 * répliques plus loin en prévenant la maintenance puis le médecin.
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
  /** Sola se remet à attendre son nom : c'est ce qui rend vrai « dis « Sola »
   *  si tu veux reparler », au lieu d'une borne qui écoute encore tout. */
  veille?: boolean;
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
  breathing?: boolean;
  arrivee?: Arrivee;
}

/** Ce que la borne affiche en pied quand elle a le micro ouvert sur quelqu'un. */
export const HINT_ECOUTE = "Je t’écoute…";

const APPEL = "Dis « Sola » pour commencer";

/** La fin d'un échange ne ramène pas à « pour commencer » : la conversation
 *  vient d'avoir lieu. */
const REPARLER = "Dis « Sola » si tu veux reparler";

const PARLE = "Parle quand tu veux";

const MAINTENANCE: Sortie = { id: "maintenance", texte: "1 demande envoyée à la maintenance" };
const SELIM: Sortie = { id: "selim", texte: "1 message envoyé à Selim" };
const MEDECIN: Sortie = {
  id: "medecin",
  texte: "1 résumé transmis au Dr Ferreira",
  ton: "chaud",
};

export const SCENES: Scene[] = [
  {
    key: "jour",
    label: "Échange",
    ouverture: {
      // Sans le prénom : cette ligne reste à l'écran tant que personne ne
      // parle, et la borne n'affiche pas qui habite la cabine.
      dit: "Salut. Tu as dormi 5 h 18 cette nuit — je me disais qu’on pouvait en parler.",
      hint: APPEL,
      state: "idle",
    },
    echanges: [
      {
        resident: "Sola, j’ai encore super mal dormi.",
        reponse: [
          { at: 0, state: "thinking", hint: "" },
          {
            // Les six heures de l'avant-veille coupent la série : c'est la
            // cinquième nuit courte en deux semaines, pas la troisième
            // d'affilée.
            at: 1100,
            state: "speaking",
            dit: "Cinq heures dix-huit. C’est ta cinquième nuit sous cinq heures et demie en deux semaines. Tu veux qu’on regarde ce qui se passe, ou je te laisse tranquille ?",
          },
          {
            at: 7000,
            state: "idle",
            question: {
              id: "regarder",
              titre: "On regarde ensemble ce qui t’empêche de dormir ?",
              detail:
                "5 nuits sur 14 sous 5 h 30, et une variabilité cardiaque sous ton seuil depuis 6 jours.",
              options: [
                {
                  label: "Oui, on regarde",
                  mots: ["oui", "d’accord", "ok", "vas-y", "regarde"],
                  suite: [
                    { at: 0, state: "speaking", dit: "D’accord. Raconte-moi ta nuit." },
                    { at: 2400, state: "idle", hint: PARLE },
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
                    { at: 3000, state: "idle", hint: REPARLER, veille: true },
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
            dit: "Je préviens la maintenance — c’est fait. Je peux aussi baisser la lumière de ta cabine à 19 h ce soir.",
          },
          // Au « c'est fait », pas avant : la pastille suit ce que Sola dit.
          { at: 3200, sortie: MAINTENANCE },
          {
            at: 7000,
            state: "idle",
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
                    { at: 3000, state: "idle", hint: PARLE },
                  ],
                },
                {
                  label: "Laisse comme ça",
                  mots: ["non", "laisse", "pas la peine"],
                  ghost: true,
                  suite: [
                    { at: 0, state: "speaking", dit: "Entendu, je ne touche à rien." },
                    { at: 2600, state: "idle", hint: PARLE },
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
            // Un bruit de conduit, pas un symptôme : Sola ne dit rien de la
            // santé d'un autre résident.
            at: 1000,
            state: "speaking",
            dit: "Je sais. Une dernière chose : Selim, du C-04, a eu le même bruit de conduit le mois dernier. Ce soir, Selim est au jardin 2 à 18 h. Je lui dis que tu passes ?",
          },
          {
            at: 8000,
            state: "idle",
            question: {
              id: "selim",
              titre: "Je préviens Selim que tu passes au jardin 2 ?",
              personne: {
                initiales: "SB",
                nom: "Selim Bergstrom · C-04",
                meta: "Hydroponie · au jardin 2 à 18 h",
              },
              options: [
                {
                  label: "Dis-lui que je passe",
                  mots: ["oui", "dis lui", "je passe", "d’accord"],
                  suite: [
                    {
                      at: 0,
                      state: "speaking",
                      dit: "C’est envoyé : rendez-vous au jardin 2 à 18 h. Et j’ai prévenu le Dr Ferreira de ta fatigue — rien d’inquiétant, un point de vigilance.",
                    },
                    { at: 600, sortie: SELIM },
                    { at: 3600, sortie: MEDECIN },
                    { at: 9500, state: "idle", hint: REPARLER, veille: true },
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
                      dit: "Pas de souci. J’ai quand même prévenu le Dr Ferreira de ta fatigue — un point de vigilance, rien de plus.",
                    },
                    { at: 1800, sortie: MEDECIN },
                    { at: 7000, state: "idle", hint: REPARLER, veille: true },
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
