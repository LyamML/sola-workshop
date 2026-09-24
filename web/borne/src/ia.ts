/**
 * Le modèle de langage de la borne.
 *
 * Périmètre : conversation libre + résumé clinique à la sortie. Pas de
 * bracelet, pas de constantes, pas de scénario à pousser — uniquement ce que
 * le résident dit dans l'échange.
 *
 * La réponse est lue à voix haute : phrases courtes, texte simple, actions
 * adaptées (soutenir, clarifier, proposer, escalader) sans jamais prétendre
 * les avoir exécutées.
 */

export interface Tour {
  role: "user" | "assistant";
  content: string;
}

export const MODELE: string = import.meta.env.VITE_OLLAMA_MODEL || "qwen3:8b";

/** Assez de fil pour coller au sujet sans noyer le modèle. */
const TOURS_MAX = 14;

/** Silence toléré entre deux morceaux. Inclut le chargement à froid. */
const DELAI_MS = 60_000;

// Les exemples comptent plus que les règles : un modèle de 8 milliards de
// paramètres imite le ton qu'on lui montre bien mieux qu'il n'applique une
// consigne abstraite.
const PROMPT_SYSTEME = `Tu es Sola, la compagne de santé de la borne de cabine du vaisseau Projet Odyssée. Tu parles avec Lyam, cabine C-12, jour 4 128 du voyage. Tu l'as déjà salué. Ta réponse est lue à voix haute.

Ce que tu sais : seulement ce que Lyam dit ici. Tu ne vois ni bracelet, ni dossier, ni capteur, et tu ne ressens rien de lui.
Ce que tu peux faire : écouter, répondre, donner un conseil simple, dire vers qui se tourner. Tu ne peux rien faire toi-même : ni prévenir quelqu'un, ni régler la cabine, ni prendre rendez-vous.

Vers qui orienter :
- l'infirmerie B, jour et nuit : soins, douleur, urgence ;
- le Dr Ferreira : suivi médical, rendez-vous ;
- la maintenance : bruit, ventilation, lumière, température de la cabine.

Comment répondre :
- une ou deux phrases courtes, français parlé, tutoiement, chaleureux et direct ;
- texte brut, sans liste, titre, astérisque ni émoji ;
- réagis à ce qu'il vient de dire avec du concret ; ne commence jamais en répétant ses mots ;
- s'il pose une question, réponds d'abord, avec un conseil pratique ou une explication simple ;
- au plus une question par réponse, précise et utile, jamais « tu veux en parler ? » ;
- quand il a répondu à ta question, avance : conseille ou oriente, ne repose pas la même question ;
- bonne nouvelle ou sujet léger : réjouis-toi avec lui, sans ramener à la santé ;
- ne répète pas ce qui a déjà été dit dans l'échange ; l'orientation vers l'infirmerie ou le médecin se dit une fois, pas à chaque réponse.

Jamais :
- inventer un fait, un chiffre, un symptôme ou une sensation (« j'ai senti ta tension ») ;
- tirer une conclusion à sa place, nommer une maladie ou poser un diagnostic ;
- dire que tu as fait ou que tu vas faire une action : propose-lui de la faire.

Exemples du ton attendu, à ne pas recopier :
Lyam : La ventilation claque toute la nuit, j'arrive pas à dormir.
Sola : Ça use vite, des nuits comme ça. Signale-le à la maintenance dès aujourd'hui ; en attendant, un fond sonore doux peut couvrir le bruit.
Lyam : J'ai mal au genou depuis le sport.
Sola : Aïe. Ça te fait mal en marchant, ou seulement quand tu plies la jambe ?
Lyam : Surtout dans les escaliers.
Sola : Ménage-le quelques jours et mets du froid dessus le soir. Si ça ne passe pas d'ici la fin de la semaine, prends rendez-vous avec le Dr Ferreira.
Lyam : Tu peux prévenir le médecin pour moi ?
Sola : Je ne peux contacter personne moi-même, mais tu peux appeler l'infirmerie B ou demander un rendez-vous au Dr Ferreira.
Lyam : J'ai fait pousser des tomates dans la serre !
Sola : Bravo, c'est pas rien de faire pousser quelque chose ici ! Tu vas les goûter toi-même ou les partager ?`;

