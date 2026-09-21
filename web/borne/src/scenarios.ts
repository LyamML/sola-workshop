/**
 * Scénarios de la borne.
 *
 * La borne est vocale : il n'y a jamais de fil de conversation à l'écran, une
 * seule réplique à la fois. Un scénario est donc une suite d'instants — on
 * programme ce que Sola dit, quand elle écoute, et quand une carte apparaît.
 */

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";
export type SceneKey = "jour" | "calme" | "alerte";

export interface CardAction {
  label: string;
  ghost?: boolean;
}

export interface CardSpec {
  id: string;
  tag: string;
  warm?: boolean;
  /** Peut contenir un balisage léger (<b>, <br>). */
  text?: string;
  person?: { initials: string; name: string; meta: string };
  actions?: CardAction[];
}

/** Un instant du scénario, en millisecondes depuis le début de l'étape. */
export interface Beat {
  at: number;
  state?: VoiceState;
  who?: string;
  line?: string;
  /** Réplique du résident plutôt que de Sola : typographie plus discrète. */
  user?: boolean;
  hint?: string;
  card?: CardSpec;
}

export interface Scene {
  key: SceneKey;
  label: string;
  /** Classe de modulation de l'ambiance lumineuse de l'écran. */
  mode?: "calme" | "alerte";
  /** État de départ, avant toute interaction. */
  opening: { who: string; line: string; hint: string; state: VoiceState };
  /** Étapes déclenchées l'une après l'autre par le bouton micro. */
  steps: Beat[][];
  /** Instants joués dès l'entrée dans le scénario. */
  onEnter?: Beat[];
  /** Le micro est masqué quand Sola mène l'échange (apaisement, alerte). */
  hideMic?: boolean;
  breathing?: boolean;
}

const SOLA = "Sola";
const RESIDENT = "Lyam";

export const SCENES: Scene[] = [
  {
    key: "jour",
    label: "Échange",
    opening: {
      who: SOLA,
      line: "Salut Lyam. Tu as dormi 5 h 12 cette nuit — je me disais qu’on pouvait en parler.",
      hint: "Dis « Sola » ou appuie pour parler",
      state: "idle",
    },
    steps: [
      [
        { at: 0, state: "listening", hint: "Je t’écoute…", who: RESIDENT, user: true,
          line: "Sola, j’ai encore super mal dormi." },
        { at: 2300, state: "thinking", who: SOLA, line: "…" },
        { at: 3400, state: "speaking", who: SOLA,
          line: "Cinq heures douze. C’est ta troisième nuit courte d’affilée. Tu veux qu’on regarde ce qui se passe, ou je te laisse tranquille ?" },
        { at: 7200, state: "idle", hint: "Appuie pour répondre" },
      ],
      [
        { at: 0, state: "listening", hint: "Je t’écoute…", who: RESIDENT, user: true,
          line: "C’est la ventilation du module C, elle claque toute la nuit." },
        { at: 2300, state: "thinking", who: SOLA, line: "…" },
        { at: 3400, state: "speaking", who: SOLA,
          line: "Je préviens la maintenance — c’est fait, tu n’as rien à faire. Et je baisse la lumière de la cabine à 19 h ce soir pour t’aider à recaler ton cycle." },
        { at: 5200, card: {
            id: "maintenance",
            tag: "Action lancée",
            text: "Demande de contrôle acoustique transmise à la maintenance — module C, conduit 4. Lumière de cabine avancée à 19:00 ce soir.",
            actions: [{ label: "Annuler la lumière", ghost: true }],
          } },
        { at: 8200, state: "idle", hint: "Appuie pour répondre" },
      ],
      [
        { at: 0, state: "thinking", hint: "" },
        { at: 900, state: "speaking", who: SOLA,
          line: "Une dernière chose. Yuki, du C-14, a eu exactement le même souci sur le bac 7 le mois dernier. Elle est au jardin 2 à 18 h." },
        { at: 3000, card: {
            id: "yuki",
            tag: "Quelqu’un qui peut aider",
            person: { initials: "YK", name: "Yuki Tanabe · C-14", meta: "Hydroponie, musique · disponible à 18 h" },
            actions: [{ label: "Lui dire que je passe" }, { label: "Une autre fois", ghost: true }],
          } },
        { at: 6500, state: "speaking", who: SOLA,
          line: "Et j’ai signalé ta fatigue au Dr. Ferreira. Rien d’inquiétant — c’est un point de vigilance, il te contactera peut-être cette semaine." },
        { at: 8600, card: {
            id: "escalade",
            tag: "Je t’en informe",
            warm: true,
            text: "Trois nuits sous 5 h 30 et une variabilité cardiaque sous ton seuil depuis 4 jours. Je n’ai transmis qu’un résumé — pas notre conversation.",
            actions: [{ label: "Voir ce qui a été envoyé", ghost: true }],
          } },
        { at: 10500, state: "idle", hint: "Dis « Sola » ou appuie pour parler" },
      ],
    ],
  },

  {
    key: "calme",
    label: "Apaisement",
    mode: "calme",
    hideMic: true,
    breathing: true,
    opening: {
      who: SOLA,
      line: "On respire un coup ensemble ? Suis le rythme, je compte avec toi.",
      hint: "Mode apaisement · déclenché par une hausse de stress",
      state: "speaking",
    },
    steps: [],
  },

  {
    key: "alerte",
    label: "Alerte",
    mode: "alerte",
    hideMic: true,
    opening: {
      who: SOLA,
      line: "J’ai prévenu le Dr. Ferreira. Il arrive dans 4 minutes. Reste assis, je reste avec toi.",
      hint: "",
      state: "speaking",
    },
    steps: [],
    onEnter: [
      { at: 1200, card: {
          id: "secours",
          tag: "Services médicaux en route",
          text: "<b>Dr. A. Ferreira</b> — parti de l’infirmerie B à 14:31, arrivée estimée 14:35.<br>Ta porte a été déverrouillée pour l’équipe. Ton contact de confiance, Amara (C-15), a été prévenue.",
          actions: [{ label: "Je vais bien, annuler", ghost: true }],
        } },
    ],
  },
];

/** Cycle de respiration guidée 4-7-8, en secondes par phase. */
export const BREATH_PHASES: { label: string; seconds: number; scale: number }[] = [
  { label: "Inspire par le nez", seconds: 4, scale: 1.12 },
  { label: "Retiens", seconds: 7, scale: 1.12 },
  { label: "Souffle doucement", seconds: 8, scale: 0.9 },
];
