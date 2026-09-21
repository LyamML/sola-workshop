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

/** Horodatage ISO 8601. La borne envoie toujours en UTC. */
const horodatage = z.string().datetime({ offset: true });

export const mesureSchema = z
  .object({
    at: horodatage,
    // Le firmware envoie 0 quand il n'a pas de valeur fiable : la borne
    // convertit en null AVANT d'envoyer. On refuse ici les zeros physiologi-
    // quement impossibles plutot que de les stocker comme des mesures.
    bpm: z.number().min(25).max(220).nullable().default(null),
    rmssd: z.number().min(0).max(300).nullable().default(null),
    spo2: z.number().min(50).max(100).nullable().default(null),
    resp: z.number().min(4).max(60).nullable().default(null),
    temp: z.number().min(25).max(43).nullable().default(null),
    eda: z.number().min(0).max(50).nullable().default(null),
    activite: z.number().min(0).max(16).nullable().default(null),
    pas: z.number().int().min(0).max(65535).nullable().default(null),
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
