// =============================================================================
//  Sola — relais des trames du bracelet vers le serveur de bord
//
//  La borne ne calcule rien : elle horodate chaque trame — l'ESP32 n'a pas
//  d'horloge — et la transmet telle quelle. C'est le serveur qui en fait des
//  minutes de mesure (POST /ingest/bracelet).
//
//  Elle n'envoie que des minutes closes : le serveur écrit une ligne par
//  minute et remplace celle qu'il avait, si bien qu'une minute envoyée en
//  deux fois ne garderait que sa seconde moitié.
//
//  Le jeton de /ingest n'est jamais dans cette page. Le serveur de Vite
//  l'ajoute en relayant la requête (vite.config.ts) : une page n'a pas de
//  secret, n'importe qui peut en lire le code.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";

const ROUTE = "/ingest/bracelet";
const MINUTE = 60_000;
/** Une heure sans serveur, puis la file oublie ses minutes les plus anciennes. */
const FILE_MAX = 60;
/** Dix minutes, six cents trames : un rattrapage ne part pas d'un seul bloc. */
const PAR_ENVOI = 10;
const ATTENTE_MIN = 5_000;
const ATTENTE_MAX = 60_000;

interface Minute {
  debut: number;
  serie: string;
  trames: Record<string, unknown>[];
}

export type EtatTransmission =
  | { etat: "inactif" }
  | { etat: "attente" }
  | { etat: "a-jour"; derniere: Date }
  | { etat: "hors-ligne"; enFile: number }
  | { etat: "refus"; message: string }
  | { etat: "non-reconnu" };

/** Le motif d'un refus, tel que le serveur l'a écrit quand c'est lui qui répond. */
async function motif(rep: Response): Promise<string> {
  try {
    const corps = (await rep.json()) as {
      erreur?: unknown;
      detail?: { path?: unknown[]; message?: unknown }[];
    };
    if (typeof corps.erreur === "string") {
      const premier = Array.isArray(corps.detail) ? corps.detail[0] : undefined;
      if (!premier || typeof premier.message !== "string") return corps.erreur;
      const chemin = (premier.path ?? []).join(".");
      return `${corps.erreur} (${chemin ? `${chemin} : ` : ""}${premier.message})`;
    }
  } catch {
    /* pas du JSON : la réponse ne vient pas du serveur de bord */
  }
  // Un 404 sans corps vient du relais de Vite : lancé sans jeton, ou borne
  // ouverte depuis une autre machine.
  return rep.status === 404 ? "relais absent (voir vite.config.ts)" : `erreur ${rep.status}`;
}

/**
 * La file d'envoi de la borne. Elle se crée une fois et `arreter` ne fait que
 * couper la minuterie : le mode strict de React démonte et remonte chaque
 * effet, la file doit y survivre.
 */
export function creerFile(resident: string, surEtat: (e: EtatTransmission) => void) {
  let courante: Minute | null = null;
  let file: Minute[] = [];
  let enVol = false;
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  let attente = ATTENTE_MIN;
  let annonce: EtatTransmission["etat"] = "inactif";

  const annoncer = (e: EtatTransmission) => {
    annonce = e.etat;
    surEtat(e);
  };

  function clore() {
    if (!courante) return;
    file.push(courante);
    courante = null;
    if (file.length > FILE_MAX) file = file.slice(-FILE_MAX);
    if (annonce === "hors-ligne") annoncer({ etat: "hors-ligne", enFile: file.length });
    void envoyer();
  }

  function reessayer() {
    if (minuterie) return;
    minuterie = setTimeout(() => {
      minuterie = null;
      void envoyer();
    }, attente);
    attente = Math.min(attente * 2, ATTENTE_MAX);
  }

  async function envoyer(): Promise<void> {
    // Une nouvelle minute close n'avance pas un réessai programmé : un
    // serveur tombé n'a pas à être relancé toutes les soixante secondes.
    if (enVol || minuterie || file.length === 0) return;

    // Un envoi ne mêle jamais deux bracelets : le serveur contrôle la série
    // du lot entier contre le résident.
    const serie = file[0].serie;
    const paquet: Minute[] = [];
    for (const m of file) {
      if (m.serie !== serie || paquet.length === PAR_ENVOI) break;
      paquet.push(m);
    }

    enVol = true;
    let suite = false;
    try {
      const rep = await fetch(ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resident,
          bracelet: serie,
          trames: paquet.flatMap((m) => m.trames),
        }),
      });
      if (rep.status >= 500) throw new Error(`HTTP ${rep.status}`);

      // Parti, ou refusé pour de bon : le renvoyer tel quel ne changerait
      // rien, et le garder bloquerait tout ce qui le suit.
      file = file.filter((m) => !paquet.includes(m));
      attente = ATTENTE_MIN;
      annoncer(
        rep.ok
          ? { etat: "a-jour", derniere: new Date() }
          : { etat: "refus", message: await motif(rep) },
      );
      suite = file.length > 0;
    } catch {
      annoncer({ etat: "hors-ligne", enFile: file.length });
      reessayer();
    } finally {
      enVol = false;
    }
    if (suite) void envoyer();
  }

  function recevoir(trame: Record<string, unknown>, serie: string | null) {
    if (serie === null) {
      if (annonce !== "non-reconnu") annoncer({ etat: "non-reconnu" });
      return;
    }
    const maintenant = Date.now();
    const debut = maintenant - (maintenant % MINUTE);
    if (courante && (courante.debut !== debut || courante.serie !== serie)) clore();
    if (!courante) {
      courante = { debut, serie, trames: [] };
      if (annonce === "inactif" || annonce === "non-reconnu") annoncer({ etat: "attente" });
    }
    courante.trames.push({ ...trame, at: new Date(maintenant).toISOString() });
  }

  /** Le bracelet s'est tu : la minute entamée part telle quelle. */
  function terminer() {
    clore();
  }

  function arreter() {
    if (minuterie) clearTimeout(minuterie);
    minuterie = null;
  }

  return { recevoir, terminer, arreter };
}

/** La file de la borne et son état, prêts à brancher sur le bracelet. */
export function useTransmission(resident: string) {
  const [etat, setEtat] = useState<EtatTransmission>({ etat: "inactif" });
  const file = useRef<ReturnType<typeof creerFile> | null>(null);
  file.current ??= creerFile(resident, setEtat);

  useEffect(() => () => file.current?.arreter(), []);

  const recevoir = useCallback(
    (trame: Record<string, unknown>, serie: string | null) => file.current?.recevoir(trame, serie),
    [],
  );
  const terminer = useCallback(() => file.current?.terminer(), []);

  return { etat, recevoir, terminer };
}

const heure = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Ce que la barre d'état en dit, ou null tant que rien n'est relayé. */
export function libelleTransmission(
  e: EtatTransmission,
): { texte: string; alerte: boolean } | null {
  switch (e.etat) {
    case "inactif":
      return null;
    case "attente":
      return { texte: "Constantes : première minute en cours", alerte: false };
    case "a-jour":
      return { texte: `Constantes transmises · ${heure(e.derniere)}`, alerte: false };
    case "hors-ligne":
      return { texte: `Serveur injoignable · ${e.enFile} min en attente`, alerte: true };
    case "refus":
      return { texte: `Mesures refusées : ${e.message}`, alerte: true };
    case "non-reconnu":
      return { texte: "Bracelet non reconnu : rien n'est transmis", alerte: true };
  }
}