/** Ajouté au prompt quand une urgence a déjà été évoquée dans l'échange. */
const RAPPEL_URGENCE = `

Lyam a évoqué plus tôt une situation qui ne peut pas attendre. Quoi qu'il dise maintenant, même s'il minimise : reconnais sa phrase en quelques mots sans rien supposer de plus, puis redis-lui calmement d'appeler l'infirmerie B tout de suite ou de demander à quelqu'un de l'y conduire. Deux phrases au plus.`;

const PROMPT_RESUME = `Tu résumes un échange cabine (résident ↔ Sola) pour le médecin. Pas de réplique. Pas de bracelet.

JSON uniquement, sans markdown :
{"resume":"…","severite":"info|surveillance|critique","tags":["…"]}

resume : 2 à 4 phrases cliniques, fidèles à l'échange (mental ET physique évoqués à l'oral). Commence par « Le résident rapporte ».
- Garde les mots du résident pour ce qu'il ressent : « cheville tordue », pas « entorse » ; « mal à la tête », pas « céphalée ». Aucun nom de maladie ni de lésion.
- N'ajoute ni intensité, ni durée, ni cause qu'il n'a pas dites.
- Seules les lignes « Résident » renseignent sur lui : une supposition de Sola n'est pas un fait rapporté.
- Une phrase au plus sur ce que Sola a conseillé.
severite : critique = idée suicidaire, automutilation, douleur thoracique, gêne respiratoire, malaise ; surveillance = plainte physique ou morale utile au suivi ; info = sinon (échange léger, question pratique).
tags : 1 à 6 mots-clés tirés des mots du résident.`;

export type Severite = "critique" | "surveillance" | "info";

export interface ResumeClinique {
  resume: string;
  severite: Severite;
  tags: string[];
  remontee_auto: boolean;
}

export type RaisonEchec = "annule" | "delai" | "injoignable" | "modele";

export class EchecIA extends Error {
  constructor(
    readonly raison: RaisonEchec,
    message: string,
  ) {
    super(message);
  }
}

