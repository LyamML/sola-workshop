/**
 * Le modèle de langage de la borne.
 *
 * Il tourne dans la cabine, sur la même machine que l'écran : Ollama, atteint
 * par le proxy `/ollama` du serveur Vite. Rien de ce qui se dit ici ne passe par
 * le serveur de bord — l'historique vit dans la mémoire de la page et meurt
 * avec elle.
 *
 * La réponse est lue à voix haute. Tout le prompt est tourné vers ça : des
 * phrases courtes, pas de mise en forme, et aucune promesse d'action que la
 * borne ne sait pas tenir.
 */

export interface Tour {
  role: "user" | "assistant";
  content: string;
}

export const MODELE: string = import.meta.env.VITE_OLLAMA_MODEL || "qwen3:8b";

/** Au-delà, les premiers tours tombent : le prompt reste court, et c'est la
 *  longueur du prompt qui fait l'essentiel de l'attente sur une petite carte. */
const TOURS_MAX = 10;

/** Silence toléré entre deux morceaux de réponse. Le premier inclut le
 *  chargement du modèle en mémoire, qui prend plusieurs secondes à froid. */
const DELAI_MS = 60_000;

const PROMPT_SYSTEME = `Tu es Sola, la compagne de santé embarquée du vaisseau générationnel Méridien. Tu parles avec Lyam Mafray, cabine C-12, au jour 4 128 du vol.

Ce que tu sais de lui aujourd'hui : il a dormi 5 h 12 cette nuit, et c'est sa troisième nuit courte d'affilée. Tu n'as aucune autre donnée sur lui.

Ta réponse est lue à voix haute par la borne :
- une à trois phrases courtes, en français, en le tutoyant ;
- du texte simple, sans liste, sans titre, sans astérisque, sans émoji.

Règles :
- Tu l'as déjà salué et tu as déjà évoqué sa nuit : ne le salue plus et ne répète jamais une phrase que tu as déjà dite. Réponds directement à ce qu'il vient de dire.
- Tu écoutes et tu soutiens. Tu ne poses aucun diagnostic et tu ne nommes aucune maladie.
- Tu n'inventes aucun chiffre ni aucune information sur lui.
- Tu ne prétends jamais avoir fait une action (prévenir quelqu'un, régler la lumière, appeler la maintenance) : tu n'en as pas le moyen. Tu peux lui proposer de le faire.
- Rien de ce qu'il te dit ne quitte la cabine.
- S'il parle de se faire du mal, d'une douleur forte, d'un malaise ou d'une urgence, dis-lui clairement de contacter tout de suite l'infirmerie ou le Dr Ferreira.`;

export type RaisonEchec = "annule" | "delai" | "injoignable" | "modele";

export class EchecIA extends Error {
  constructor(
    readonly raison: RaisonEchec,
    message: string,
  ) {
    super(message);
  }
}

/** Ce que le modèle glisse parfois malgré la consigne : un raisonnement entre
 *  balises, des astérisques de gras. La synthèse vocale les lirait tels quels. */
function nettoyer(texte: string): string {
  return texte
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
    .replace(/[*#_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Message {
  role: "system" | Tour["role"];
  content: string;
}

function corps(messages: Message[], stream: boolean) {
  return JSON.stringify({
    model: MODELE,
    messages,
    stream,
    // Qwen3 raisonne longuement avant de répondre si on le laisse faire : sur
    // une borne, c'est une demi-minute de silence pour une phrase.
    think: false,
    keep_alive: "30m",
    options: { num_ctx: 4096 },
  });
}

/**
 * Charge le modèle en mémoire sans rien générer, pour que la première vraie
 * réponse n'attende pas le chargement. Un échec ici n'a pas de conséquence :
 * `discuter` le rencontrera et le dira.
 */
export function prechauffer(): void {
  fetch("/ollama/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: corps([], false),
  }).catch(() => {});
}

/**
 * Envoie l'échange au modèle et rend sa réponse, nettoyée.
 * `onMorceau` reçoit le texte accumulé à chaque morceau, pour l'afficher au fil
 * de l'eau. Jette une `EchecIA` dont la raison dit quoi afficher.
 */
export async function discuter(
  historique: Tour[],
  { signal, onMorceau }: { signal: AbortSignal; onMorceau?: (texte: string) => void },
): Promise<string> {
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

  const messages: Message[] = [
    { role: "system", content: PROMPT_SYSTEME },
    ...historique.slice(-TOURS_MAX),
  ];

  try {
    const reponse = await fetch("/ollama/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corps(messages, true),
      signal: controle.signal,
    });

    if (!reponse.ok || !reponse.body) {
      const detail = await reponse.text().catch(() => "");
      // Un modèle absent rend 404 ; le proxy rend 5xx quand Ollama est éteint.
      throw reponse.status === 404
        ? new EchecIA("modele", `Modèle ${MODELE} absent : ollama pull ${MODELE}`)
        : new EchecIA("injoignable", detail || `HTTP ${reponse.status}`);
    }

    // Une ligne JSON par morceau (NDJSON). Un morceau réseau peut couper une
    // ligne en deux : on garde le reste pour le tour suivant.
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
        onMorceau?.(nettoyer(texte));
      }
    }
    return nettoyer(texte);
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
