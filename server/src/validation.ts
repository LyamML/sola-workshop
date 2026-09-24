import { z } from "zod";

/**
 * Schemas des charges utiles envoyees par les bornes de cabine.
 *
 * Tous sont `.strict()` : une cle inconnue fait echouer la requete. C'est
 * volontairement rigide — sur ce projet, une cle inattendue dans un envoi de
 * conversation est exactement le genre de chose qu'on veut voir echouer fort
 * plutot que passer inapercue.
 */

const codeResident = z
  .string()
  .regex(/^R-\d{4}$/, "Code resident attendu au format R-0448.");

const numeroBracelet = z
  .string()
  .regex(/^BR-\d{4}$/, "Numero de bracelet attendu au format BR-0448.");

/** Horodatage ISO 8601. La borne envoie toujours en UTC. */
const horodatage = z.string().datetime({ offset: true });

/**
 * Bornes physiologiques d'une minute de mesure. Les deux routes qui ecrivent
 * `mesures` les partagent : /ingest/mesure les impose a ce qu'on lui envoie,
 * /ingest/bracelet ecarte ce qui en sort avant de faire ses moyennes, et le
 * renvoie a l'emetteur dans sa reponse. Celles de la FC et de la SpO2 recopient
 * les CHECK de `mesures` (db/serveur/01-schema.sql) : les changer d'un seul
 * cote, c'est faire d'une valeur ecartee une erreur 500.
 */
export const BORNES = {
  bpm: { min: 25, max: 220 },
  rmssd: { min: 0, max: 300 },
  // Toute l'echelle : une SpO2 sous 50 % est rare mais vraie — detresse
  // respiratoire, fin de vie — et c'est celle qu'un soignant doit voir. Seul
  // zero reste dehors, puisqu'il veut dire « pas de valeur ».
  spo2: { min: 1, max: 100 },
  temp: { min: 25, max: 43 },
  activite: { min: 0, max: 16 },
  pas: { min: 0, max: 65535 },
} as const;

export const mesureSchema = z
  .object({
    at: horodatage,
    // Le firmware envoie 0 quand il n'a pas de valeur fiable : la borne
    // convertit en null AVANT d'envoyer. On refuse ici les zeros physiologi-
    // quement impossibles plutot que de les stocker comme des mesures.
    bpm: z.number().min(BORNES.bpm.min).max(BORNES.bpm.max).nullable().default(null),
    rmssd: z.number().min(BORNES.rmssd.min).max(BORNES.rmssd.max).nullable().default(null),
    spo2: z.number().min(BORNES.spo2.min).max(BORNES.spo2.max).nullable().default(null),
    resp: z.number().min(4).max(60).nullable().default(null),
    temp: z.number().min(BORNES.temp.min).max(BORNES.temp.max).nullable().default(null),
    eda: z.number().min(0).max(50).nullable().default(null),
    activite: z
      .number()
      .min(BORNES.activite.min)
      .max(BORNES.activite.max)
      .nullable()
      .default(null),
    pas: z.number().int().min(BORNES.pas.min).max(BORNES.pas.max).nullable().default(null),
    dort: z.boolean().nullable().default(null),
    source: z.enum(["mesure", "simule"]).default("mesure"),
    qualite: z.enum(["good", "fair", "poor", "warmup"]).default("good"),
  })
  .strict();

export const lotMesuresSchema = z
  .object({
    resident: codeResident,
    bracelet: z.string().max(16).optional(),
    batterie: z.number().int().min(0).max(100).optional(),
    // La borne accumule hors ligne et vide sa file a la reconnexion : on
    // accepte donc un lot, pas une mesure isolee.
    mesures: z.array(mesureSchema).min(1).max(1440),
  })
  .strict();