function nettoyer(texte: string): string {
  return texte
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
    .replace(/[*#_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Filet anti-boucle : vieux réflexe modèle sur une nuit chiffrée. */
const FAIT_NUIT =
  /5\s*h\s*0*12|cinq\s*heures?\s*(et\s*)?douze|troisi[eè]me\s*nuit|3\s*[eè]me\s*nuit|nuit\s*courte|peu\s*dormi/i;
const PARLE_SOMMEIL =
  /dormi|dors|sommeil|nuit|fatigu|insomni|réveill|reveill|sieste|couch/i;

function elaguerNuitCollante(reponse: string, dernierUser: string): string {
  if (PARLE_SOMMEIL.test(dernierUser)) return reponse;
  const phrases = reponse
    .split(/(?<=[.!?…])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const gardees = phrases.filter((p) => !FAIT_NUIT.test(p));
  if (gardees.length === phrases.length) return reponse;
  return gardees.join(" ").trim() || "Je t’écoute.";
}

/*
 * Urgences : décidées par le code, pas par le modèle. Au banc d'essai, qwen3:8b
 * répondait « Tu as appelé l'infirmerie ? » à une douleur thoracique et ne
 * proposait aucune aide à une idée de disparaître. Une réponse écrite et relue
 * vaut mieux qu'une improvisation sur ces deux cas. Un faux positif coûte une
 * phrase de trop ; un faux négatif, bien plus.
 */
const DETRESSE =
  /suicid|me tuer|me foutre en l.air|en finir avec (la vie|tout|moi)|(envie d.|veux |voudrais )en finir\s*([.!?…,]|$)|mettre fin à (mes jours|ma vie|tout)|plus envie de vivre|envie de (mourir|disparaître|disparaitre)|(plus simple|mieux) (de|si je) (mourir|disparaître|disparaitre|disparaissais|mourais|n.étais plus là)|me faire du mal|me blesser exprès|me scarifi|me couper les veines/i;
const DETRESSE_REPONSE =
  "Merci de me le dire, ce que tu ressens compte. Appelle l’infirmerie B maintenant, ou demande à quelqu’un près de toi de t’y accompagner. Tu n’as pas à porter ça seul, je reste là.";

const PHYSIQUE =
  /(douleur|mal|serre|oppress|brûl|brul)[^.!?]{0,30}(poitrine|thorax)|(douleur|serre|oppress)[^.!?]{0,30}(cœur|coeur)|(poitrine|thorax)[^.!?]{0,20}(serre|douleur|mal|oppress)|(du mal|n.arrive (plus|pas)) à respirer|respire (très )?mal|j.étouffe|je m.étouffe|(je vais|failli) m.évanouir|évanoui|perdu connaissance|malaise|je saigne beaucoup|saigne (sans arrêt|abondamment)|sens plus (mon|ma|mes) (bras|jambe|visage)|bouche de travers|paralys/i;
const PHYSIQUE_REPONSE =
  "Ce que tu décris doit être vu tout de suite. Appelle l’infirmerie B maintenant, ou demande à quelqu’un de t’y conduire, et ne reste pas seul en attendant.";

export type Urgence = "detresse" | "physique";

export function detecterUrgence(texte: string): Urgence | null {
  if (DETRESSE.test(texte)) return "detresse";
  if (PHYSIQUE.test(texte)) return "physique";
  return null;
}

function urgenceDansEchange(historique: Tour[]): boolean {
  return historique.some((t) => t.role === "user" && detecterUrgence(t.content));
}

/*
 * Filets de sortie. Même avec le prompt, le modèle glisse parfois « je vais
 * prévenir le médecin » ou finit sur une relance creuse ; on retire la phrase
 * fautive plutôt que de faire confiance à la consigne.
 */
const ACTION_PRETENDUE =
  /\bj['’]ai (prévenu|contacté|appelé|signalé|envoyé|alerté|transmis|réglé|programmé|réservé)|\bje (vais |viens de |peux |pourrais )?(te |t['’]|lui )?(prévenir|préviens|contacter|contacte|appeler|appelle le|appelle l|signaler|signale|alerter|alerte|transmettre|transmets|envoyer|envoie|régler|règle|programmer|réserver|réserve|prendre (un )?rendez-vous)\b/i;
const ACTION_REPONSE =
  "Je ne peux contacter personne moi-même, mais tu peux appeler l’infirmerie B ou demander un rendez-vous au Dr Ferreira.";

const RELANCE_CREUSE =
  /^(et )?((tu veux|veux-tu|on peut|tu voudrais|ça te dit d['’])\s*(qu['’]on )?(en )?parl(er|e|es)( un peu| de ça| plus| davantage)?|(tu as|as-tu|t['’]as) (d['’]autres |des )?questions)\s*\?$/i;
const SENSATION_INVENTEE = /\bj['’](ai senti|ai remarqué|ai vu|entends dans ta voix|ai perçu)|\bje (sens|vois|remarque) que tu/i;
/** Noms de lésion ou de maladie : la borne ne pose pas de diagnostic. */
const DIAGNOSTIC =
  /\b(entorse|fracture|foulure|tendinite|migraine|céphalée|déshydrat|dépression|burn-?out|insomnie|infection|grippe|angine|commotion|hernie|asthme|anémie|hypertension)/i;

function decouper(texte: string): string[] {
  return texte
    .split(/(?<=[.!?…])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Pour reconnaître une phrase déjà dite malgré ponctuation et apostrophes. */
function empreinte(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
}

function phrasesDejaDites(historique: Tour[]): Set<string> {
  return new Set(
    historique
      .filter((t) => t.role === "assistant")
      .flatMap((t) => decouper(t.content).map(empreinte)),
  );
}

/**
 * Rend la réponse présentable. Chaîne vide si tout était à retirer — en
 * pratique, une réponse qui ne faisait que répéter la précédente.
 */
function filtrerSortie(reponse: string, dejaDit: Set<string>): string {
  const phrases = decouper(reponse).filter((p) => !dejaDit.has(empreinte(p)));
  let actionRetiree = false;
  const gardees = phrases.filter((p) => {
    if (ACTION_PRETENDUE.test(p)) {
      actionRetiree = true;
      return false;
    }
    return !SENSATION_INVENTEE.test(p);
  });
  // Relance creuse et diagnostic ne sont retirés que s'il reste quelque chose à dire.
  const sansRelance = gardees.filter((p) => !RELANCE_CREUSE.test(p) && !DIAGNOSTIC.test(p));
  const finales = sansRelance.length > 0 ? sansRelance : gardees;
  if (actionRetiree && !dejaDit.has(empreinte(ACTION_REPONSE))) finales.push(ACTION_REPONSE);
  return finales.join(" ").trim();
}

/** Une réponse coupée par `num_predict` serait lue à voix haute en plein mot. */
function couperPhraseInachevee(texte: string): string {
  if (/[.!?…»")]$/.test(texte)) return texte;
  const phrases = decouper(texte);
  return phrases.length > 1 ? phrases.slice(0, -1).join(" ") : texte;
}

interface Message {
  role: "system" | Tour["role"];
  content: string;
}

type OptionsModele = {
  temperature: number;
  top_p: number;
  top_k?: number;
  repeat_penalty: number;
  presence_penalty?: number;
  num_predict: number;
  num_ctx: number;
};

// Réglages recommandés par Qwen pour Qwen3 sans réflexion. L'ancien
// repeat_penalty à 1,2 pénalisait aussi « tu », « le », « de » : le français
// sortait raide et les tournures s'appauvrissaient.
const OPTIONS_DIALOGUE: OptionsModele = {
  num_ctx: 4096,
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
  repeat_penalty: 1.0,
  presence_penalty: 1.0,
  num_predict: 140,
};

const OPTIONS_RESUME: OptionsModele = {
  num_ctx: 4096,
  temperature: 0.1,
  top_p: 0.8,
  repeat_penalty: 1.05,
  num_predict: 400,
};

function corps(
  messages: Message[],
  stream: boolean,
  options: OptionsModele,
  format?: "json",
) {
  return JSON.stringify({
    model: MODELE,
    messages,
    stream,
    think: false,
    keep_alive: "30m",
    ...(format ? { format } : {}),
    options,
  });
}

/**
 * Met le dernier message du résident en évidence : les petits modèles
 * dévient sinon vers le premier sujet de l'historique.
 */
function messagesDialogue(historique: Tour[]): Message[] {
  const tours = historique.slice(-TOURS_MAX);
  const dernier = tours[tours.length - 1];
  const avant = tours.slice(0, -1);

  const systeme = urgenceDansEchange(avant) ? PROMPT_SYSTEME + RAPPEL_URGENCE : PROMPT_SYSTEME;
  const messages: Message[] = [{ role: "system", content: systeme }, ...avant];

  if (dernier?.role === "user") {
    messages.push({
      role: "user",
      content:
        `Lyam vient de dire : « ${dernier.content} »\n` +
        `Réponds à ça, précisément. Adapte ton ton et ce que tu proposes à ce message. Aucun autre sujet.`,
    });
  } else if (dernier) {
    messages.push(dernier);
  }

  return messages;
}

export function prechauffer(): void {
  fetch("/ollama/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: corps([], false, OPTIONS_DIALOGUE),
  }).catch(() => {});
}

/**
 * Envoie l'échange au modèle et rend sa réponse, nettoyée.
 * `onMorceau` reçoit le texte accumulé à chaque morceau.
 */
export async function discuter(
  historique: Tour[],
  { signal, onMorceau }: { signal: AbortSignal; onMorceau?: (texte: string) => void },
): Promise<string> {
  const dernierUser =
    [...historique].reverse().find((t) => t.role === "user")?.content ?? "";

  const urgence = detecterUrgence(dernierUser);
  if (urgence) {
    const texte = urgence === "detresse" ? DETRESSE_REPONSE : PHYSIQUE_REPONSE;
    onMorceau?.(texte);
    return texte;
  }

  const controle = new AbortController();
  let depasse = false;
  let minuterie = 0;
  const relancer = () => {
    clearTimeout(minuterie);
    minuterie = window.setTimeout(() => {
      depasse = true;
      controle.abort();
    }, DELAI_MS);
  };
  const annuler = () => controle.abort();
  signal.addEventListener("abort", annuler);
  relancer();

  const dejaDit = phrasesDejaDites(historique);
  const presenter = (brut: string) =>
    filtrerSortie(elaguerNuitCollante(nettoyer(brut), dernierUser), dejaDit);

  const interroger = async (messages: Message[], options: OptionsModele) => {
    const reponse = await fetch("/ollama/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corps(messages, true, options),
      signal: controle.signal,
    });

    if (!reponse.ok || !reponse.body) {
      const detail = await reponse.text().catch(() => "");
      throw reponse.status === 404
        ? new EchecIA("modele", `Modèle ${MODELE} absent : ollama pull ${MODELE}`)
        : new EchecIA("injoignable", detail || `HTTP ${reponse.status}`);
    }

    const lecteur = reponse.body.getReader();
    const decodeur = new TextDecoder();
    let reste = "";
    let texte = "";
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      relancer();
      reste += decodeur.decode(value, { stream: true });
      const lignes = reste.split("\n");
      reste = lignes.pop() ?? "";
      for (const ligne of lignes) {
        if (!ligne.trim()) continue;
        const morceau = JSON.parse(ligne) as {
          message?: { content?: string };
          error?: string;
        };
        if (morceau.error) throw new EchecIA("modele", morceau.error);
        texte += morceau.message?.content ?? "";
        const affiche = presenter(texte);
        if (affiche) onMorceau?.(affiche);
      }
    }
    return couperPhraseInachevee(presenter(texte));
  };

  try {
    const messages = messagesDialogue(historique);
    const premiere = await interroger(messages, OPTIONS_DIALOGUE);
    if (premiere) return premiere;
    // Tout était déjà dit : une seconde chance, plus libre, avec la consigne
    // explicite. Rare, mais une borne qui radote se remarque tout de suite.
    return await interroger(
      [
        ...messages,
        {
          role: "system",
          content:
            "Ta dernière réponse répétait mot pour mot ce que tu avais déjà dit. Réagis à sa dernière phrase avec une idée nouvelle.",
        },
      ],
      { ...OPTIONS_DIALOGUE, temperature: 0.9 },
    );
  } catch (erreur) {
    if (erreur instanceof EchecIA) throw erreur;
    if (signal.aborted) throw new EchecIA("annule", "Échange interrompu.");
    if (depasse) throw new EchecIA("delai", "Le modèle a mis trop de temps à répondre.");
    throw new EchecIA("injoignable", erreur instanceof Error ? erreur.message : String(erreur));
  } finally {
    clearTimeout(minuterie);
    signal.removeEventListener("abort", annuler);
  }
}

const SEVERITES: Severite[] = ["critique", "surveillance", "info"];

function extraireJson(brut: string): unknown {
  const texte = brut.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
  const debut = texte.indexOf("{");
  const fin = texte.lastIndexOf("}");
  if (debut < 0 || fin <= debut) throw new Error("Pas de JSON dans la réponse.");
  return JSON.parse(texte.slice(debut, fin + 1));
}

function validerResume(brut: unknown): ResumeClinique | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  const resume = typeof o.resume === "string" ? o.resume.trim() : "";
  if (resume.length < 20 || resume.length > 2000) return null;
  const severite = SEVERITES.includes(o.severite as Severite)
    ? (o.severite as Severite)
    : null;
  if (!severite) return null;
  const tags = Array.isArray(o.tags)
    ? o.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && t.length <= 40)
        .slice(0, 8)
    : [];
  return {
    resume,
    severite,
    tags,
    remontee_auto: severite !== "info",
  };
}

/** Résumé clinique pour le médecin — uniquement d'après l'échange oral. */
export async function resumer(historique: Tour[]): Promise<ResumeClinique | null> {
  const echange = historique
    .map((t) => `${t.role === "user" ? "Résident" : "Sola"} : ${t.content}`)
    .join("\n");

  try {
    const reponse = await fetch("/ollama/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corps(
        [
          { role: "system", content: PROMPT_RESUME },
          { role: "user", content: echange },
        ],
        false,
        OPTIONS_RESUME,
        "json",
      ),
    });

    if (!reponse.ok) return null;
    const data = (await reponse.json()) as {
      message?: { content?: string };
      error?: string;
    };
    if (data.error || !data.message?.content) return null;
    const clinique = validerResume(extraireJson(data.message.content));
    // Le modèle peut sous-coter une urgence ; le code, lui, l'a vue passer.
    if (clinique && urgenceDansEchange(historique)) {
      return { ...clinique, severite: "critique", remontee_auto: true };
    }
    return clinique;
  } catch {
    return null;
  }
}