/**
 * Trame du bracelet, telle que le firmware la publie chaque seconde sur son
 * service BLE (`statusJson()` dans firmware/bracelet*), plus `at` : l'ESP32
 * n'a pas d'horloge, c'est le relais qui horodate.
 *
 * Les deux firmwares ne publient pas les memes cles — le KY-039 ajoute
 * `beats` et `amp`, le MAX30102 la SpO2, l'activite, le sommeil et les
 * compteurs de chutes —, et le croquis Wi-Fi envoie la temperature et les
 * pas. Toutes sont declarees et `.strict()` refuse les autres : une cle que
 * le firmware viendrait d'ajouter doit echouer ici, pas disparaitre en
 * silence.
 *
 * Seule la forme est verifiee ici, pas la physiologie : zero y veut dire
 * « pas de valeur fiable », et c'est en faisant la minute que le serveur
 * l'ecarte, avec tout ce qui sort de BORNES. Une valeur aberrante coute
 * donc une seconde de mesure, pas le lot entier.
 */
export const trameSchema = z
  .object({
    at: horodatage,
    id: codeResident.optional(),
    bpm: z.number().min(0),
    rmssd: z.number().min(0),
    q: z.enum(["good", "fair", "poor", "warmup"]),
    // KY-039
    beats: z.number().int().min(0).optional(),
    amp: z.number().min(0).optional(),
    // MAX30102 + MPU6050. tst et waso comptent des epoques du firmware
    // (EPOCH_MS), qui ne durent une minute que dans son reglage par defaut.
    spo2: z.number().min(0).max(100).optional(),
    act: z.number().min(0).optional(),
    sleep: z.union([z.literal(0), z.literal(1)]).optional(),
    tst: z.number().int().min(0).optional(),
    waso: z.number().int().min(0).optional(),
    hrRest: z.number().min(0).optional(),
    fall: z.number().int().min(0).optional(),
    shake: z.number().int().min(0).optional(),
    // Croquis Wi-Fi. La temperature cutanee, en °C, sans minimum : un capteur
    // debranche rend une valeur absurde, qui doit etre ecartee et signalee,
    // pas faire refuser la lecture. Les pas, un compteur qui repart de zero
    // quand le bracelet redemarre, pas a minuit.
    temperature: z.number().optional(),
    steps: z.number().int().min(0).optional(),
  })
  .strict();

export type Mesure = z.infer<typeof mesureSchema>;
export type Trame = z.infer<typeof trameSchema>;

export const lotTramesSchema = z
  .object({
    resident: codeResident,
    // Obligatoire ici, contrairement a /ingest/mesure : c'est lui qui permet
    // de verifier que le bracelet appaire est bien celui du resident.
    bracelet: numeroBracelet,
    // Une heure a une trame par seconde. La borne envoie par paquets de dix
    // minutes ; la marge couvre un relais qui accumulerait davantage.
    trames: z.array(trameSchema).min(1).max(3600),
  })
  .strict();

/**
 * Une lecture seule, du bracelet qui envoie lui-meme en Wi-Fi : la trame sans
 * `at`, puisque rien ne l'horodate avant le serveur, et avec son adresse. Un
 * croquis Arduino n'a souvent ni `rmssd` ni indice de qualite : zero veut deja
 * dire « pas de valeur », et une lecture sans qualite passe pour `fair` — les
 * bornes physiologiques ecartent toujours ce qui est aberrant.
 *
 * `fall` n'y compte pas les chutes comme dans la trame BLE : il dit si le
 * croquis en detecte une. Absent, le croquis ne dit rien des chutes.
 */
export const lectureSchema = trameSchema
  .omit({ at: true, id: true })
  .extend({
    resident: codeResident,
    bracelet: numeroBracelet,
    rmssd: z.number().min(0).default(0),
    q: z.enum(["good", "fair", "poor", "warmup"]).default("fair"),
    fall: z.boolean().optional(),
  })
  .strict();

export const nuitSchema = z
  .object({
    resident: codeResident,
    nuit_du: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    jour_vol: z.number().int().min(0),
    coucher_at: horodatage.nullable().default(null),
    lever_at: horodatage.nullable().default(null),
    sommeil_min: z.number().int().min(0).max(1440).nullable().default(null),
    latence_min: z.number().int().min(0).max(1440).nullable().default(null),
    eveils_min: z.number().int().min(0).max(1440).nullable().default(null),
    source: z.enum(["estime", "simule", "declare"]).default("estime"),
  })
  .strict();

/**
 * Resume de conversation.
 *
 * !! Ce schema est le point de passage oblige entre la cabine et le serveur.
 * Il n'accepte AUCUN champ de texte integral. `.strict()` refuserait deja une
 * cle inconnue, mais `refuseVerbatim` ci-dessous existe pour donner un message
 * d'erreur explicite : si un jour quelqu'un branche le transcript ici, il doit
 * lire pourquoi c'est refuse, pas un "unrecognized key".
 */
export const conversationSchema = z
  .object({
    resident: codeResident,
    debut_at: horodatage,
    jour_vol: z.number().int().min(0),
    duree_min: z.number().int().min(0).max(600),
    severite: z.enum(["critique", "surveillance", "info"]),
    // Quelques phrases. La borne produit ce resume en local ; la limite de
    // longueur est une seconde barriere contre un verbatim deguise en resume.
    resume: z.string().min(20).max(2000),
    tags: z.array(z.string().min(2).max(40)).max(8).default([]),
    actions_proposees: z.number().int().min(0).max(20).default(0),
    actions_acceptees: z.number().int().min(0).max(20).default(0),
    remontee_auto: z.boolean().default(false),
    resident_notifie_at: horodatage.nullable().default(null),
  })
  .strict()
  .refine((c) => c.actions_acceptees <= c.actions_proposees, {
    message: "actions_acceptees ne peut pas depasser actions_proposees.",
    path: ["actions_acceptees"],
  });

const CLES_INTERDITES = [
  "transcript",
  "transcription",
  "verbatim",
  "texte",
  "messages",
  "tours",
  "dialogue",
  "audio",
];

/**
 * Refuse toute charge utile portant un champ de transcription, a n'importe
 * quel niveau d'imbrication. C'est la garantie du projet rendue executable :
 * le serveur de bord est physiquement incapable d'accepter un verbatim.
 */
export function refuseVerbatim(valeur: unknown, chemin = ""): string | null {
  if (Array.isArray(valeur)) {
    for (const [i, v] of valeur.entries()) {
      const trouve = refuseVerbatim(v, `${chemin}[${i}]`);
      if (trouve) return trouve;
    }
    return null;
  }
  if (valeur === null || typeof valeur !== "object") return null;

  for (const [cle, v] of Object.entries(valeur)) {
    const complet = chemin ? `${chemin}.${cle}` : cle;
    if (CLES_INTERDITES.includes(cle.toLowerCase())) return complet;
    const trouve = refuseVerbatim(v, complet);
    if (trouve) return trouve;
  }
  return null;
}

export const evenementSchema = z
  .object({
    resident: codeResident,
    type: z.enum(["chute", "secousse", "perte_contact", "bouton_urgence"]),
    survenu_at: horodatage,
    intensite_g: z.number().min(0).max(16).nullable().default(null),
  })
  .strict();

export type Evenement = z.infer<typeof evenementSchema>;

/**
 * Signal de gravite emis par la borne en cours de conversation.
 *
 * Le motif est generique (ex. "Urgence physique detectee — J+4128") :
 * aucun verbatim du resident n'est accepte. refuseVerbatim est appele
 * cote serveur avant la validation de forme.
 */
export const signalSchema = z
  .object({
    resident: codeResident,
    motif: z.string().min(5).max(255),
    severite: z.enum(["critique", "surveillance", "info"]),
    survenu_at: horodatage,
  })
  .strict();
